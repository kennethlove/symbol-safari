# Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Add true online 2-player multiplayer to Symbol Finder via Cloudflare Workers + Durable Objects.

**Architecture:** Client-server over WebSockets. CF Worker routes connections. Durable Object per room holds authoritative game state, validates actions, broadcasts to players.

**Tech Stack:** Cloudflare Workers + Durable Objects + Pages, vanilla JS, seeded PRNG (mulberry32).

---

## File Structure

```
find-it-game/
├── wrangler.toml
├── package.json
├── public/
│   ├── index.html              (thin shell, module entry)
│   └── js/
│       ├── main.js             (entry point, wires everything)
│       ├── rng.js              (seeded PRNG - mulberry32)
│       ├── voronoi.js          (Voronoi/Delaunay gen, accepts RNG fn)
│       ├── state.js            (game state + turn logic)
│       ├── renderer.js         (canvas rendering)
│       ├── effects.js          (particle effects)
│       ├── ui.js               (DOM screens/HUD/forms)
│       └── network.js          (WebSocket client, reconnect)
└── src/
    ├── worker.js               (CF Worker: routing, WS upgrade)
    └── room.js                 (DO: game room state machine)
```

### Task 1: Scaffold Cloudflare project

**Files:**
- Create: `wrangler.toml`
- Create: `package.json`
- Create: `.gitignore` additions

- [ ] **Step 1: Create `wrangler.toml`**

