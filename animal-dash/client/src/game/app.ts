// Application flow: Main Menu -> Character -> Map -> Mode -> Loading -> Countdown -> Race ->
// Results -> Replay/Lobby, plus online Quick Match / Private Rooms / Lobby, Garage, Settings.
import { Renderer } from '../engine/renderer';
import { MenuScene, Showcase } from './menuScene';
import { RaceScene, getTrackVisuals } from './raceScene';
import { RaceSource } from './raceSource';
import { LocalRace } from '../physics/localRace';
import { NetRace } from '../network/netRace';
import { net } from '../network/netClient';
import { serverUrl, serverOverride, setServerOverride } from '../network/config';
import { input } from './input';
import { profiles } from './profile';
import { audio } from '../audio/audio';
import { h, clear, fmtTime, portraits, ordinal } from '../ui/dom';
import { ANIMALS, DERIVED } from '@shared/animals';
import { TRACK_DEFS } from '@shared/tracks';
import { TrackPath } from '../tracks/trackPath';
import { MSG, RaceInitMsg, ResultsMsg } from '@shared/protocol';
import { COSMETICS, CATEGORY_LABELS, CosmeticCategory, Loadout, decodeLoadout } from '@shared/progression';
import type { Difficulty } from '@shared/ai';
import { ITEM_INFO } from '@shared/constants';

type Screen = 'menu' | 'char' | 'map' | 'mode' | 'race' | 'results' | 'online' | 'lobby' | 'garage' | 'settings' | 'tracks' | 'loading';

export class App {
  private ui: HTMLElement;
  private overlay: HTMLElement;
  private screen: Screen = 'menu';
  private race: RaceScene | null = null;
  private source: RaceSource | null = null;
  private paused = false;
  private pauseEl: HTMLElement | null = null;
  private sp = { animal: profiles.profile.selectedAnimal, trackId: 'stadium', aiCount: 5, difficulty: 'normal' as Difficulty };
  private charReturn: () => void = () => this.showMenu();
  private charConfirm: (a: number) => void = () => {};
  private lastResults: ResultsMsg | null = null;
  private recorded = false;
  private serverOnline: boolean | null = null;
  private statusEl: HTMLElement | null = null;
  private lobbyUnsub: (() => void)[] = [];
  private resultsShownFor: ResultsMsg | null = null;
  perf = { frames: 0, sum: 0, min: 999, max: 0, samples: [] as number[] };

  constructor(private r: Renderer, private menu: MenuScene, root: HTMLElement) {
    this.overlay = h('div', { class: 'overlay' });
    this.ui = h('div', { class: 'ui' });
    root.append(this.overlay, this.ui);
    input.onPause = () => this.togglePause();
    input.onEmote = (n) => this.emote(n);
    net.onStatus = () => this.renderStatus();
    net.onStateChange = () => this.onRoomState();
    net.onLeft = (reason) => this.onNetLeft(reason);
    net.on(MSG.RACE_INIT, (m: RaceInitMsg) => this.onRaceInit(m));
    net.on(MSG.NOTICE, (m: string) => this.toast(String(m)));
    net.on(MSG.EMOTE, (m: { idx: number; id: string }) => {
      const icon = COSMETICS.find((c) => c.id === m.id)?.icon ?? '👋';
      if (this.race && m.idx >= 0) this.race.showEmote(m.idx, icon);
    });
    document.addEventListener('pointerdown', () => audio.unlock(), { once: false });
    document.addEventListener('keydown', () => audio.unlock());
    audio.settings = profiles.settings.audio;
    r.shadowsEnabled = profiles.settings.shadows;
    r.renderScale = profiles.settings.renderScale;
    this.checkServer();
    this.showMenu();
  }

  // ------------------------------------------------------------------ frame
  frame(dt: number): void {
    if (this.race && this.source) {
      const inp = input.poll();
      if (!this.paused || this.source.online) this.source.update(dt, inp);
      this.race.update(this.paused && !this.source.online ? 0 : dt);
      if (this.source.isOver() && this.screen === 'race') {
        const res = this.source.results();
        if (res && res !== this.resultsShownFor) { this.resultsShownFor = res; setTimeout(() => this.showResults(res), 900); }
      }
      // perf stats (race only)
      const ms = dt * 1000;
      this.perf.frames++; this.perf.sum += ms; this.perf.max = Math.max(this.perf.max, ms);
      if (this.perf.samples.length < 20000) this.perf.samples.push(ms);
    } else this.menu.update(dt);
  }

