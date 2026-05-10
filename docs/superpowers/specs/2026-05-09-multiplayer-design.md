# Multiplayer Design Spec

## Overview

Add true online 2-player multiplayer to Symbol Finder. Currently only supports hot-seat local PvP. This spec covers real-time multiplayer via Cloudflare Workers + Durable Objects.

## Architecture

```
Player A ←→ CF Pages (static) ←→ CF Worker (routing) ←→ Durable Object (room)
Player B ←→ CF Pages (static) ←→ CF Worker (routing) ←→ Durable Object (room)
```

- **CF Pages** serves static JS/CSS/HTML
- **CF Worker** routes API requests and upgrades WebSocket connections
- **Durable Object** per active room — authoritative game state, validates all actions, broadcasts to players via WebSocket

## Tech Stack

- Cloudflare Workers + Durable Objects + Pages
- Vanilla JS (no frameworks)
- Seeded PRNG (mulberry32) for deterministic Voronoi generation

## Constraints

- Cloudflare free tier only
- Session-based player names (no persistent accounts in MVP)
- 2 players, 1 room, private room codes (no matchmaking)
- 30s grace reconnection on disconnect

## Room Lifecycle

1. **Create** → POST /api/room → Worker creates DO → returns `{ roomCode, playerIndex: 0 }`
2. **Join** → POST /api/room/:code → Worker routes to DO → returns `{ playerIndex: 1 }`
3. **Connect** → WS /ws/:roomCode?player=N → DO stores WebSocket
4. **Start** → Both connected → DO generates seed → GAME_START to both → each client generates identical Voronoi
5. **Play** → Turn-based click → validate on DO → broadcast results
6. **End** → Timer done or all found → GAME_OVER → DO keeps state 30s for reconnect, then GC

## Game State (Durable Object)

DO holds canonical game state mirroring current client-side G:

```js
{
  roomCode, seed, phase,
  players: [{ name, ws, connected, disconnectedAt, finds, time, skips }],
  pid, cells, avail, target, shared, running, found
}
```

DO validates every CLICK:
- Match current player
- Cell exists and not found
- Cell matches current target
- Timer > 0

## Protocol

| Direction | Message | Payload |
|-----------|---------|---------|
| C→S | `JOIN` | `{ name }` |
| C→S | `CLICK` | `{ x, y }` |
| C→S | `SKIP` | `{}` |
| C→S | `READY` | `{}` |
| S→C | `ROOM_JOINED` | `{ roomCode, playerIndex }` |
| S→C | `GAME_START` | `{ seed, cells (no targets), players }` |
| S→C | `TURN_START` | `{ target }` — only to active player |
| S→C | `TURN_WAIT` | `{ player }` — to non-active player |
| S→C | `CELL_FOUND` | `{ num, time, playerIndex }` |
| S→C | `CELL_WRONG` | `{ x, y }` |
| S→C | `TIMER_SYNC` | `{ remaining }` |
| S→C | `GAME_OVER` | `{ winner, stats }` |
| S→C | `PLAYER_DISCONNECT` | `{ playerIndex }` |
| S→C | `PLAYER_RECONNECT` | `{ playerIndex, state }` |

## Grace Reconnection

- DO tracks `disconnectedAt` per player on WS close
- PLAYER_DISCONNECT broadcast to other player immediately
- Other player sees "[Name] disconnected — waiting..." in HUD
- If player reconnects within 30s (same room code + player index), DO sends full current state
- If 30s expires → GAME_OVER (remaining player wins)

## Client Architecture

Monolithic `index.html` splits into focused modules:

- `public/js/rng.js` — Seeded PRNG (mulberry32)
- `public/js/voronoi.js` — Voronoi generation, accepts RNG function
- `public/js/state.js` — Game state + turn logic
- `public/js/renderer.js` — Canvas rendering (unchanged)
- `public/js/effects.js` — Particle effects (unchanged)
- `public/js/ui.js` — Screen transitions, form handling, HUD
- `public/js/network.js` — WebSocket client + reconnect
- `public/js/main.js` — Entry point, wires everything

## Server Files

- `src/worker.js` — CF Worker: routes, CORS, WebSocket upgrade
- `src/room.js` — DO class: room state machine
- `wrangler.toml` — CF config

## Non-Goals (MVP)

- No matchmaking (room codes only)
- No persistent accounts
- No spectator mode
- No D1/persistence (rooms die with DO)
- No mobile optimization
- No text chat
- No music/sound sync
