// Cosmetics catalogue, rewards and the player-profile shape.
// Cosmetics are purely visual — nothing here touches the simulation.

export type CosmeticCategory = 'hat' | 'glasses' | 'outfit' | 'accessory' | 'skin' | 'victory' | 'emote';

export interface Cosmetic { id: string; name: string; category: CosmeticCategory; price: number; icon: string; }

export const COSMETICS: Cosmetic[] = [
  { id: 'hat_cap', name: 'Racing Cap', category: 'hat', price: 0, icon: '🧢' },
  { id: 'hat_party', name: 'Party Hat', category: 'hat', price: 80, icon: '🥳' },
  { id: 'hat_beanie', name: 'Pom Beanie', category: 'hat', price: 120, icon: '🎿' },
  { id: 'hat_cowboy', name: 'Cowboy Hat', category: 'hat', price: 200, icon: '🤠' },
  { id: 'hat_top', name: 'Top Hat', category: 'hat', price: 250, icon: '🎩' },
  { id: 'hat_crown', name: 'Champion Crown', category: 'hat', price: 600, icon: '👑' },
  { id: 'gl_round', name: 'Round Specs', category: 'glasses', price: 90, icon: '👓' },
  { id: 'gl_sun', name: 'Shades', category: 'glasses', price: 120, icon: '🕶️' },
  { id: 'gl_goggles', name: 'Speed Goggles', category: 'glasses', price: 150, icon: '🥽' },
  { id: 'gl_star', name: 'Star Glasses', category: 'glasses', price: 200, icon: '⭐' },
  { id: 'out_scarf', name: 'Striped Scarf', category: 'outfit', price: 100, icon: '🧣' },
  { id: 'out_vest', name: 'Racing Vest', category: 'outfit', price: 150, icon: '🦺' },
  { id: 'out_jersey', name: 'Team Jersey', category: 'outfit', price: 200, icon: '👕' },
  { id: 'out_cape', name: 'Hero Cape', category: 'outfit', price: 300, icon: '🦸' },
  { id: 'acc_bowtie', name: 'Bow Tie', category: 'accessory', price: 60, icon: '🎀' },
  { id: 'acc_bell', name: 'Golden Bell', category: 'accessory', price: 80, icon: '🔔' },
  { id: 'acc_backpack', name: 'Mini Backpack', category: 'accessory', price: 180, icon: '🎒' },
  { id: 'acc_wings', name: 'Tiny Wings', category: 'accessory', price: 400, icon: '🪽' },
  { id: 'skin_candy', name: 'Candy Skin', category: 'skin', price: 300, icon: '🍬' },
  { id: 'skin_midnight', name: 'Midnight Skin', category: 'skin', price: 350, icon: '🌙' },
  { id: 'skin_gold', name: 'Golden Skin', category: 'skin', price: 500, icon: '🏆' },
  { id: 'vic_hop', name: 'Happy Hops', category: 'victory', price: 0, icon: '🐾' },
  { id: 'vic_spin', name: 'Twirl', category: 'victory', price: 150, icon: '🌀' },
  { id: 'vic_dance', name: 'Wiggle Dance', category: 'victory', price: 250, icon: '💃' },
  { id: 'vic_flip', name: 'Backflip', category: 'victory', price: 300, icon: '🤸' },
  { id: 'emo_wave', name: 'Wave', category: 'emote', price: 0, icon: '👋' },
  { id: 'emo_laugh', name: 'Laugh', category: 'emote', price: 50, icon: '😂' },
  { id: 'emo_gg', name: 'GG', category: 'emote', price: 80, icon: '🤝' },
  { id: 'emo_cool', name: 'Cool', category: 'emote', price: 100, icon: '😎' },
  { id: 'emo_angry', name: 'Grr!', category: 'emote', price: 100, icon: '💢' },
  { id: 'emo_heart', name: 'Love', category: 'emote', price: 120, icon: '❤️' },
];

export const CATEGORY_LABELS: Record<CosmeticCategory, string> = {
  hat: 'Hats', glasses: 'Glasses', outfit: 'Racing Outfits', accessory: 'Accessories', skin: 'Skins', victory: 'Victory Animations', emote: 'Emotes',
};

export interface Loadout { hat: string; glasses: string; outfit: string; accessory: string; skin: string; victory: string; emotes: string[]; }
export const DEFAULT_LOADOUT: Loadout = { hat: '', glasses: '', outfit: '', accessory: '', skin: '', victory: 'vic_hop', emotes: ['emo_wave'] };

/** Compact string sent over the network (only visual ids, validated against the catalogue). */
export function encodeLoadout(l: Loadout): string {
  return [l.hat, l.glasses, l.outfit, l.accessory, l.skin, l.victory].join(',');
}
export function decodeLoadout(s: string): Loadout {
  const ids = new Set(COSMETICS.map((c) => c.id));
  const p = (typeof s === 'string' ? s : '').slice(0, 200).split(',');
  const pick = (v: string | undefined) => (v && ids.has(v) ? v : '');
  return { hat: pick(p[0]), glasses: pick(p[1]), outfit: pick(p[2]), accessory: pick(p[3]), skin: pick(p[4]), victory: pick(p[5]) || 'vic_hop', emotes: [] };
}

export interface PlayerProfile {
  version: 1;
  playerId: string;
  displayName: string;
  selectedAnimal: number;
  coins: number;
  unlocked: string[];
  loadout: Loadout;
  stats: { races: number; wins: number; losses: number; bestTimes: Record<string, number>; totalCoins: number };
}

export function computeCoins(place: number, total: number, finished: boolean, items: number, avoided: number): number {
  let c = 20 + Math.max(0, total - place) * 12 + Math.min(items, 10) * 2 + Math.min(avoided, 40);
  if (place === 1) c += 50;
  if (finished) c += 10;
  return Math.round(c);
}