  // ------------------------------------------------------------------ helpers
  private setScreen(s: Screen, el: HTMLElement | null): void {
    this.screen = s;
    clear(this.ui);
    if (el) this.ui.append(el);
    this.ui.className = `ui screen-${s}`;
  }
  private btn(label: string, on: () => void, cls = ''): HTMLButtonElement {
    return h('button', { class: `btn ${cls}`, onclick: () => { audio.unlock(); audio.play('click'); on(); } }, label);
  }
  toast(text: string): void {
    const t = h('div', { class: 'toast' }, text);
    document.body.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }
  private coins(): HTMLElement { return h('div', { class: 'coins' }, '🪙 ', String(profiles.profile.coins)); }
  private statusBadge(): HTMLElement {
    this.statusEl = h('div', { class: 'conn' });
    this.renderStatus();
    return this.statusEl;
  }
  private renderStatus(): void {
    const el = this.statusEl;
    if (!el) return;
    const s = net.status;
    let label: string, cls: string;
    if (s === 'online') { label = `Online · ${net.rtt} ms`; cls = 'good'; }
    else if (s === 'connecting') { label = 'Connecting…'; cls = 'ok'; }
    else if (s === 'reconnecting') { label = 'Reconnecting…'; cls = 'ok'; }
    else if (this.serverOnline === null) { label = 'Checking server…'; cls = 'ok'; }
    else if (this.serverOnline) { label = 'Server online'; cls = 'good'; }
    else { label = 'Server offline'; cls = 'bad'; }
    el.className = `conn ${cls}`;
    el.textContent = `● ${label}`;
    el.title = serverUrl();
  }
  private async checkServer(): Promise<void> {
    this.serverOnline = await net.checkServer();
    this.renderStatus();
  }
  private header(title: string, back?: () => void): HTMLElement {
    return h('div', { class: 'header' }, back ? this.btn('◀ Back', back, 'back') : null, h('h2', {}, title), h('div', { class: 'spacer' }), this.coins());
  }

