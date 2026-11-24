// RaceRoom: one room = one lobby + its races. Flow:
// lobby (pick animals, ready) -> loading (clients build the map) -> racing (synchronised
// countdown + authoritative sim) -> results -> back to lobby.
import { Room, Client } from '@colyseus/core';
import { RaceState, PlayerInfo } from '../state/RaceState';
import { RaceSession } from '../systems/RaceSession';
import { RateLimiter } from '../systems/RateLimiter';
import { generateRoomCode, sanitizeName } from '../network/roomCodes';
import { MSG, decodeInput, encodeSnapshotCommon, encodeOwnState, encodeEvents, RaceInitMsg } from '@shared/protocol';
import { MAX_PLAYERS, SNAPSHOT_EVERY_TICKS } from '@shared/constants';
import { ANIMALS } from '@shared/animals';
import { decodeLoadout, encodeLoadout, COSMETICS } from '@shared/progression';
import type { Difficulty } from '@shared/ai';
import { config } from '../config';

interface JoinOptions { name?: string; animal?: number; cosmetics?: string; private?: boolean; }

const RECONNECT_SECONDS_RACE = 20;
const RECONNECT_SECONDS_LOBBY = 10;
const LOAD_TIMEOUT_MS = 12000;
const RESULTS_AUTO_RETURN_MS = 25000;

export class RaceRoom extends Room<RaceState> {
  maxClients = MAX_PLAYERS;
  private session: RaceSession | null = null;
  // Clients send ~30-60 msgs/s; allow generous headroom, drop floods, kick only sustained abuse.
  private limiter = new RateLimiter(120, 240);
  private joinCounter = 0;
  private snapCounter = 0;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  private resultsTimer: ReturnType<typeof setTimeout> | null = null;
  private autoStartAt = 0;
  private lastEmote = new Map<string, number>();
  private quick = true;
  private raceWallStart = 0;
  private lastDiag = 0;

  async onCreate(options: JoinOptions) {
    this.quick = !options?.private;
    this.roomId = await generateRoomCode();
    const st = new RaceState();
    st.code = this.roomId;
    st.isPrivate = !this.quick;
    this.setState(st);
    if (!this.quick) await this.setPrivate(true);
    this.setPatchRate(100);
    this.updateMetadata();
    this.setSimulationInterval((dt) => this.update(dt), 1000 / 60);
    this.registerHandlers();
    console.log(`[room ${this.roomId}] created (${this.quick ? 'quick match' : 'private'})`);
  }

  private updateMetadata() {
    this.setMetadata({ code: this.roomId, phase: this.state.phase, map: this.state.mapId, mode: this.quick ? 'quick' : 'private' });
  }

  private player(client: Client): PlayerInfo | undefined { return this.state.players.get(client.sessionId); }
  private isHost(client: Client) { return this.state.hostId === client.sessionId; }

