import { matchMaker } from '@colyseus/core';

const PREFIXES = ['DOG', 'CAT', 'PUG', 'PAW', 'RUN', 'ZIP', 'WAG', 'MEW', 'BARK', 'DASH'];

/** Human-friendly, unique room codes such as DOG888. Used as the Colyseus roomId. */
export async function generateRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const p = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
    const code = `${p}${Math.floor(100 + Math.random() * 900)}`;
    const existing = await matchMaker.query({ roomId: code });
    if (existing.length === 0) return code;
  }
  return `RACE${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

export const sanitizeName = (n: unknown): string => {
  const s = typeof n === 'string' ? n : '';
  const clean = s.replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return clean || 'Racer';
};