  // ------------------------------------------------------------------ main menu
  showMenu(): void {
    this.endRace();
    audio.startMusic('menu');
    this.menu.set('lineup', ANIMALS.map((_, i) => ({ animal: i, loadout: i === profiles.profile.selectedAnimal ? profiles.profile.loadout : null })));
    const p = profiles.profile;
    const nameInput = h('input', { class: 'name-input', value: p.displayName, maxlength: 16, 'aria-label': 'Display name' }) as HTMLInputElement;
    nameInput.addEventListener('change', () => { p.displayName = nameInput.value.replace(/[<>&"'`\\]/g, '').trim().slice(0, 16) || p.displayName; nameInput.value = p.displayName; profiles.save(); });
    const el = h('div', { class: 'menu' },
      h('div', { class: 'logo' }, h('div', { class: 'logo-top' }, '🐾 ANIMAL DASH'), h('div', { class: 'logo-sub' }, 'ULTIMATE RACE')),
      h('div', { class: 'menu-buttons' },
        this.btn('▶ PLAY', () => this.pickCharacter(() => this.showMenu(), (a) => { this.sp.animal = a; this.showMapSelect(); }), 'primary big'),
        this.btn('⚡ QUICK MATCH', () => this.quickMatch(), 'big'),
        this.btn('🔑 CREATE / JOIN ROOM', () => this.showOnline(), 'big'),
        h('div', { class: 'row' },
          this.btn('🐶 CHARACTERS', () => this.pickCharacter(() => this.showMenu(), (a) => { this.sp.animal = a; this.showMenu(); }, true)),
          this.btn('🏟 TRACKS', () => this.showTracks()),
        ),
        h('div', { class: 'row' }, this.btn('🎩 GARAGE', () => this.showGarage()), this.btn('⚙ SETTINGS', () => this.showSettings())),
      ),
      h('div', { class: 'profile-card' },
        h('label', {}, 'Name'), nameInput,
        h('div', { class: 'pstats' },
          h('span', {}, `🏁 ${p.stats.races} races`), h('span', {}, `🏆 ${p.stats.wins} wins`),
          h('span', {}, `⏱ Best: ${p.stats.bestTimes.stadium ? fmtTime(p.stats.bestTimes.stadium) : '--'} / ${p.stats.bestTimes.arena ? fmtTime(p.stats.bestTimes.arena) : '--'}`)),
        this.coins(),
      ),
      h('div', { class: 'menu-foot' }, this.statusBadge(), h('span', { class: 'hint' }, 'Arrows: lanes/jump/slide · SHIFT boost · SPACE item · E ability · ESC pause')),
    );
    this.setScreen('menu', el);
  }

  // ------------------------------------------------------------------ character select
  pickCharacter(back: () => void, confirm: (a: number) => void, viewOnly = false): void {
    this.charReturn = back; this.charConfirm = confirm;
    let sel = profiles.profile.selectedAnimal;
    const detail = h('div', { class: 'char-detail panel' });
    const cards = h('div', { class: 'char-cards' });
    const render = () => {
      this.menu.set('single', [{ animal: sel, loadout: profiles.profile.loadout }]);
      clear(cards);
      ANIMALS.forEach((a, i) => cards.append(h('button', { class: `char-card${i === sel ? ' sel' : ''}`, onclick: () => { audio.play('click'); sel = i; render(); } },
        portraits[i] ? h('img', { src: portraits[i] }) : h('div', { class: 'emoji' }, a.emoji), h('div', { class: 'cname' }, a.name), h('div', { class: 'ctitle' }, a.title))));
      const a = ANIMALS[sel];
      const d = DERIVED[sel];
      const bar = (label: string, v: number) => h('div', { class: 'stat' }, h('span', {}, label), h('div', { class: 'sbar' }, h('div', { class: 'sfill', style: { width: `${v * 10}%` } })), h('b', {}, `${v}/10`));
      clear(detail);
      detail.append(
        h('h3', {}, `${a.emoji} ${a.name}`), h('div', { class: 'subtitle' }, a.title),
        bar('Speed', a.stats.speed), bar('Acceleration', a.stats.accel), bar('Stamina', a.stats.stamina), bar('Jump', a.stats.jump), bar('Recovery', a.stats.recovery),
        h('div', { class: 'derived' }, `Top ${Math.round(d.maxSpeed * 3.6)} km/h · Stamina ${Math.round(d.staminaMax)} · Jump ${(d.jumpV * d.jumpV / 52).toFixed(1)} m`),
        h('div', { class: 'cols' },
          h('div', {}, h('h4', { class: 'good' }, 'Strengths'), h('ul', {}, a.strengths.map((s) => h('li', {}, s)))),
          h('div', {}, h('h4', { class: 'bad' }, 'Weaknesses'), h('ul', {}, a.weaknesses.map((s) => h('li', {}, s))))),
        h('div', { class: 'ability-box' }, h('b', {}, `✨ ${a.ability.name}`), h('p', {}, a.ability.desc),
          h('small', {}, a.ability.passive ? 'Passive · once per race' : `Key E · cooldown ${a.ability.cooldown}s · ${a.ability.cost} stamina`)),
      );
    };
    render();
    const el = h('div', { class: 'charsel' },
      this.header(viewOnly ? 'Characters' : 'Choose your animal', () => this.charReturn()),
      h('div', { class: 'char-body' }, h('div', { class: 'drag-hint' }, '⟲ drag to rotate'), detail),
      cards,
      h('div', { class: 'footer' }, this.btn(viewOnly ? 'SELECT' : 'CONFIRM ▶', () => {
        profiles.profile.selectedAnimal = sel; profiles.save(); this.charConfirm(sel);
      }, 'primary big')),
    );
    this.setScreen('char', el);
  }

  // ------------------------------------------------------------------ map select / tracks
  private trackCard(def: typeof TRACK_DEFS[number], selected: boolean, onClick?: () => void): HTMLElement {
    const cv = h('canvas', { width: 300, height: 170, class: 'track-preview' }) as HTMLCanvasElement;
    const path = new TrackPath(def);
    const ctx = cv.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 170);
    g.addColorStop(0, def.id === 'stadium' ? '#4fae3f' : '#7bd46a'); g.addColorStop(1, def.id === 'stadium' ? '#2f7a2a' : '#3f9a3a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 300, 170);
    const b = path.bounds; const sc = Math.min(260 / (b.maxX - b.minX), 140 / (b.maxZ - b.minZ));
    const P = [0, 0, 0];
    ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.strokeStyle = def.id === 'stadium' ? '#d2543f' : '#9b7bff';
    ctx.beginPath();
    for (let s = 0; s <= path.lapLength; s += 4) { path.point(s, 0, 0, P); const x = 300 - (20 + (P[0] - b.minX) * sc + (260 - (b.maxX - b.minX) * sc) / 2), y = 15 + (P[2] - b.minZ) * sc + (140 - (b.maxZ - b.minZ) * sc) / 2; s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    return h('div', { class: `track-card panel${selected ? ' sel' : ''}`, onclick: onClick },
      cv, h('h3', {}, def.name), h('div', { class: 'subtitle' }, def.subtitle),
      h('div', { class: 'tmeta' }, h('span', {}, `Difficulty: ${def.difficulty}`), h('span', {}, `${def.laps} lap${def.laps > 1 ? 's' : ''} · ${Math.round(def.length)} m`)),
      h('p', {}, def.description));
  }

  showMapSelect(): void {
    const wrap = h('div', { class: 'track-cards' });
    const render = () => { clear(wrap); TRACK_DEFS.forEach((d) => wrap.append(this.trackCard(d, d.id === this.sp.trackId, () => { audio.play('click'); this.sp.trackId = d.id; render(); }))); };
    render();
    this.menu.set('single', [{ animal: this.sp.animal, loadout: profiles.profile.loadout }]);
    this.setScreen('map', h('div', { class: 'mapsel' }, this.header('Choose a track', () => this.pickCharacter(() => this.showMenu(), (a) => { this.sp.animal = a; this.showMapSelect(); })), wrap,
      h('div', { class: 'footer' }, this.btn('NEXT ▶', () => this.showModeSelect(), 'primary big'))));
  }

  showTracks(): void {
    const wrap = h('div', { class: 'track-cards' });
    TRACK_DEFS.forEach((d) => wrap.append(this.trackCard(d, false)));
    this.setScreen('tracks', h('div', { class: 'mapsel' }, this.header('Tracks', () => this.showMenu()), wrap));
  }

  showModeSelect(): void {
    const sp = this.sp;
    const count = h('div', { class: 'seg' });
    const diff = h('div', { class: 'seg' });
    const render = () => {
      clear(count); clear(diff);
      for (let n = 1; n <= 7; n++) count.append(h('button', { class: `segb${sp.aiCount === n ? ' on' : ''}`, onclick: () => { sp.aiCount = n; render(); } }, String(n)));
      (['easy', 'normal', 'hard'] as Difficulty[]).forEach((d) => diff.append(h('button', { class: `segb${sp.difficulty === d ? ' on' : ''}`, onclick: () => { sp.difficulty = d; render(); } }, d.toUpperCase())));
    };
    render();
    const def = TRACK_DEFS.find((d) => d.id === sp.trackId)!;
    this.setScreen('mode', h('div', { class: 'modesel' }, this.header('Race setup', () => this.showMapSelect()),
      h('div', { class: 'panel setup' },
        h('h3', {}, 'Single Player vs AI'),
        h('div', { class: 'kv' }, h('span', {}, 'Animal'), h('b', {}, ANIMALS[sp.animal].name)),
        h('div', { class: 'kv' }, h('span', {}, 'Track'), h('b', {}, def.name)),
        h('div', { class: 'kv' }, h('span', {}, 'AI opponents'), count),
        h('div', { class: 'kv' }, h('span', {}, 'AI difficulty'), diff),
        h('p', { class: 'hint' }, 'AI racers are always labelled 🤖 AI. Personalities: aggressive, defensive, speed-focused and balanced.'),
      ),
      h('div', { class: 'footer' }, this.btn('START RACE 🏁', () => this.startLocal(), 'primary big'))));
  }

  // ------------------------------------------------------------------ races
  private showLoading(text: string): void {
    this.setScreen('loading', h('div', { class: 'loading' }, h('div', { class: 'spinner' }, '🐾'), h('div', {}, text)));
  }

  startLocal(): void {
    this.showLoading('Building the track…');
    setTimeout(() => {
      getTrackVisuals(this.r.gl, this.sp.trackId);
      const src = new LocalRace({ trackId: this.sp.trackId, animal: this.sp.animal, name: profiles.profile.displayName, cosmetics: profiles.loadoutString(), aiCount: this.sp.aiCount, difficulty: this.sp.difficulty });
      this.beginRace(src);
    }, 30);
  }

  private beginRace(src: RaceSource): void {
    this.endRace();
    input.reset();
    input.enabled = true;
    this.source = src;
    this.race = new RaceScene(this.r, src, this.overlay);
    this.recorded = false;
    this.resultsShownFor = null;
    this.perf = { frames: 0, sum: 0, min: 999, max: 0, samples: [] };
    audio.startMusic('race');
    this.setScreen('race', null);
  }

  private endRace(): void {
    input.enabled = false;
    this.paused = false;
    this.pauseEl?.remove(); this.pauseEl = null;
    if (this.race) { this.race.dispose(); this.race = null; }
    if (this.source) { this.source.dispose(); this.source = null; }
  }

  private togglePause(): void {
    if (this.screen !== 'race' || !this.race) return;
    this.paused = !this.paused;
    input.enabled = !this.paused;
    if (this.paused) {
      const online = !!this.source?.online;
      this.pauseEl = h('div', { class: 'pause' }, h('div', { class: 'panel pause-panel' },
        h('h2', {}, 'Paused'),
        online ? h('p', { class: 'hint' }, 'Online race keeps running while paused!') : null,
        this.btn('▶ Resume', () => this.togglePause(), 'primary'),
        this.audioControls(),
        this.btn(online ? 'Leave race' : 'Quit to menu', () => { if (online) net.leave(); this.showMenu(); }, 'danger')));
      this.ui.append(this.pauseEl);
    } else { this.pauseEl?.remove(); this.pauseEl = null; }
  }

  private emote(n: number): void {
    const ems = profiles.emotes();
    const id = ems[n];
    if (!id || !this.race || !this.source) return;
    if (this.source.online) net.send(MSG.EMOTE, id);
    else this.race.showEmote(this.source.myIdx, COSMETICS.find((c) => c.id === id)!.icon);
  }

  // ------------------------------------------------------------------ results
  showResults(res: ResultsMsg): void {
    if (this.screen !== 'race') return;
    this.lastResults = res;
    const src = this.source!;
    const online = src.online;
    const myId = online ? net.room?.sessionId : 'local';
    const mine = res.entries.find((e) => e.playerId === myId);
    if (mine && !this.recorded) { profiles.recordResult(mine, res.trackId); this.recorded = true; }
    const perfSummary = this.perfSummary();
    console.info('[perf]', perfSummary);
    (window as any).__lastPerf = perfSummary;
    (window as any).__lastResults = res;
    if (online && src instanceof NetRace) (window as any).__netStats = { ...src.stats, rtt: net.rtt };
    this.endRace();
    audio.startMusic('menu');
    this.menu.set('podium', res.entries.slice(0, 3).map((e) => ({ animal: e.animal, loadout: e.playerId === myId ? profiles.profile.loadout : null })));
    const rows = res.entries.map((e) => h('tr', { class: e.playerId === myId ? 'me' : '' },
      h('td', { class: 'place' }, e.place <= 3 ? ['🥇', '🥈', '🥉'][e.place - 1] : ordinal(e.place)),
      h('td', {}, portraits[e.animal] ? h('img', { src: portraits[e.animal], class: 'res-img' }) : ANIMALS[e.animal].emoji),
      h('td', { class: 'rname' }, e.name, ' ', e.isAI ? h('span', { class: 'tag ai' }, '🤖 AI') : h('span', { class: 'tag human' }, e.playerId === myId ? 'YOU' : '👤 Player')),
      h('td', {}, e.finished ? fmtTime(e.time) : h('span', { class: 'dnf' }, `~${fmtTime(e.time)}`)),
      h('td', {}, String(e.items)), h('td', {}, String(e.avoided)), h('td', {}, String(e.boosts)),
      h('td', { class: 'coin' }, e.isAI ? '-' : `+${e.coins} 🪙`)));
    const isHost = online && (net.room?.state as any)?.hostId === net.room?.sessionId;
    const el = h('div', { class: 'results' },
      h('div', { class: 'res-title' }, mine ? (mine.place === 1 ? '🏆 VICTORY!' : `${ordinal(mine.place)} PLACE`) : 'RESULTS'),
      h('div', { class: 'panel res-panel' },
        h('table', {}, h('thead', {}, h('tr', {}, ...['#', '', 'Racer', 'Time', 'Items', 'Avoided', 'Boosts', 'Reward'].map((x) => h('th', {}, x)))), h('tbody', {}, rows)),
        mine ? h('div', { class: 'reward' }, `You earned ${mine.coins} coins · Total ${profiles.profile.coins} 🪙`) : null),
      h('div', { class: 'footer' },
        online
          ? (isHost ? this.btn('↩ RETURN TO LOBBY', () => net.send(MSG.BACK_TO_LOBBY), 'primary big') : h('div', { class: 'hint' }, 'Waiting for the host to return to the lobby…'))
          : this.btn('🔁 REPLAY', () => this.startLocal(), 'primary big'),
        online ? this.btn('Leave room', () => { net.leave(); this.showMenu(); }) : this.btn('Change setup', () => this.showModeSelect()),
        this.btn('Main menu', () => { if (online) net.leave(); this.showMenu(); }),
      ));
    this.setScreen('results', el);
  }

  perfSummary() {
    const s = this.perf.samples.slice().sort((a, b) => a - b);
    if (!s.length) return null;
    const avgMs = this.perf.sum / this.perf.frames;
    const p = (q: number) => s[Math.min(s.length - 1, Math.floor(s.length * q))];
    return { frames: this.perf.frames, avgFps: +(1000 / avgMs).toFixed(1), minFps: +(1000 / s[s.length - 1]).toFixed(1), p1LowFps: +(1000 / p(0.99)).toFixed(1),
      avgFrameMs: +avgMs.toFixed(2), p50Ms: +p(0.5).toFixed(2), p95Ms: +p(0.95).toFixed(2), p99Ms: +p(0.99).toFixed(2), maxMs: +s[s.length - 1].toFixed(2),
      heapMB: (performance as any).memory ? Math.round((performance as any).memory.usedJSHeapSize / 1048576) : null, draws: this.r.stats.draws, tris: this.r.stats.tris };
  }

  // ------------------------------------------------------------------ online
  private joinOpts() { return { name: profiles.profile.displayName, animal: profiles.profile.selectedAnimal, cosmetics: profiles.loadoutString() }; }

  private async quickMatch(): Promise<void> {
    this.showLoading('Finding a race…');
    try { await net.quickMatch(this.joinOpts()); } catch (e: any) { this.toast(e.message); this.showMenu(); return; }
    this.showLobby();
  }

  showOnline(): void {
    const code = h('input', { class: 'code-input', placeholder: 'DOG888', maxlength: 10 }) as HTMLInputElement;
    const err = h('div', { class: 'err' }, net.lastError && net.status === 'error' ? net.lastError : '');
    const join = async () => {
      if (!code.value.trim()) { err.textContent = 'Enter a room code'; return; }
      this.showLoading(`Joining ${code.value.toUpperCase()}…`);
      try { await net.joinRoom(code.value, this.joinOpts()); } catch (e: any) { this.showOnline(); this.toast(e.message); return; }
      this.showLobby();
    };
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    this.menu.set('lineup', ANIMALS.map((_, i) => ({ animal: i, loadout: null })));
    this.setScreen('online', h('div', { class: 'online' }, this.header('Play online', () => this.showMenu()),
      h('div', { class: 'online-cards' },
        h('div', { class: 'panel' }, h('h3', {}, '🔑 Create private room'), h('p', {}, 'Get a room code like DOG888 and share it with friends. Up to 8 racers; empty slots can be filled with AI.'),
          this.btn('CREATE ROOM', async () => {
            this.showLoading('Creating room…');
            try { await net.createRoom(this.joinOpts()); } catch (e: any) { this.toast(e.message); this.showOnline(); return; }
            this.showLobby();
          }, 'primary')),
        h('div', { class: 'panel' }, h('h3', {}, '🚪 Join with code'), code, this.btn('JOIN', join, 'primary'), err),
        h('div', { class: 'panel' }, h('h3', {}, '⚡ Quick match'), h('p', {}, 'Jump into any open public race room.'), this.btn('QUICK MATCH', () => this.quickMatch(), 'primary')),
      ),
      h('div', { class: 'menu-foot' }, this.statusBadge(), h('span', { class: 'hint' }, `Server: ${serverUrl()}`))));
  }

  showLobby(): void {
    this.endRace();
    audio.startMusic('menu');
    this.lobbyUnsub.forEach((u) => u()); this.lobbyUnsub = [];
    const el = h('div', { class: 'lobby' });
    this.setScreen('lobby', el);
    this.renderLobby();
  }

  private renderLobby(): void {
    if (this.screen !== 'lobby') return;
    const room = net.room;
    const el = this.ui.firstElementChild as HTMLElement;
    if (!room || !el) return;
    const st = room.state as any;
    if (!st || !st.players || typeof st.players.values !== 'function') {
      // state not synchronised yet; onStateChange will render again
      clear(el);
      el.append(h('div', { class: 'loading' }, h('div', { class: 'spinner' }, '🐾'), h('div', {}, 'Joining room…')));
      return;
    }
    const players = [...st.players.values()].sort((a: any, b: any) => a.joinOrder - b.joinOrder);
    const me = st.players.get(room.sessionId);
    const isHost = st.hostId === room.sessionId;
    const humans = players.length;
    const aiSlots = st.aiFill ? Math.min(st.aiCount, 8 - humans) : 0;
    this.menu.set('lobby', players.map((p: any) => ({ animal: p.animal, loadout: decodeLoadout(p.cosmetics) } as Showcase)));
    const slot = (p: any) => h('div', { class: `slot${p.id === room.sessionId ? ' me' : ''}${p.connected ? '' : ' dc'}` },
      portraits[p.animal] ? h('img', { src: portraits[p.animal] }) : h('span', {}, ANIMALS[p.animal].emoji),
      h('div', { class: 'sname' }, p.isHost ? '👑 ' : '', p.name, p.id === room.sessionId ? ' (you)' : ''),
      h('div', { class: 'sanimal' }, ANIMALS[p.animal].name),
      h('span', { class: 'tag human' }, '👤 Player'),
      h('div', { class: `ready ${p.ready || p.isHost ? 'yes' : 'no'}` }, p.isHost ? 'HOST' : p.ready ? 'READY' : 'NOT READY'),
      h('div', { class: 'sping' }, p.connected ? `${p.ping} ms` : 'reconnecting…'));
    const slots: HTMLElement[] = players.map(slot);
    for (let i = 0; i < aiSlots; i++) slots.push(h('div', { class: 'slot ai' }, h('div', { class: 'emoji' }, '🤖'), h('div', { class: 'sname' }, 'AI racer'), h('span', { class: 'tag ai' }, '🤖 AI'), h('div', { class: 'ready yes' }, 'AUTO')));
    while (slots.length < 8) slots.push(h('div', { class: 'slot empty' }, h('div', { class: 'sname' }, 'Open slot')));
    const def = TRACK_DEFS.find((d) => d.id === st.mapId)!;
    const setting = (label: string, ctrl: HTMLElement) => h('div', { class: 'kv' }, h('span', {}, label), ctrl);
    const send = (o: object) => net.send(MSG.SETTINGS, o);
    const mapCtl = h('div', { class: 'seg' }, ...TRACK_DEFS.map((d) => h('button', { class: `segb${st.mapId === d.id ? ' on' : ''}`, disabled: !isHost, onclick: () => send({ mapId: d.id }) }, d.name)));
    const aiCtl = h('div', { class: 'seg' }, h('button', { class: `segb${st.aiFill ? ' on' : ''}`, disabled: !isHost, onclick: () => send({ aiFill: !st.aiFill }) }, st.aiFill ? 'AI FILL ON' : 'AI FILL OFF'));
    const countCtl = h('div', { class: 'seg' }, ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => h('button', { class: `segb${st.aiCount === n ? ' on' : ''}`, disabled: !isHost, onclick: () => send({ aiCount: n }) }, String(n))));
    const diffCtl = h('div', { class: 'seg' }, ...['easy', 'normal', 'hard'].map((d) => h('button', { class: `segb${st.aiDifficulty === d ? ' on' : ''}`, disabled: !isHost, onclick: () => send({ aiDifficulty: d }) }, d.toUpperCase())));
    const allReady = players.every((p: any) => p.ready || p.isHost || !p.connected);
    clear(el);
    el.append(
      h('div', { class: 'header' }, this.btn('◀ Leave', () => { net.leave(); this.showMenu(); }, 'back'),
        h('h2', {}, st.isPrivate ? 'Private room' : 'Quick match'), h('div', { class: 'spacer' }), this.statusBadge()),
      h('div', { class: 'lobby-top' },
        h('div', { class: 'room-code panel' }, h('small', {}, 'ROOM CODE'), h('div', { class: 'code' }, st.code),
          this.btn('📋 Copy', () => { navigator.clipboard?.writeText(st.code).then(() => this.toast('Room code copied!'), () => this.toast(st.code)); }),
          h('small', {}, `${humans}/8 connected · max 8 racers`)),
        h('div', { class: 'panel lobby-settings' }, h('h4', {}, isHost ? 'Match settings (host)' : 'Match settings'),
          setting('Track', mapCtl), setting('AI', aiCtl), setting('AI count', countCtl), setting('AI level', diffCtl),
          h('div', { class: 'hint' }, `${def.name}: ${def.laps} lap${def.laps > 1 ? 's' : ''}, ${Math.round(def.length)} m`))),
      h('div', { class: 'slots' }, slots),
      h('div', { class: 'notice', style: { display: st.notice ? '' : 'none' } }, st.notice || ''),
      h('div', { class: 'footer' },
        this.btn('🐾 Change animal', () => this.pickCharacter(() => this.showLobby(), (a) => { net.send(MSG.ANIMAL, a); this.showLobby(); })),
        isHost ? null : this.btn(me?.ready ? '✔ READY' : 'READY', () => net.send(MSG.READY, !me?.ready), me?.ready ? 'ready-on big' : 'primary big'),
        isHost ? this.btn(st.isPrivate ? '🏁 START RACE' : '🏁 START NOW', () => { if (!allReady) this.toast('Waiting for players to be ready'); net.send(MSG.READY, true); net.send(MSG.START); }, `primary big${allReady ? '' : ' dim'}`) : null,
      ));
  }

  private onRoomState(): void {
    const st = net.room?.state as any;
    if (!st) return;
    if (this.screen === 'lobby') this.renderLobby();
    if (st.phase === 'lobby' && (this.screen === 'results' || this.screen === 'race')) this.showLobby();
  }

  private onRaceInit(m: RaceInitMsg): void {
    if (this.source instanceof NetRace) return; // already racing (reconnect resync handled by NetRace)
    this.showLoading('Loading race…');
    setTimeout(() => {
      getTrackVisuals(this.r.gl, m.trackId);
      const src = new NetRace(net, m);
      this.beginRace(src);
      net.send(MSG.LOADED);
    }, 30);
  }

  private onNetLeft(reason: string): void {
    if (reason === 'left') return;
    this.toast(`Disconnected: ${reason}`);
    if (this.screen === 'lobby' || (this.source && this.source.online)) this.showMenu();
  }

  // ------------------------------------------------------------------ garage
  showGarage(): void {
    let cat: CosmeticCategory = 'hat';
    const body = h('div', { class: 'garage-body' });
    const render = () => {
      this.menu.set('single', [{ animal: profiles.profile.selectedAnimal, loadout: { ...profiles.profile.loadout } }]);
      clear(body);
      const tabs = h('div', { class: 'tabs' }, ...(Object.keys(CATEGORY_LABELS) as CosmeticCategory[]).map((c) =>
        h('button', { class: `tab${c === cat ? ' on' : ''}`, onclick: () => { cat = c; render(); } }, CATEGORY_LABELS[c])));
      const grid = h('div', { class: 'grid' });
      for (const c of COSMETICS.filter((x) => x.category === cat)) {
        const owned = profiles.owns(c.id);
        const lo = profiles.profile.loadout as any;
        const equipped = cat === 'emote' ? owned : cat === 'victory' ? lo.victory === c.id : lo[cat] === c.id;
        grid.append(h('div', { class: `item panel${equipped ? ' eq' : ''}` },
          h('div', { class: 'icon' }, c.icon), h('div', { class: 'iname' }, c.name),
          owned
            ? (cat === 'emote' ? h('div', { class: 'owned' }, 'Owned (keys 1-4)') : this.btn(equipped ? (cat === 'victory' ? 'Equipped' : 'Unequip') : 'Equip', () => { profiles.equip(cat as keyof Loadout, c.id); render(); }, equipped ? '' : 'primary'))
            : this.btn(`Buy ${c.price} 🪙`, () => { if (profiles.buy(c.id)) { audio.play('item'); this.toast(`Unlocked ${c.name}!`); } else { audio.play('error'); this.toast('Not enough coins — win races to earn more!'); } render(); }, profiles.profile.coins >= c.price ? 'primary' : 'dim')));
      }
      body.append(tabs, grid, h('p', { class: 'hint' }, 'Cosmetics are purely visual and never affect gameplay. Earn coins by racing.'));
      const coinsEl = this.ui.querySelector('.coins');
      if (coinsEl) coinsEl.textContent = `🪙 ${profiles.profile.coins}`;
    };
    this.setScreen('garage', h('div', { class: 'garage' }, this.header('Garage', () => this.showMenu()), body));
    render();
  }

  // ------------------------------------------------------------------ settings
  private audioControls(): HTMLElement {
    const a = profiles.settings.audio;
    const slider = (label: string, key: 'master' | 'music' | 'sfx') => {
      const s = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: a[key] }) as HTMLInputElement;
      s.addEventListener('input', () => { a[key] = Number(s.value); audio.applySettings(); profiles.saveSettings(); });
      return h('div', { class: 'kv' }, h('span', {}, label), s);
    };
    const mute = h('input', { type: 'checkbox' }) as HTMLInputElement;
    mute.checked = a.muted;
    mute.addEventListener('change', () => { a.muted = mute.checked; audio.applySettings(); profiles.saveSettings(); });
    return h('div', { class: 'audio-ctl' }, slider('Master volume', 'master'), slider('Music volume', 'music'), slider('Sound effects', 'sfx'), h('label', { class: 'kv' }, h('span', {}, 'Mute all'), mute));
  }

  showSettings(): void {
    const s = profiles.settings;
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const c = h('input', { type: 'checkbox' }) as HTMLInputElement; c.checked = get();
      c.addEventListener('change', () => { set(c.checked); profiles.saveSettings(); });
      return h('label', { class: 'kv' }, h('span', {}, label), c);
    };
    const scale = h('select', {}, ...[[0.6, 'Performance (60%)'], [0.8, 'Balanced (80%)'], [1, 'Quality (100%)']].map(([v, l]) => h('option', { value: v, selected: s.renderScale === v }, String(l)))) as HTMLSelectElement;
    scale.addEventListener('change', () => { s.renderScale = Number(scale.value); this.r.renderScale = s.renderScale; profiles.saveSettings(); });
    const url = h('input', { class: 'url-input', value: serverOverride(), placeholder: serverUrl() }) as HTMLInputElement;
    this.setScreen('settings', h('div', { class: 'settings' }, this.header('Settings', () => this.showMenu()),
      h('div', { class: 'settings-cols' },
        h('div', { class: 'panel' }, h('h3', {}, '🔊 Audio'), this.audioControls()),
        h('div', { class: 'panel' }, h('h3', {}, '🖥 Graphics'),
          check('Shadows', () => s.shadows, (v) => { s.shadows = v; this.r.shadowsEnabled = v; }),
          h('div', { class: 'kv' }, h('span', {}, 'Resolution'), scale),
          check('Anti-aliasing (applies after reload)', () => s.antialias, (v) => (s.antialias = v)),
          check('Show FPS', () => s.showFps, (v) => (s.showFps = v)),
          check('Camera shake', () => s.cameraShake, (v) => (s.cameraShake = v))),
        h('div', { class: 'panel' }, h('h3', {}, '🌐 Network'),
          h('p', { class: 'hint' }, 'Advanced: override the game server address (leave empty for default).'), url,
          this.btn('Save server', () => { setServerOverride(url.value.trim()); this.toast(`Server: ${serverUrl()}`); this.checkServer(); }),
          h('p', { class: 'hint' }, `Current: ${serverUrl()}`),
          h('h3', {}, '🎮 Controls'),
          h('ul', { class: 'controls' }, ...[['← / →', 'Change lane'], ['↑', 'Jump (↓ in air = fast fall)'], ['↓', 'Slide / crouch'], ['SHIFT (hold)', 'Speed boost'], ['SPACE', 'Use power-up'], ['E', 'Special ability'], ['1-4', 'Emotes'], ['ESC', 'Pause'], ['Gamepad', 'D-pad/stick, A jump, B slide, RT boost, X item, Y ability']].map(([k, v]) => h('li', {}, h('kbd', {}, k), ' ', v))),
        ))));
    void ITEM_INFO;
  }
}
