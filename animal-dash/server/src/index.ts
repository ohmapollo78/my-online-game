// ANIMAL DASH: ULTIMATE RACE — game server entry point.
import http from 'http';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { Server, LobbyRoom, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { RaceRoom } from './rooms/RaceRoom';
import { config } from './config';

const app = express();
app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins }));
app.use(express.json({ limit: '16kb' }));

const started = Date.now();
app.get('/health', async (_req, res) => {
  const rooms = await matchMaker.query({});
  res.json({
    ok: true,
    uptimeSec: Math.round((Date.now() - started) / 1000),
    rooms: rooms.filter((r) => r.name === 'race').length,
    players: rooms.reduce((a, r) => a + (r.name === 'race' ? r.clients : 0), 0),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
  });
});

// Room code lookup (lets the client show "room not found" before joining)
app.get('/api/room/:code', async (req, res) => {
  const code = String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const [room] = await matchMaker.query({ roomId: code });
  if (!room) return res.status(404).json({ found: false });
  res.json({ found: true, clients: room.clients, maxClients: room.maxClients, locked: room.locked, metadata: room.metadata });
});

// Serve the production client build if present (single deployment for game + server).
if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
  app.use(express.static(config.clientDist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!matchmake|health|api).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  console.log(`Serving client build from ${config.clientDist}`);
}

const server = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server, pingInterval: 3000, pingMaxRetries: 3 }),
});

gameServer.define('lobby', LobbyRoom);
gameServer.define('race', RaceRoom).enableRealtimeListing();

gameServer.listen(config.port, config.host).then(() => {
  console.log(`ANIMAL DASH server listening on ${config.host}:${config.port} (${config.nodeEnv})`);
});

const shutdown = () => { console.log('Shutting down…'); gameServer.gracefullyShutdown().then(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