```toml
name = "symbol-finder"
main = "src/worker.js"
compatibility_date = "2026-05-09"

[[durable_objects.bindings]]
name = "ROOMS"
class_name = "GameRoom"

[[migrations]]
tag = "v1"
new_classes = ["GameRoom"]
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "symbol-finder",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "pages:dev": "wrangler pages dev public --kv= --do=ROOMS"
  },
  "devDependencies": {
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 3: Add to `.gitignore`**

```
.wrangler/
node_modules/
dist/
```

- [ ] **Step 4: Verify scaffold**

Run: `npm install`
Expected: wrangler installed, no errors

### Task 2: Extract seeded PRNG + refactor Voronoi

**Files:**
- Create: `public/js/rng.js`
- Modify: `public/js/voronoi.js` (extracted from monolithic HTML)

- [ ] **Step 1: Write seeded PRNG**

```js
// public/js/rng.js
export function mulberry32(seed) {
  let s = seed | 0
  return function() {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

- [ ] **Step 2: Refactor Voronoi generator**

Current monolithic code uses `Math.random()` for site generation. Refactor to accept RNG function:

```js
// public/js/voronoi.js signature change:
export function generateBoard(width, height, numCells, rng = Math.random)
```

All internal `Math.random()` calls replaced with `rng()`. This is the ONLY change to the Voronoi/Delaunay logic — structural code stays identical.

- [ ] **Step 3: Verify deterministic generation**

Write quick test in browser console:

```js
const rng1 = mulberry32(42)
const rng2 = mulberry32(42)
// generateBoard with rng1, generateBoard with rng2
// Assert: cells arrays deeply equal
```

### Task 3: Split monolithic index.html into modules

**Files:**
- Create: `public/js/state.js`
- Create: `public/js/renderer.js`
- Create: `public/js/effects.js`
- Create: `public/js/ui.js`
- Create: `public/js/main.js`
- Modify: `public/index.html`

- [ ] **Step 1: Extract `state.js`**

Export the game state `G` object and all pure game logic functions (setup, turn management, scoring). Keep all field names identical to current monolithic code.

```js
export const G = { /* same fields as current G */ }
export function setupGame(mode, pack, timeLimit, players) { /* ... */ }
export function findCell(x, y) { /* ... */ }
export function nextTurn() { /* ... */ }
// etc
```

- [ ] **Step 2: Extract `renderer.js`**

All canvas rendering logic. Export `render(ctx, G)`, draws Voronoi cells, numbers, highlights, found state, hover state. Pure function — takes canvas context + game state, draws.

```js
export function render(ctx, fxCtx, G) { /* ... */ }
```

- [ ] **Step 3: Extract `effects.js`**

All particle effect logic (find burst, wrong flash, ring, text). Export `updateEffects(G)`, `renderEffects(fxCtx, G)`.

```js
export function addEffect(type, data) { /* ... */ }
export function updateEffects(G) { /* ... */ }
export function renderEffects(fxCtx, G) { /* ... */ }
```

- [ ] **Step 4: Extract `ui.js`**

All DOM manipulation: screen transitions (start/game/results), HUD updates, form handling, settings.

```js
export function showScreen(id) { /* ... */ }
export function updateHUD(G) { /* ... */ }
export function getFormValues() { /* ... */ }
export function bindUIEvents(handlers) { /* ... */ }
```

- [ ] **Step 5: Create `main.js` entry point**

Imports all modules, wires them together. Determines solo vs online mode from URL params.

```js
import { /* ... */ } from './state.js'
import { render } from './renderer.js'
import { /* ... */ } from './effects.js'
import { /* ... */ } from './ui.js'

// Solo mode: existing flow
// Online mode: connect via WebSocket, use network.js
```

- [ ] **Step 6: Slim down `index.html`**

Remove all inline `<script>` content. Add module script tag only:

```html
<script type="module" src="/js/main.js"></script>
```

Also remove inline CSS — extract to `public/css/style.css`. Keep HTML structure unchanged (same IDs, classes, screen structure).

- [ ] **Step 7: Verify solo mode still works**

Run `npx serve public` or open `public/index.html`. Verify solo and hot-seat PvP modes work identically to before.

### Task 4: Worker + DO skeleton — create/join room, WebSocket connect

**Files:**
- Create: `src/worker.js`
- Create: `src/room.js`

- [ ] **Step 1: Worker entry — routing**

```js
// src/worker.js
export default {
  async fetch(req, env) {
    const url = new URL(req.url)

    // CORS preflight
    if (req.method === 'OPTIONS')
      return new Response(null, { headers: corsHeaders() })

    // Create room
    if (req.method === 'POST' && url.pathname === '/api/room') {
      const id = env.ROOMS.newUniqueId()
      const stub = env.ROOMS.get(id)
      return stub.fetch(req)
    }

    // Join room
    if (req.method === 'POST' && url.pathname.startsWith('/api/room/')) {
      const roomCode = url.pathname.split('/')[3]
      const id = env.ROOMS.idFromString(roomCode)
      const stub = env.ROOMS.get(id)
      return stub.fetch(req)
    }

    // WebSocket upgrade
    if (url.pathname.startsWith('/ws/')) {
      const roomCode = url.pathname.split('/')[2]
      const id = env.ROOMS.idFromString(roomCode)
      const stub = env.ROOMS.get(id)
      return stub.fetch(req)
    }

    return new Response('Not found', { status: 404 })
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}
```

- [ ] **Step 2: DO skeleton — room create/join**

```js
// src/room.js
export class GameRoom {
  constructor(ctx, id) {
    this.ctx = ctx
    this.id = id
    this.state = {
      phase: 'waiting',
      players: [{ name: '', ws: null, connected: false, disconnectedAt: null }],
      seed: null,
    }
  }

  async fetch(req) {
    const url = new URL(req.url)

    // Create room
    if (req.method === 'POST' && url.pathname === '/api/room') {
      const { name } = await req.json()
      this.state.players[0].name = name
      this.state.players[0].connected = true
      return new Response(JSON.stringify({
        roomCode: this.id.toString(),
        playerIndex: 0
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Join room
    if (req.method === 'POST' && url.pathname.startsWith('/api/room/')) {
      if (this.state.players.length >= 2)
        return new Response('Room full', { status: 400 })
      const { name } = await req.json()
      this.state.players.push({ name, ws: null, connected: false, disconnectedAt: null })
      return new Response(JSON.stringify({
        roomCode: this.id.toString(),
        playerIndex: 1
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // WebSocket upgrade
    if (url.pathname.startsWith('/ws/')) {
      const playerIndex = parseInt(url.searchParams.get('player'))
      if (isNaN(playerIndex) || playerIndex >= this.state.players.length)
        return new Response('Invalid player', { status: 400 })

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      server.accept()
      this.state.players[playerIndex].ws = server
      this.state.players[playerIndex].connected = true
      this.state.players[playerIndex].disconnectedAt = null

      server.addEventListener('message', (e) => this.handleMessage(playerIndex, e.data))
      server.addEventListener('close', () => this.handleDisconnect(playerIndex))

      // If both players connected, start game
      if (this.state.players.every(p => p.connected)) {
        this.startGame()
      }

      return new Response(null, { status: 101, webSocket: client })
    }
  }

  handleMessage(playerIndex, data) { /* next task */ }
  handleDisconnect(playerIndex) { /* future task */ }
  startGame() { /* next task */ }
}
```

- [ ] **Step 3: Verify with wrangler dev**

Run: `npm run dev`
Expected: wrangler starts, local endpoint responds

Test with httpie:

```bash
http POST http://localhost:8787/api/room name=Alice
```

Expected: `{ "roomCode": "...", "playerIndex": 0 }`

### Task 5: DO game state machine — start, turn, validate, end

**Files:**
- Modify: `src/room.js`

- [ ] **Step 1: Add game state fields + startGame**

```js
startGame() {
  this.state.phase = 'playing'
  this.state.seed = Math.floor(Math.random() * 2147483647)
  this.state.pid = 0
  this.state.found = 0
  this.state.avail = [...symbols]  // depends on pack
  this.state.shared = 60           // default timer
  this.state.running = false

  // Send GAME_START to both players
  this.broadcast({
    type: 'GAME_START',
    seed: this.state.seed,
    playerIndex: this.state.pid,
    players: this.state.players.map(p => ({ name: p.name }))
  })

  // Start first turn
  this.startTurn()
}
```

- [ ] **Step 2: Turn management**

```js
startTurn() {
  this.state.running = false
  this.state.target = this.state.avail[Math.floor(Math.random() * this.state.avail.length)]
  this.state.turnMs = 0

  // Send target only to active player
  this.sendTo(this.state.pid, { type: 'TURN_START', target: this.state.target })
  // Send wait to other player
  const other = (this.state.pid + 1) % 2
  this.sendTo(other, { type: 'TURN_WAIT', player: this.state.pid })

  // Start timer alarm (1s ticks)
  this.ctx.storage.setAlarm(Date.now() + 1000)
}
```

- [ ] **Step 3: CLICK validation**

```js
handleClick(playerIndex, { x, y }) {
  if (playerIndex !== this.state.pid) return  // not their turn
  if (!this.state.running) return  // not ready yet

  const cell = this.findCellAt(x, y)
  if (!cell || cell.found) {
    this.sendTo(playerIndex, { type: 'CELL_WRONG', x, y })
    return
  }

  if (cell.num !== this.state.target) {
    this.sendTo(playerIndex, { type: 'CELL_WRONG', x, y })
    return
  }

  // Correct!
  cell.found = true
  cell.fb = playerIndex
  this.state.found++
  this.state.players[playerIndex].finds.push({ num: cell.num, time: this.state.turnMs })

  this.broadcast({
    type: 'CELL_FOUND',
    num: cell.num,
    time: this.state.turnMs,
    playerIndex
  })

  // Check game end
  if (this.state.found >= this.state.cells.length) {
    this.endGame()
    return
  }

  // Next player's turn
  this.state.pid = (this.state.pid + 1) % 2
  this.state.players[this.state.pid].turnMs = 0
  this.startTurn()
}
```

- [ ] **Step 4: Skip handling**

```js
handleSkip(playerIndex) {
  if (playerIndex !== this.state.pid) return
  if (this.state.players[playerIndex].skips >= 3) return

  this.state.players[playerIndex].skips++
  this.broadcast({ type: 'SKIP', playerIndex })
  this.state.pid = (this.state.pid + 1) % 2
  this.startTurn()
}
```

- [ ] **Step 5: Timer + alarm handler**

```js
async alarm() {
  if (this.state.phase !== 'playing') return

  this.state.shared--
  this.broadcast({ type: 'TIMER_SYNC', remaining: this.state.shared })

  if (this.state.shared <= 0) {
    this.endGame()
    return
  }

  if (this.state.running)
    this.state.turnMs += 1000

  this.ctx.storage.setAlarm(Date.now() + 1000)
}
```

- [ ] **Step 6: Game over**

```js
endGame() {
  this.state.phase = 'finished'
  this.state.running = false

  const winner = this.state.players[0].t < this.state.players[1].t ? 0 : 1

  this.broadcast({
    type: 'GAME_OVER',
    winner,
    stats: this.state.players.map(p => ({
      name: p.name,
      finds: p.finds.length,
      time: p.t,
      skips: p.skips
    }))
  })
}
```

### Task 6: Client network.js

**Files:**
- Create: `public/js/network.js`

- [ ] **Step 1: WebSocket client**

```js
// public/js/network.js
let ws = null
let messageHandler = null
let reconnectTimer = null
let roomCode = null
let playerIndex = null

export function connect(code, index, onMessage) {
  roomCode = code
  playerIndex = index
  messageHandler = onMessage

  const url = `${location.origin.replace(/^http/, 'ws')}/ws/${code}?player=${index}`
  ws = new WebSocket(url)

  ws.onopen = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (messageHandler) messageHandler(msg)
  }

  ws.onclose = () => {
    // Attempt reconnection within 30s
    reconnectTimer = setTimeout(() => {
      connect(roomCode, playerIndex, messageHandler)
    }, 2000)
  }
}

export function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(msg))
}

export function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (ws) ws.close()
  ws = null
  messageHandler = null
}
```

- [ ] **Step 2: Test with wrangler dev**

Run: `npm run dev`
Open two browser tabs at localhost:8787 and verify WebSocket connections.

### Task 7: Client online UI flow

**Files:**
- Modify: `public/js/ui.js`
- Modify: `public/index.html`

- [ ] **Step 1: Add Create/Join UI to start screen**

In `index.html`, add to start screen:

```html
<div id="online-mode" class="hidden">
  <button id="btn-create-room">Create Room</button>
  <button id="btn-join-room">Join Room</button>
  <div id="room-lobby" class="hidden">
    <p>Room code: <strong id="room-code-display"></strong></p>
    <p id="lobby-status">Waiting for opponent...</p>
  </div>
  <div id="join-form" class="hidden">
    <input id="room-code-input" placeholder="Enter room code" maxlength="8">
    <button id="btn-join">Join</button>
  </div>
</div>
```

- [ ] **Step 2: Add online vs solo mode toggle**

In `index.html`, add mode selection:

```html
<select id="game-mode">
  <option value="solo">Solo</option>
  <option value="pvp">1 vs 1 (hot-seat)</option>
  <option value="online">Online Multiplayer</option>
</select>
```

- [ ] **Step 3: UI event handlers**

In `ui.js`, add:

```js
export function bindOnlineUI(handlers) {
  document.getElementById('btn-create-room').onclick = handlers.createRoom
  document.getElementById('btn-join-room').onclick = () => showScreen('join-form')
  document.getElementById('btn-join').onclick = handlers.joinRoom
}

export function showLobby(roomCode) {
  document.getElementById('room-code-display').textContent = roomCode
  showScreen('room-lobby')
}

export function showOpponentJoined(name) {
  document.getElementById('lobby-status').textContent = `${name} joined!`
}
```

- [ ] **Step 4: Disconnect/reconnect overlay**

Add to `index.html`:

```html
<div id="disconnect-overlay" class="hidden">
  <p>Connection lost. Reconnecting...</p>
</div>
<div id="opponent-disconnect-overlay" class="hidden">
  <p id="opponent-disconnect-msg">Opponent disconnected. Waiting for reconnection...</p>
</div>
```

### Task 8: Wire online game loop in main.js

**Files:**
- Modify: `public/js/main.js`

- [ ] **Step 1: Online initialization**

```js
// In main.js
async function startOnlineGame() {
  const { connect, send, onMessage } = await import('./network.js')

  // Create room via API
  const res = await fetch('/api/room', {
    method: 'POST',
    body: JSON.stringify({ name: playerName })
  })
  const { roomCode, playerIndex } = await res.json()
  showLobby(roomCode)

  // Wait for opponent
  connect(roomCode, playerIndex, (msg) => {
    switch (msg.type) {
      case 'GAME_START':
        initializeBoard(msg.seed)
        G.players = msg.players
        startOnlineRound()
        break
      case 'TURN_START':
        G.target = msg.target
        G.pid = playerIndex
        showTurnOverlay(true)
        break
      case 'TURN_WAIT':
        G.pid = (playerIndex + 1) % 2
        showTurnOverlay(false)
        break
      case 'CELL_FOUND':
        markCellFound(msg.num, msg.playerIndex)
        break
      case 'CELL_WRONG':
        flashWrongCell(msg.x, msg.y)
        break
      case 'TIMER_SYNC':
        G.shared = msg.remaining
        updateHUD(G)
        break
      case 'GAME_OVER':
        showResults(msg.winner, msg.stats)
        break
      case 'PLAYER_DISCONNECT':
        showOpponentDisconnected()
        break
      case 'PLAYER_RECONNECT':
        hideOpponentDisconnected()
        break
    }
  })
}
```

- [ ] **Step 2: Click handler sends to server instead of local**

```js
canvas.addEventListener('click', (e) => {
  if (G.mode !== 'online') {
    handleClickLocal(e)
    return
  }
  const rect = canvas.getBoundingClientRect()
  send({ type: 'CLICK', x: e.clientX - rect.left, y: e.clientY - rect.top })
})
```

- [ ] **Step 3: Turn overlay**

Show "Ready?" overlay before each turn. On "Go", send READY to server → server starts timer for that turn.

```js
document.getElementById('btn-go').onclick = () => {
  if (G.mode === 'online') {
    send({ type: 'READY' })
    G.running = true
  }
  hideTurnOverlay()
}
```

### Task 9: DO alarm timer sync

**Files:**
- Modify: `src/room.js`

Already covered in Task 5 Step 5. Verify:

- [ ] **Step 1: Verify timer sync**

```bash
http --websocket ws://localhost:8787/ws/TEST?player=0
```

Expected: TIMER_SYNC messages every 1000ms

### Task 10: Grace reconnection

**Files:**
- Modify: `src/room.js`
- Modify: `public/js/network.js`

- [ ] **Step 1: DO disconnect handler**

```js
handleDisconnect(playerIndex) {
  this.state.players[playerIndex].connected = false
  this.state.players[playerIndex].disconnectedAt = Date.now()

  // Broadcast to other player
  this.broadcast({ type: 'PLAYER_DISCONNECT', playerIndex })

  // Set alarm for 30s timeout
  this.ctx.storage.setAlarm(Date.now() + 30000)
}
```

- [ ] **Step 2: DO reconnect (in fetch handler)**

When client reconnects via WebSocket upgrade (same playerIndex within 30s):

```js
if (this.state.players[playerIndex].disconnectedAt) {
  const elapsed = Date.now() - this.state.players[playerIndex].disconnectedAt
  if (elapsed > 30000) {
    server.close(4000, 'Reconnection window expired')
    return new Response('Reconnection expired', { status: 408 })
  }
}

// In the WebSocket handler after accepting:
this.state.players[playerIndex].ws = server
this.state.players[playerIndex].connected = true
this.state.players[playerIndex].disconnectedAt = null

// Send full state snapshot
server.send(JSON.stringify({ type: 'STATE_SYNC', state: this.serializeState() }))

// Clear disconnect alarm
this.ctx.storage.setAlarm(Date.now() + 1000)  // resume normal timer

this.broadcast({ type: 'PLAYER_RECONNECT', playerIndex })
```

- [ ] **Step 3: Client reconnect (network.js)**

Already covered in Task 6 — `ws.onclose` retries connection. On successful reconnect, server sends `STATE_SYNC` which client uses to rebuild game state.

### Task 11: Cleanup — DO garbage collection, polish

**Files:**
- Modify: `src/room.js`

- [ ] **Step 1: DO auto-GC**

DO automatically GCs when all WebSockets close and no alarm pending. No explicit cleanup needed — DO lifecycle handles it.

- [ ] **Step 2: Deploy**

```bash
npx wrangler deploy
```
