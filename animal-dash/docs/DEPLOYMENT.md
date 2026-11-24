# Public deployment (HTTPS / WSS)

ANIMAL DASH deploys as **one Node.js process** that serves the built game client over HTTP(S) and the Colyseus
game server over WebSocket on the same port. Behind HTTPS, browsers automatically use `wss://` because the
production client connects to the host that served the page.

> Never point a production client at `localhost`. `client/.env.production` leaves `VITE_SERVER_URL` empty
> (same-host) by default.

## Option A — Docker (any host)

```powershell
docker build -t animal-dash .
docker run -d -p 2567:2567 --name animal-dash animal-dash
```

Put an HTTPS reverse proxy in front (see Option C) or use a platform that terminates TLS for you (Option B).
Health check: `GET /health` → `{"ok":true,...}`.

## Option B — Managed platforms (Render, Railway, Fly.io, Azure App Service, …)

1. Push the `animal-dash` folder to a Git repository.
2. Create a **Web Service** from the repo using the included `Dockerfile` (or Node runtime with:
   build `npm --prefix client ci && npm --prefix server ci && npm run build`, start `node server/dist/index.js`).
3. Set environment variables: `NODE_ENV=production`. Most platforms inject `PORT` automatically.
4. Make sure **WebSockets are enabled** (on by default on Render/Railway/Fly; on Azure App Service enable
   "Web sockets" in Configuration).
5. Use **one instance** (Colyseus rooms live in memory; scaling to multiple instances requires
   `@colyseus/redis-presence` + `@colyseus/redis-driver`).
6. Open `https://<your-app>/` — that's the shareable game URL.

## Option C — VPS (Ubuntu) + Caddy for automatic HTTPS

```bash
# on the server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
git clone <your repo> animal-dash && cd animal-dash
npm --prefix client ci && npm --prefix server ci && npm run build
sudo npm i -g pm2 && NODE_ENV=production PORT=2567 pm2 start server/dist/index.js --name animal-dash && pm2 save
```

`/etc/caddy/Caddyfile` (Caddy obtains and renews TLS certificates automatically; it proxies WebSockets out of the box):

```
game.example.com {
    reverse_proxy localhost:2567
}
```

Open firewall ports 80 and 443 only. Players visit `https://game.example.com`.

## Hosting the client separately (CDN / static hosting)

Build the client with an explicit server URL and allow its origin on the server:

```powershell
$env:VITE_SERVER_URL = "wss://api.example.com"; npm --prefix client run build   # upload client/dist to the CDN
```

Server: `CORS_ORIGINS=https://game.example.com` and omit `CLIENT_DIST` (or leave the folder absent).

## Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | 2567 | Platforms usually inject this |
| `HOST` | 0.0.0.0 | |
| `NODE_ENV` | development | Use `production` |
| `CLIENT_DIST` | `../client/dist` relative to `server/dist` | Built client folder to serve |
| `CORS_ORIGINS` | `*` | Comma-separated list for split hosting |
| `VITE_SERVER_URL` (build time) | empty in production | Only for split hosting |

## Room code workflow for players

1. Player A opens the game URL → **CREATE / JOIN ROOM → Create room**. A code like `DOG888` appears (📋 Copy).
2. Player A shares the URL and code (chat, Discord…).
3. Friends open the URL → **CREATE / JOIN ROOM**, type the code → **Join** (case-insensitive).
4. Everyone picks an animal and presses **READY**; the host picks the track/AI fill and presses **START RACE**.
5. **QUICK MATCH** puts players into any open public room; it starts automatically once everyone is ready.

## Testing from different internet connections (required acceptance step)

This must be done by you after deploying, because it needs two separate networks:

1. Deploy using one of the options above and confirm `https://<host>/health` returns `ok: true`.
2. Computer 1 on home/office Wi-Fi: open the game URL, create a room.
3. Computer 2 on a **different network** (e.g. phone hotspot): open the same URL, join with the code.
4. Pick different animals, ready up, start. Verify both see each other move, item hits land on each other, and the
   results table matches on both screens. The in-race ping indicator (bottom right) shows latency.
5. Optional: run the automated two-client check against the public server from one machine:
   `$env:SERVER_URL="wss://<host>"; npm --prefix server run test:net`.

## Operations

* Logs: room create/join/leave, reconnections, rate-limit kicks and race results are printed to stdout.
* Graceful shutdown on SIGTERM/SIGINT (rooms are disposed cleanly).
* Disconnected players keep their racer for 20 s (race) / 10 s (lobby); after that a bot labelled "(AI)" takes over.
