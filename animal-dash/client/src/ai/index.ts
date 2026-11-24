// AI opponents live in /shared/src/ai.ts so that the *same* bot code runs on the
// authoritative server (online AI fill) and in single-player (physics/localRace.ts).
// This module re-exports it for client-side use.
export { AIController, createAIs, PERSONALITIES, AI_NAMES } from '@shared/ai';
export type { Difficulty, Personality } from '@shared/ai';