  private registerHandlers() {
    // Every message passes the rate limiter first.
    const guard = <T>(fn: (client: Client, msg: T) => void) => (client: Client, msg: T) => {
      const r = this.limiter.take(client.sessionId);
      if (r === 'kick') { console.warn(`[room ${this.roomId}] rate-limit kick ${client.sessionId}`); client.leave(4008); return; }
      if (r === 'drop') return;
      try { fn(client, msg); } catch (e) { console.error(`[room ${this.roomId}] handler error`, e); }
    };

    this.onMessage(MSG.INPUT, guard((client, msg: unknown) => {
      if (this.state.phase !== 'racing' || !this.session) return;
      const d = decodeInput(msg);
      if (!d) return;
      this.session.applyInput(client.sessionId, d.seq, d.inp);
    }));

    this.onMessage(MSG.READY, guard((client, msg: unknown) => {
      const p = this.player(client);
      if (!p || this.state.phase !== 'lobby') return;
      p.ready = msg === true;
    }));

    this.onMessage(MSG.ANIMAL, guard((client, msg: unknown) => {
      const p = this.player(client);
      if (!p || this.state.phase !== 'lobby') return;
      if (typeof msg === 'number' && Number.isInteger(msg) && msg >= 0 && msg < ANIMALS.length) p.animal = msg;
    }));

    this.onMessage(MSG.COSMETICS, guard((client, msg: unknown) => {
      const p = this.player(client);
      if (!p || this.state.phase !== 'lobby') return;
      p.cosmetics = encodeLoadout(decodeLoadout(String(msg ?? '')));
    }));

    this.onMessage(MSG.NAME, guard((client, msg: unknown) => {
      const p = this.player(client);
      if (!p || this.state.phase !== 'lobby') return;
      p.name = sanitizeName(msg);
    }));

    this.onMessage(MSG.SETTINGS, guard((client, msg: any) => {
      if (!this.isHost(client) || this.state.phase !== 'lobby' || typeof msg !== 'object' || !msg) return;
      if (msg.mapId === 'stadium' || msg.mapId === 'arena') this.state.mapId = msg.mapId;
      if (typeof msg.aiFill === 'boolean') this.state.aiFill = msg.aiFill;
      if (Number.isInteger(msg.aiCount) && msg.aiCount >= 0 && msg.aiCount <= 7) this.state.aiCount = msg.aiCount;
      if (['easy', 'normal', 'hard'].includes(msg.aiDifficulty)) this.state.aiDifficulty = msg.aiDifficulty;
      this.updateMetadata();
    }));

    this.onMessage(MSG.START, guard((client) => {
      if (!this.isHost(client) || this.state.phase !== 'lobby') return;
      const notReady = [...this.state.players.values()].filter((p) => p.connected && !p.ready && p.id !== client.sessionId);
      if (notReady.length) { client.send(MSG.NOTICE, `Waiting for ${notReady.map((p) => p.name).join(', ')} to be ready`); return; }
      this.startLoading();
    }));

    this.onMessage(MSG.LOADED, guard((client) => {
      const p = this.player(client);
      if (!p || this.state.phase !== 'loading') return;
      p.loaded = true;
      this.maybeBeginRace();
    }));

    // A reconnected client asks for the race setup again once its handlers are registered.
    this.onMessage(MSG.RESYNC, guard((client) => {
      if (this.session && (this.state.phase === 'racing' || this.state.phase === 'loading')) client.send(MSG.RACE_INIT, this.raceInitFor(client.sessionId));
      else if (this.state.phase === 'results' && this.session) client.send(MSG.RESULTS, this.session.results());
    }));

    this.onMessage(MSG.BACK_TO_LOBBY, guard((client) => {
      if (this.state.phase === 'results' && this.isHost(client)) this.returnToLobby();
    }));

    this.onMessage(MSG.PING, guard((client, msg: any) => {
      client.send(MSG.PONG, { t: msg?.t ?? 0 });
      const p = this.player(client);
      if (p && Number.isFinite(msg?.rtt)) p.ping = Math.max(0, Math.min(9999, Math.round(msg.rtt)));
    }));

    this.onMessage(MSG.EMOTE, guard((client, msg: unknown) => {
      const now = Date.now();
      if (now - (this.lastEmote.get(client.sessionId) ?? 0) < 1000) return;
      if (typeof msg !== 'string' || !COSMETICS.some((c) => c.id === msg && c.category === 'emote')) return;
      this.lastEmote.set(client.sessionId, now);
      const idx = this.session ? this.session.indexOf(client.sessionId) : -1;
      this.broadcast(MSG.EMOTE, { from: client.sessionId, idx, id: msg });
    }));
  }

  onJoin(client: Client, options: JoinOptions) {
    const p = new PlayerInfo();
    p.id = client.sessionId;
    p.name = sanitizeName(options?.name);
    p.animal = Number.isInteger(options?.animal) && options.animal! >= 0 && options.animal! < ANIMALS.length ? options.animal! : 0;
    p.cosmetics = encodeLoadout(decodeLoadout(String(options?.cosmetics ?? '')));
    p.joinOrder = this.joinCounter++;
    if (!this.state.hostId || !this.state.players.has(this.state.hostId)) { this.state.hostId = client.sessionId; p.isHost = true; }
    this.state.players.set(client.sessionId, p);
    console.log(`[room ${this.roomId}] join ${p.name} (${client.sessionId}) players=${this.state.players.size}`);
  }

