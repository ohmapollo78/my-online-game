// A RaceSource feeds the race scene with racer render states, events and results.
// LocalRace (single player) and NetRace (online) both implement it, so the renderer,
// HUD and audio code are identical for both modes.
import { InputState, Racer, SimEvent } from '@shared/sim';
import { RacerInfo, ResultsMsg } from '@shared/protocol';
import { Track } from '@shared/track';
import { EntityView } from '../items/itemRenderer';

export interface RacerRender {
  idx: number;
  s: number; x: number; y: number; v: number; vy: number;
  state: number; flags: number; place: number; finished: boolean;
  lateral: number;
}

export interface RaceSource {
  readonly online: boolean;
  readonly track: Track;
  readonly infos: RacerInfo[];
  readonly myIdx: number;
  readonly render: RacerRender[];
  /** advance by real time; input is the local player's current input */
  update(dt: number, input: InputState): void;
  /** race clock (s since GO; negative during countdown) used to animate obstacles */
  time(): number;
  /** full local racer state (for the HUD) */
  me(): Racer;
  boxAvail(i: number): boolean;
  pickAvail(i: number): boolean;
  entities(): EntityView[];
  drainEvents(): SimEvent[];
  isOver(): boolean;
  results(): ResultsMsg | null;
  /** latency in ms (0 offline) */
  ping(): number;
  dispose(): void;
}
