// Colyseus schema state: the *lobby/room* information that every client mirrors.
// High-frequency race data is sent as compact snapshot messages instead (see RaceSession).
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';

export class PlayerInfo extends Schema {
  declare id: string;
  declare name: string;
  declare animal: number;
  declare ready: boolean;
  declare isHost: boolean;
  declare connected: boolean;
  declare loaded: boolean;
  declare ping: number;
  declare cosmetics: string;
  declare joinOrder: number;
  constructor() {
    super();
    this.id = ''; this.name = 'Player'; this.animal = 0; this.ready = false; this.isHost = false;
    this.connected = true; this.loaded = false; this.ping = 0; this.cosmetics = ''; this.joinOrder = 0;
  }
}
defineTypes(PlayerInfo, {
  id: 'string', name: 'string', animal: 'uint8', ready: 'boolean', isHost: 'boolean', connected: 'boolean',
  loaded: 'boolean', ping: 'uint16', cosmetics: 'string', joinOrder: 'uint16',
});

export class RaceState extends Schema {
  declare phase: string; // lobby | loading | racing | results
  declare code: string;
  declare hostId: string;
  declare mapId: string;
  declare isPrivate: boolean;
  declare aiFill: boolean;
  declare aiCount: number;
  declare aiDifficulty: string;
  declare maxPlayers: number;
  declare notice: string;
  declare raceNumber: number;
  declare players: MapSchema<PlayerInfo>;
  constructor() {
    super();
    this.phase = 'lobby'; this.code = ''; this.hostId = ''; this.mapId = 'stadium'; this.isPrivate = false;
    this.aiFill = true; this.aiCount = 4; this.aiDifficulty = 'normal'; this.maxPlayers = 8; this.notice = '';
    this.raceNumber = 0;
    this.players = new MapSchema<PlayerInfo>();
  }
}
defineTypes(RaceState, {
  phase: 'string', code: 'string', hostId: 'string', mapId: 'string', isPrivate: 'boolean', aiFill: 'boolean',
  aiCount: 'uint8', aiDifficulty: 'string', maxPlayers: 'uint8', notice: 'string', raceNumber: 'uint16',
  players: { map: PlayerInfo },
});
