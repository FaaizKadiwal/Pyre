# Card Game

[![CI](https://github.com/FaaizKadiwal/card-game/actions/workflows/ci.yml/badge.svg)](https://github.com/FaaizKadiwal/card-game/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.18-brightgreen.svg)](package.json)

A real-time, browser-based shedding card game for 2 to 5 players. Create a room, send the invite link, and play from any phone or laptop. No accounts, no installs, no build step.

![Two players mid-game](docs/screenshot.png)

## Features

- **Real-time multiplayer** over WebSockets with Socket.IO, opening with WebSocket first and falling back to long-polling where a proxy blocks it.
- **Server-authoritative rules.** Clients only send intents; the server validates every move and sends each player only what they are allowed to see.
- **Power cards.** 2 resets the pile, 7 forces a low card, 10 burns the pile and grants another turn.
- **Rooms** with invite links, a public room list, private rooms, host controls, and in-room chat with player colours.
- **Turn timer.** The host picks 30 seconds to 2 minutes, or off. When the clock runs out the server plays a card for the slow player, so one absent friend never stalls the table.
- **Reconnection.** A dropped connection, a page reload, or switching away on a phone does not cost you your seat: the server holds it for 60 seconds and a per-tab session token reclaims it, cards and all.
- **Host tools.** Start and restart games, change settings between rounds, remove a player.
- **Scoreboards.** Wins per player within a room, a leaderboard and a recent-games feed across rooms, optionally persisted in Postgres.
- **Small touches.** Last-card alert, your-turn sound cue and tab title, activity log, responsive layout from 320px phones to large monitors.
- **Production hardening.** Security headers, per-socket rate limiting, input sanitising, a room cap, health endpoint, graceful shutdown. Lobby updates go only to sockets in the lobby.
- **Tested.** Rules, persistence (against an in-memory Postgres emulator), and complete two- and four-player games driven through real sockets.

## Quick start

Requires Node.js 18.18 or newer (22 recommended).

```bash
git clone https://github.com/FaaizKadiwal/card-game.git
cd card-game
npm install
npm start
```

Open <http://localhost:3000> in two browser tabs, create a room in one, join with the code in the other, and press **Start game** in the host's tab. To play with friends on the same network, share `http://<your-lan-ip>:3000` (find the address with `ipconfig` or `ip addr`).

For development with automatic restarts:

```bash
npm run dev
```

## How to play

Each player receives three face-down cards, three face-up cards placed on top of them, and a hand of three. The rest of the deck is the draw pile. The discard pile starts empty.

1. On your turn, play one card from your hand that matches the top of the pile by **suit or value**. Your hand refills to three from the deck while it lasts.
2. **2** can be played on anything and resets the pile: anything may follow it.
3. **7** can be played on anything. The next card must be **lower than 7**, or another power card.
4. **10** can be played on anything and **burns** the pile. You play again.
5. No playable card? You must **pick up the whole pile**.
6. When your hand and the deck are both empty, play from your face-up cards. When those are gone, flip your face-down cards blind: a legal flip is played, an illegal one means you pick up the pile plus that card.
7. The first player with no cards left wins. When only one player still holds cards, that player loses and the game ends.
8. If the turn timer runs out, the game plays for you: a legal card if you have one, otherwise a pick-up or a blind flip.

## Configuration

Set these as environment variables (see [`.env.example`](.env.example)).

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. Hosting platforms set this automatically. |
| `DATABASE_URL` | unset | Postgres connection string. When set, results and the leaderboard persist across restarts. Tables are created on first use. |
| `NODE_ENV` | unset | Set to `production` on hosts. |

### Persistence

Live game state is always in memory: it is per-turn, latency-sensitive, and gone the moment a room empties. What persists is the **result** of each completed game (who played, who finished first, who lost), which feeds the leaderboard, the recent-games feed and the API below.

- Without `DATABASE_URL`, results are kept in memory (bounded to the last 1000 games) and reset on restart. The lobby says so.
- With `DATABASE_URL`, results are written to Postgres inside a transaction. Any Postgres works, including the free tiers of [Neon](https://neon.tech) and [Supabase](https://supabase.com). Append `?sslmode=require` for hosted databases.

The leaderboard is keyed by display name, so it is a casual leaderboard rather than an account system.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Start the server. |
| `npm run dev` | Start with `node --watch`, restarting on file changes. |
| `npm test` | Run all tests with Node's built-in test runner. |
| `npm run lint` | Lint server, client and tests with ESLint. |
| `npm run lint:fix` | Lint and auto-fix. |

Run a single test file with `node --test test/gameLogic.test.js`.

## Deploy for free

The app needs a host that runs a long-lived Node process with WebSocket support. Serverless platforms such as Vercel, Netlify, Cloudflare Pages or GitHub Pages cannot run it: a function that ends after each request has nowhere to keep a live room. Render's free plan can, and Neon provides a free Postgres for the leaderboard.

### 1. Push to GitHub

```bash
git add -A
git commit -m "Your message"
git push -u origin main
```

The workflow in `.github/workflows/ci.yml` lints, tests and builds the Docker image on every push.

### 2. Create the service on Render

1. Sign in at <https://render.com> with GitHub and choose **New > Blueprint**.
2. Pick this repository. Render reads [`render.yaml`](render.yaml): a Node web service on the free plan, `npm ci` to build, `npm start` to run, `/health` as the health check, Node 22 from `.node-version`.
3. It asks for `DATABASE_URL` because the blueprint marks it as a secret. Leave it empty for now, or paste a connection string from step 3.
4. Click **Apply**. The first build takes one to two minutes and ends with a URL such as `https://card-game-xxxx.onrender.com`, served over HTTPS.

Without the blueprint: **New > Web Service**, connect the repository, runtime *Node*, build `npm ci`, start `npm start`, instance *Free*, health check `/health`, environment `NODE_ENV=production`.

Verify: `/health` returns `{"ok":true,...}`, two devices can create and join a room, and the browser's network tab shows a `websocket` connection to `/socket.io/`.

What to expect on the free plan: the instance sleeps after 15 minutes without traffic and takes about a minute to wake, which also clears open rooms, so have everyone open the link before creating a room. Every push to `main` redeploys automatically. Free hours are capped per month; check Render's current pricing page.

### 3. Free Postgres for a persistent leaderboard

1. Sign up at <https://neon.tech>, create a project, and open **Connect**.
2. Copy the pooled connection string. It looks like `postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.
3. In Render, open the service, go to **Environment**, add `DATABASE_URL` with that value, and save. Render redeploys.
4. `/health` now reports `"persistentResults":true`. The tables `games` and `game_players` are created on first use; there is no migration step.

Supabase works the same way: **Project Settings > Database > Connection string**, URI form, with `?sslmode=require`. Render's own free Postgres also works but expires after its free period.

### 4. Docker and other hosts

The [`Dockerfile`](Dockerfile) builds a small production image on Node 22 with runtime dependencies only:

```bash
docker build -t card-game .
docker run --rm -p 3000:3000 -e DATABASE_URL="postgresql://..." card-game   # DATABASE_URL optional
```

- **Koyeb:** Create Web Service from GitHub, builder *Dockerfile*, port `3000`, health check `/health`, free instance.
- **Fly.io** (card required): `fly launch --no-deploy`, keep `internal_port = 3000` in `fly.toml`, `fly secrets set DATABASE_URL=...` if wanted, `fly deploy`.
- **Hugging Face Spaces:** a Docker Space with the variable `PORT=7860`, since Spaces route traffic to that port.
- **A VPS** such as Oracle Cloud's Always Free tier: run the image behind Caddy or nginx for HTTPS.

Custom domains: add a CNAME at your DNS provider pointing at the platform hostname; Render, Koyeb and Fly issue the certificate. The app needs no change, it takes its WebSocket origin from the page it is served on.

### 5. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| First load takes a minute | Free instance waking up. Expected. An uptime monitor pinging `/health` every 10 minutes keeps it awake; check the platform's terms first. |
| "Cannot reach the server" in the lobby | Service still building or crashed. Check the platform logs. |
| `/health` shows `persistentResults: false` after setting the database | `DATABASE_URL` not saved or not redeployed. Save again and look for "Result storage unavailable" in the logs. |
| Database errors mentioning SSL | Append `?sslmode=require` to the connection string. |
| "The server is full" | The room cap (500) was reached. Rooms are freed when the last player leaves. |
| Game feels laggy | The proxy blocked WebSockets and Socket.IO fell back to polling. Confirm WebSocket support in the platform docs. |

Scaling beyond one instance is not needed on a free plan. It would require the Socket.IO Redis adapter, sticky sessions, and moving rooms out of process memory.

## Architecture

One Node.js process. Express serves the static client and a small JSON API; Socket.IO shares the same HTTP server for the game protocol.

```text
browser (public/js)                       server (server/)
┌──────────────────────┐   intents       ┌────────────────────────────────────┐
│ game.js   state/wiring│ ──────────────▶ │ socketHandlers.js  parse, limit, ack│
│ ui.js     DOM only    │                 │ gameService.js     orchestration    │
│ cards.js  card nodes  │                 │ rooms.js           rooms, views     │
│ sound.js  audio cues  │ ◀────────────── │ gameLogic.js       pure rules       │
│ socket.js request()   │  room-state     │ results.js         memory|postgres  │
└──────────────────────┘  (per player)   └────────────────────────────────────┘
```

| Path | Role |
| --- | --- |
| [`server/gameLogic.js`](server/gameLogic.js) | Pure rules. Deals, validates plays, applies power cards, advances turns. No I/O, deterministic with an injected random source. |
| [`server/rooms.js`](server/rooms.js) | Room and seat bookkeeping, settings, input sanitising, and `buildView`, the only place that decides what a client may see. |
| [`server/gameService.js`](server/gameService.js) | Everything that changes a room and tells its players: moves, the turn timer, game over, scoring, leaving, reconnecting, kicking, lobby fan-out. |
| [`server/socketHandlers.js`](server/socketHandlers.js) | Socket.IO transport. Parses each request, rate-limits it, calls the service, acknowledges with `{ ok, ... }`. |
| [`server/results.js`](server/results.js) | Persisted results and the leaderboard: in-memory or Postgres behind one interface. |
| [`server/server.js`](server/server.js) | Express app, security headers, compression, `/health` and `/api`, Socket.IO setup, graceful shutdown. |
| [`public/js/game.js`](public/js/game.js) | Client entry: state, socket events, user actions, countdown. |
| [`public/js/ui.js`](public/js/ui.js) | All DOM rendering, built with `textContent` only. |
| [`public/js/cards.js`](public/js/cards.js) | Card sorting and card DOM builders. |
| [`public/js/sound.js`](public/js/sound.js) | Synthesised audio cues, no audio files. |
| [`public/js/socket.js`](public/js/socket.js) | Shared socket and a promise-based `request()` helper. |

### Protocol

Client to server. Every event is acknowledged with `{ ok: true, ... }` or `{ ok: false, error }`.

| Event | Payload | Notes |
| --- | --- | --- |
| `create-room` | `{ name }` | Returns `{ roomId, playerId, token }`. |
| `join-room` | `{ roomId, name }` | Same reply. Codes are case-insensitive. Duplicate names get a suffix. |
| `resume-session` | `{ roomId, token }` | Reclaims the seat that issued `token` from a new connection. The newest connection wins. |
| `leave-room` | | |
| `start-game` | | Host only, 2 to 5 players. Also restarts a finished game. |
| `update-settings` | `{ turnSeconds?, private? }` | Host only, between games. Timer 0 (off) to 300 seconds. |
| `kick-player` | `{ playerId }` | Host only. |
| `play-card` | `{ card: { suit, value } }` | From hand or face-up cards. |
| `play-face-down` | `{ index }` | Blind flip. |
| `pick-up-pile` | | Only allowed when no card is playable. |
| `chat-message` | `{ message }` | Max 300 characters, 5 per 5 seconds. |
| `list-rooms` | | Returns `{ rooms }`. Private rooms are never listed. |

Server to client.

| Event | Payload |
| --- | --- |
| `room-state` | The viewer's private view: own hand, everyone else's counts and face-up cards, pile top, legal cards, whose turn, settings, turn deadline, room wins. Sent to the players of that room. |
| `game-event` | `{ type, message, at, auto? }` for the in-room log. `auto` marks moves made by the turn timer. |
| `room-list` | Joinable public rooms. Sent to sockets in the lobby. |
| `leaderboard` | `{ persistent, rows: [{ name, wins, losses, games }], recent: [...] }`. Sent to sockets in the lobby. |
| `chat-message` | `{ playerId, name, color, message, at }` |
| `left-room` | `{ reason }` when a seat expired, was taken over from another tab, or the host removed you. |

HTTP.

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness plus room and player counts. |
| `GET /api/leaderboard?limit=10` | Top players. |
| `GET /api/games/recent?limit=20` | Most recent completed games. |

## Testing

```bash
npm test
```

- `test/gameLogic.test.js` covers dealing, validation, power cards, turn order, finishing and mid-game departures with fixed hands.
- `test/results.test.js` runs the same assertions against the memory store and the Postgres store, the latter on [pg-mem](https://github.com/oguimbal/pg-mem), so no database is required.
- `test/server.test.js` starts the real server on a random port and drives it with `socket.io-client`: rooms, turns, chat, settings, the turn timer, kicking, reconnecting with a session token, lobby fan-out, security headers, rate limiting, and complete seeded two- and four-player games whose results must appear on the scoreboard, the leaderboard and the API.

## Project structure

```text
.
├── public/                 static client (no build step)
│   ├── css/style.css
│   ├── js/                 ES modules
│   └── index.html
├── server/                 Node.js server
├── test/                   node:test suites
├── docs/screenshot.png
├── .github/workflows/      CI: lint, test, Docker build
├── Dockerfile, render.yaml
└── package.json
```

## Limitations and roadmap

- Single instance. Running several instances needs the Socket.IO Redis adapter and sticky sessions.
- No accounts. The leaderboard groups by display name.
- Rooms live in memory and disappear when the server restarts. On free hosting tiers that also happens when the instance sleeps.
- Ideas: spectators, four-of-a-kind burns, emoji reactions.

## Contributing

Issues and pull requests are welcome. Please run `npm run lint` and `npm test` before opening a PR. The CI workflow runs both on Node 20 and 22 and builds the Docker image.

## License

[MIT](LICENSE)