  async onLeave(client: Client, consented: boolean) {
    const p = this.player(client);
    if (!p) return;
    this.limiter.remove(client.sessionId);
    const inRace = this.state.phase === 'loading' || this.state.phase === 'racing';
    p.connected = false;
    if (!consented) {
      try {
        console.log(`[room ${this.roomId}] ${p.name} dropped, holding slot for reconnection`);
        await this.allowReconnection(client, inRace ? RECONNECT_SECONDS_RACE : RECONNECT_SECONDS_LOBBY);
        p.connected = true;
        console.log(`[room ${this.roomId}] ${p.name} reconnected`);
        return;
      } catch { /* reconnection window expired */ }
    }
    if (this.session && (this.state.phase === 'racing' || this.state.phase === 'loading')) {
      const idx = this.session.replaceWithAI(client.sessionId);
      if (idx >= 0) this.broadcast(MSG.NOTICE, `${p.name} left — replaced by AI`);
    }
    this.state.players.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) this.reassignHost();
    this.maybeBeginRace();
  }

  onDispose() {
    if (this.loadTimer) clearTimeout(this.loadTimer);
    if (this.resultsTimer) clearTimeout(this.resultsTimer);
    console.log(`[room ${this.roomId}] disposed`);
  }

  private reassignHost() {
    const next = [...this.state.players.values()].filter((p) => p.connected).sort((a, b) => a.joinOrder - b.joinOrder)[0]
      ?? [...this.state.players.values()].sort((a, b) => a.joinOrder - b.joinOrder)[0];
    this.state.players.forEach((p) => (p.isHost = false));
    if (next) { next.isHost = true; this.state.hostId = next.id; } else this.state.hostId = '';
  }

  // ------------------------------------------------------------------ race flow
  private startLoading() {
    const humans = [...this.state.players.values()].filter((p) => p.connected).sort((a, b) => a.joinOrder - b.joinOrder);
    if (!humans.length) return;
    const aiCount = this.state.aiFill ? Math.min(this.state.aiCount, MAX_PLAYERS - humans.length) : 0;
    const seed = (Math.random() * 1e9) | 0;
    this.session = new RaceSession(
      this.state.mapId, seed,
      humans.map((p) => ({ sessionId: p.id, name: p.name, animal: p.animal, cosmetics: p.cosmetics })),
      aiCount, this.state.aiDifficulty as Difficulty,
    );
    this.state.players.forEach((p) => (p.loaded = false));
    this.state.phase = 'loading';
    this.state.raceNumber++;
    this.state.notice = '';
    this.autoStartAt = 0;
    this.lock();
    this.updateMetadata();
    for (const c of this.clients) c.send(MSG.RACE_INIT, this.raceInitFor(c.sessionId));
    this.loadTimer = setTimeout(() => this.beginRace(), LOAD_TIMEOUT_MS);
    console.log(`[room ${this.roomId}] race ${this.state.raceNumber} loading: ${humans.length} humans + ${aiCount} AI on ${this.state.mapId}`);
  }

  private raceInitFor(sessionId: string): RaceInitMsg {
    const s = this.session!;
    return { trackId: s.trackId, seed: s.seed, startTick: s.sim.startTick, tick: s.sim.tick, racers: s.racers, myIdx: s.indexOf(sessionId) };
  }

  private maybeBeginRace() {
    if (this.state.phase !== 'loading') return;
    const waiting = [...this.state.players.values()].some((p) => p.connected && !p.loaded);
    if (!waiting) this.beginRace();
  }

  private beginRace() {
    if (this.state.phase !== 'loading' || !this.session) return;
    if (this.loadTimer) { clearTimeout(this.loadTimer); this.loadTimer = null; }
    this.state.phase = 'racing';
    this.session.running = true; // sim begins at tick 0; countdown lasts until sim.startTick
    this.raceWallStart = Date.now();
    this.lastDiag = Date.now();
    this.updateMetadata();
  }

  private update(deltaMs: number) {
    // quick-match auto start: once every connected human is ready
    if (this.quick && this.state.phase === 'lobby') {
      const ps = [...this.state.players.values()].filter((p) => p.connected);
      const allReady = ps.length > 0 && ps.every((p) => p.ready);
      if (allReady) {
        if (!this.autoStartAt) { this.autoStartAt = Date.now() + 3000; this.state.notice = 'Everyone is ready — starting in 3…'; }
        else if (Date.now() >= this.autoStartAt) this.startLoading();
      } else if (this.autoStartAt) { this.autoStartAt = 0; this.state.notice = ''; }
    }

    const s = this.session;
    if (!s || this.state.phase !== 'racing') return;
    const ticks = s.update(deltaMs);
    // server health diagnostics: race clock vs wall clock every 10 s
    if (!this.raceWallStart) this.raceWallStart = Date.now();
    if (Date.now() - this.lastDiag > 10000) {
      this.lastDiag = Date.now();
      const wall = (Date.now() - this.raceWallStart) / 1000;
      console.log(`[room ${this.roomId}] diag: sim tick ${s.sim.tick} (${(s.sim.tick / 60).toFixed(1)}s) wall ${wall.toFixed(1)}s catch-up ticks ${s.lagTicks}`);
    }
    if (ticks > 0) {
      this.snapCounter += ticks;
      if (this.snapCounter >= SNAPSHOT_EVERY_TICKS || s.over) {
        this.snapCounter = 0;
        this.sendSnapshots();
      }
    }
    if (s.over) this.finishRace();
  }

  private sendSnapshots() {
    const s = this.session!;
    const common = encodeSnapshotCommon(s.sim);
    for (const c of this.clients) {
      const idx = s.indexOf(c.sessionId);
      const msg = idx >= 0 ? common.concat(encodeOwnState(s.sim.racers[idx], s.ackSeq(idx), s.ticksSinceAck(idx))) : common;
      c.send(MSG.SNAP, msg);
    }
    if (s.pendingEvents.length) {
      this.broadcast(MSG.EVENTS, encodeEvents(s.sim.tick, s.pendingEvents));
      s.pendingEvents = [];
    }
  }

  private finishRace() {
    const s = this.session!;
    const results = s.results();
    this.state.phase = 'results';
    this.state.players.forEach((p) => (p.ready = false));
    this.broadcast(MSG.RESULTS, results);
    this.updateMetadata();
    console.log(`[room ${this.roomId}] race finished:`, results.entries.map((e) => `${e.place}.${e.name}${e.isAI ? '[AI]' : ''} ${e.time.toFixed(2)}s`).join(' | '));
    this.resultsTimer = setTimeout(() => this.returnToLobby(), RESULTS_AUTO_RETURN_MS);
  }

  private returnToLobby() {
    if (this.resultsTimer) { clearTimeout(this.resultsTimer); this.resultsTimer = null; }
    this.session = null;
    this.state.phase = 'lobby';
    this.state.players.forEach((p) => { p.ready = false; p.loaded = false; });
    if (this.quick && this.clients.length < MAX_PLAYERS) this.unlock();
    this.updateMetadata();
  }
}

void config;
