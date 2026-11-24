// Colyseus connection manager: matchmaking (quick match / create / join by code),
// latency monitoring, automatic reconnection and a small message bus for screens.
import { Client, Room } from 'colyseus.js';
import { MSG } from '@shared/protocol';
import { serverUrl, httpUrl } from './config';

export type NetStatus = 'offline' | 'connecting' | 'online' | 'reconnecting' | 'error';
type Handler = (msg: any) => void;

export interface JoinOpts { name: string; animal: number; cosmetics: string; }

export class NetClient {
  room: Room | null = null;
  status: NetStatus = 'offline';
  lastError = '';
  rtt = 0;
  private client: Client | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private pingTimer: number | null = null;
  private intentionalLeave = false;
  onStatus: (s: NetStatus) => void = () => {};
  onStateChange: () => void = () => {};
  onLeft: (reason: string) => void = () => {};

  private setStatus(s: NetStatus) { this.status = s; this.onStatus(s); }

  on(type: string, h: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(h);
    return () => set!.delete(h);
  }
  private emit(type: string, msg: any) { this.handlers.get(type)?.forEach((h) => h(msg)); }

  async checkServer(): Promise<boolean> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(httpUrl(serverUrl()) + '/health', { signal: ctl.signal });
      clearTimeout(t);
      return r.ok;
    } catch { return false; }
  }

  private getClient(): Client {
    if (!this.client) this.client = new Client(serverUrl());
    return this.client;
  }

  async quickMatch(o: JoinOpts): Promise<Room> { return this.connect(() => this.getClient().joinOrCreate('race', { ...o })); }
  async createRoom(o: JoinOpts): Promise<Room> { return this.connect(() => this.getClient().create('race', { ...o, private: true })); }
  async joinRoom(code: string, o: JoinOpts): Promise<Room> {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return this.connect(() => this.getClient().joinById(clean, { ...o }));
  }

  private async connect(fn: () => Promise<Room>): Promise<Room> {
    this.client = null; // pick up server URL changes
    this.setStatus('connecting');
    try {
      const room = await fn();
      this.attach(room);
      this.setStatus('online');
      return room;
    } catch (e: any) {
      this.lastError = friendlyError(e);
      this.setStatus('error');
      throw new Error(this.lastError);
    }
  }

  private attach(room: Room): void {
    this.room = room;
    this.intentionalLeave = false;
    for (const t of Object.values(MSG)) room.onMessage(t, (m: any) => this.handle(t, m));
    room.onStateChange(() => this.onStateChange());
    room.onError((code, message) => { console.warn('room error', code, message); });
    room.onLeave((code) => this.handleLeave(code));
    this.startPing();
  }

  private handle(type: string, m: any): void {
    if (type === MSG.PONG) { this.rtt = Math.round(performance.now() - (m?.t ?? 0)); return; }
    this.emit(type, m);
  }

  private startPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    const tick = () => { if (this.room && this.status === 'online') this.room.send(MSG.PING, { t: performance.now(), rtt: this.rtt }); };
    tick();
    this.pingTimer = window.setInterval(tick, 2000);
  }

  private async handleLeave(code: number): Promise<void> {
    const room = this.room;
    if (this.intentionalLeave || !room || code === 4000 || code === 1000) {
      this.cleanup();
      this.onLeft(this.intentionalLeave ? 'left' : 'closed');
      return;
    }
    if (code === 4008) { this.cleanup(); this.onLeft('kicked (rate limit)'); return; }
    // unexpected disconnect: try to reconnect inside the server's grace period
    this.setStatus('reconnecting');
    const token = room.reconnectionToken;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((r) => setTimeout(r, 800 + attempt * 600));
      try {
        const r2 = await this.getClient().reconnect(token);
        this.attach(r2);
        this.setStatus('online');
        r2.send(MSG.RESYNC);
        this.emit('reconnected', null);
        return;
      } catch { /* retry */ }
    }
    this.cleanup();
    this.lastError = 'Connection lost';
    this.setStatus('error');
    this.onLeft('connection lost');
  }

  send(type: string, msg?: unknown): void { if (this.room && this.status === 'online') this.room.send(type, msg); }

  async leave(): Promise<void> {
    this.intentionalLeave = true;
    const r = this.room;
    if (r) { try { await r.leave(true); } catch { /* ignore */ } }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
    this.room = null;
    if (this.status !== 'error') this.setStatus('offline');
  }
}

function friendlyError(e: any): string {
  if (typeof Event !== 'undefined' && e instanceof Event) return `Cannot reach the game server (${serverUrl()}).`;
  const m = String(e?.message ?? e ?? '');
  if (m.includes('[object ')) return `Cannot reach the game server (${serverUrl()}).`;
  if (/not found|invalid|no rooms/i.test(m)) return 'Room not found. Check the code and try again.';
  if (/locked|full/i.test(m)) return 'That room is full or the race already started.';
  if (/Failed to fetch|NetworkError|ECONNREFUSED|socket|connect/i.test(m) || m === '') return `Cannot reach the game server (${serverUrl()}).`;
  return m;
}

export const net = new NetClient();
