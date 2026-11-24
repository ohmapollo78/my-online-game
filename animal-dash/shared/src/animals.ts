// Animal definitions: statistics, abilities, and derived gameplay parameters.
// Stats are 1..10 and every stat feeds directly into the simulation (see deriveStats).

export interface AnimalStats { speed: number; accel: number; stamina: number; jump: number; recovery: number; }

export interface AbilityDef {
  id: 'ironbark' | 'icedash' | 'bullcharge' | 'ninelives' | 'shadowstep';
  name: string;
  desc: string;
  cooldown: number; // seconds
  cost: number; // stamina
  duration: number; // seconds
  passive: boolean;
}

export interface AnimalDef {
  id: string;
  name: string;
  title: string;
  emoji: string;
  stats: AnimalStats;
  /** 0..1 resistance to obstacle knockdowns / bumps */
  resist: number;
  /** 0..1 resistance to item attacks */
  attackResist: number;
  /** lateral lane-change speed (m/s) */
  agility: number;
  /** multiplier for lateral control while airborne */
  airControl: number;
  /** standing collision height (m) */
  height: number;
  /** body mass factor for bumping */
  mass: number;
  /** stride length (m) — used by the animation system so feet don't slide */
  stride: number;
  /** extra knockdown-time multiplier (cats recover fast) */
  knockMul: number;
  strengths: string[];
  weaknesses: string[];
  ability: AbilityDef;
}

export const ANIMALS: AnimalDef[] = [
  {
    id: 'pug', name: 'Pug', title: 'The Little Tank', emoji: '🐶',
    stats: { speed: 5, accel: 6, stamina: 9, jump: 5, recovery: 9 },
    resist: 0.55, attackResist: 0.45, agility: 10, airControl: 0.6, height: 0.85, mass: 1.35, stride: 0.75, knockMul: 1,
    strengths: ['Very high stamina', 'Excellent stamina recovery', 'Strong knockback resistance'],
    weaknesses: ['Low maximum speed', 'Short jump distance'],
    ability: { id: 'ironbark', name: 'IRON BARK', desc: 'For 4s, obstacles and attacks cannot knock you down.', cooldown: 16, cost: 15, duration: 4, passive: false },
  },
  {
    id: 'husky', name: 'Siberian Husky', title: 'The Speed Demon', emoji: '🐺',
    stats: { speed: 10, accel: 9, stamina: 5, jump: 8, recovery: 5 },
    resist: 0.15, attackResist: 0.2, agility: 12, airControl: 0.6, height: 1.1, mass: 1.0, stride: 1.7, knockMul: 1,
    strengths: ['Highest maximum speed', 'Excellent acceleration', 'Long jump distance'],
    weaknesses: ['High stamina consumption', 'Slow stamina recovery'],
    ability: { id: 'icedash', name: 'ICE DASH', desc: 'A powerful forward speed burst on a trail of ice.', cooldown: 11, cost: 22, duration: 1.3, passive: false },
  },
  {
    id: 'rottweiler', name: 'Rottweiler', title: 'The Powerhouse', emoji: '🐕',
    stats: { speed: 7, accel: 5, stamina: 8, jump: 6, recovery: 7 },
    resist: 0.45, attackResist: 0.5, agility: 7.5, airControl: 0.5, height: 1.15, mass: 1.9, stride: 1.45, knockMul: 1,
    strengths: ['Strong resistance to attacks', 'Powerful knockback on bumps', 'Good stamina'],
    weaknesses: ['Slow initial acceleration', 'Less agile lane movement'],
    ability: { id: 'bullcharge', name: 'BULL CHARGE', desc: 'Charge forward, smash small obstacles and shove rivals aside.', cooldown: 14, cost: 20, duration: 2.2, passive: false },
  },
  {
    id: 'orangecat', name: 'Orange Cat', title: 'The Agile Trickster', emoji: '🐱',
    stats: { speed: 8, accel: 8, stamina: 6, jump: 10, recovery: 6 },
    resist: 0.1, attackResist: 0.0, agility: 14, airControl: 0.85, height: 0.85, mass: 0.8, stride: 1.35, knockMul: 0.75,
    strengths: ['Highest jump ability', 'Excellent maneuverability', 'Fast obstacle recovery'],
    weaknesses: ['Low resistance to attacks', 'Moderate stamina'],
    ability: { id: 'ninelives', name: 'NINE LIVES', desc: 'Passive: automatically recovers instantly from one serious knockdown per race.', cooldown: 0, cost: 0, duration: 0, passive: true },
  },
  {
    id: 'blackcat', name: 'Black Cat', title: 'The Shadow Runner', emoji: '🐈‍⬛',
    stats: { speed: 8, accel: 9, stamina: 7, jump: 8, recovery: 7 },
    resist: 0.1, attackResist: 0.05, agility: 13.5, airControl: 1.0, height: 0.85, mass: 0.8, stride: 1.45, knockMul: 0.9,
    strengths: ['Excellent acceleration', 'High agility', 'Full control during jumps'],
    weaknesses: ['Low resistance to physical attacks', 'Lower stamina than Pug'],
    ability: { id: 'shadowstep', name: 'SHADOW STEP', desc: 'Become immune to item attacks for 2.5s with a short speed boost.', cooldown: 14, cost: 15, duration: 2.5, passive: false },
  },
];

export interface DerivedStats {
  maxSpeed: number;
  accel: number;
  staminaMax: number;
  drain: number;
  regen: number;
  jumpV: number;
  knockdownTime: number;
  stumbleTime: number;
}

export function deriveStats(a: AnimalDef): DerivedStats {
  const st = a.stats;
  return {
    maxSpeed: 22.5 + st.speed * 0.6,
    accel: 3 + st.accel * 1.3,
    staminaMax: 40 + st.stamina * 7,
    drain: 16 + (10 - st.stamina) * 3,
    regen: 2 + st.recovery * 1.6,
    jumpV: 6 + st.jump * 0.55,
    knockdownTime: (2.3 - st.recovery * 0.13) * a.knockMul,
    stumbleTime: 0.6 - st.recovery * 0.025,
  };
}

export const DERIVED: DerivedStats[] = ANIMALS.map(deriveStats);
