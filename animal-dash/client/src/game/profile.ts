// Player profile & progression. Stored locally today behind a small ProfileStore interface
// so a server/database-backed store (accounts, leaderboards, friends) can replace it later.
import { PlayerProfile, DEFAULT_LOADOUT, COSMETICS, Loadout, encodeLoadout } from '@shared/progression';
import { ResultEntry } from '@shared/protocol';
import { AudioSettings } from '../audio/audio';

export interface ProfileStore { load(): PlayerProfile; save(p: PlayerProfile): void; }

const KEY = 'animaldash.profile.v1';
const SETTINGS_KEY = 'animaldash.settings.v1';

export class LocalProfileStore implements ProfileStore {
  load(): PlayerProfile {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as PlayerProfile;
        if (p.version === 1) return { ...fresh(), ...p, loadout: { ...DEFAULT_LOADOUT, ...p.loadout } };
      }
    } catch { /* corrupted or unavailable storage */ }
    return fresh();
  }
  save(p: PlayerProfile): void { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ } }
}

function fresh(): PlayerProfile {
  const id = (crypto as any).randomUUID ? crypto.randomUUID() : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    version: 1, playerId: id, displayName: `Racer${Math.floor(100 + Math.random() * 900)}`, selectedAnimal: 0, coins: 150,
    unlocked: COSMETICS.filter((c) => c.price === 0).map((c) => c.id), loadout: { ...DEFAULT_LOADOUT },
    stats: { races: 0, wins: 0, losses: 0, bestTimes: {}, totalCoins: 0 },
  };
}

export interface GameSettings { audio: AudioSettings; shadows: boolean; renderScale: number; showFps: boolean; cameraShake: boolean; antialias: boolean; }
const DEFAULT_SETTINGS: GameSettings = { audio: { master: 0.8, music: 0.55, sfx: 0.8, muted: false }, shadows: true, renderScale: 1, showFps: true, cameraShake: true, antialias: true };

class ProfileManager {
  private store: ProfileStore = new LocalProfileStore();
  profile: PlayerProfile = this.store.load();
  settings: GameSettings = loadSettings();
  constructor() { this.save(); } // persist a freshly created profile (stable player id)
  save(): void { this.store.save(this.profile); }
  saveSettings(): void { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ } }
  loadoutString(): string { return encodeLoadout(this.profile.loadout); }
  owns(id: string): boolean { return this.profile.unlocked.includes(id); }
  buy(id: string): boolean {
    const c = COSMETICS.find((x) => x.id === id);
    if (!c || this.owns(id) || this.profile.coins < c.price) return false;
    this.profile.coins -= c.price;
    this.profile.unlocked.push(id);
    this.save();
    return true;
  }
  equip(cat: keyof Loadout, id: string): void {
    if (cat === 'emotes') return;
    (this.profile.loadout as any)[cat] = (this.profile.loadout as any)[cat] === id && cat !== 'victory' ? '' : id;
    this.save();
  }
  emotes(): string[] { return COSMETICS.filter((c) => c.category === 'emote' && this.owns(c.id)).map((c) => c.id).slice(0, 4); }
  recordResult(e: ResultEntry, trackId: string): void {
    const p = this.profile;
    p.stats.races++;
    if (e.place === 1) p.stats.wins++; else p.stats.losses++;
    if (e.finished) {
      const best = p.stats.bestTimes[trackId];
      if (!best || e.time < best) p.stats.bestTimes[trackId] = e.time;
    }
    p.coins += e.coins;
    p.stats.totalCoins += e.coins;
    this.save();
  }
}

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) { const s = JSON.parse(raw); return { ...DEFAULT_SETTINGS, ...s, audio: { ...DEFAULT_SETTINGS.audio, ...s.audio } }; }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio } };
}

export const profiles = new ProfileManager();
