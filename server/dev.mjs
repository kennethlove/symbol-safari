import http from 'http'
import fs from 'fs'
import path from 'path'
import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { genV, pip } from '../public/js/voronoi.js'

const W = 800, H = 600

function makePlayer(name) {
  return { name, ws: null, connected: true, finds: [], skips: 0, t: 0, errors: 0, currentTarget: null }
}

const PORT = parseInt(process.argv[2], 10) || 3001
const PUBLIC = new URL('../public', import.meta.url).pathname
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath)
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
}

const rooms = new Map()

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generateCells(rand, count) {
  const cells = genV(W, H, count, rand)
  cells.forEach((c, i) => {
    c.num = i
    c.fb = -1
    c.found = false
  })
  return cells
}

function createRoom(timeLimit) {
  const code = randomUUID().slice(0, 8)
  rooms.set(code, {
    players: [],
    seed: null, cells: [], avail: [],
    running: false, shared: timeLimit || 60, found: 0,
    phase: 'waiting', timer: null, replay: [], timeLimit: timeLimit || 60,
  })
  return code
}

function broadcast(room, msg, excludeWs = null) {
  const data = JSON.stringify(msg)
  for (const p of room.players) {
    if (p.ws && p.ws.readyState === 1 && p.ws !== excludeWs) {
      try { p.ws.send(data) } catch (e) {}
    }
  }
}

function pickTarget(room, forPlayerIndex) {
  const s = room
  if (s.avail.length === 0) return null
  const other = s.players[1 - forPlayerIndex]
  const otherTarget = other ? other.currentTarget : null
  let pool = otherTarget !== null ? s.avail.filter(n => n !== otherTarget) : s.avail
  if (pool.length === 0) pool = s.avail
  const idx = Math.floor(Math.random() * pool.length)
  return pool[idx]
}

function startGame(room) {
  const s = room
  s.phase = 'playing'
  s.seed = Math.random()
  const seedInt = Math.floor(s.seed * 2147483647)
  const rand = mulberry32(seedInt)
  s.cells = generateCells(rand, 90)
  s.avail = s.cells.map(c => c.num)
  s.shared = s.timeLimit
  s.running = false
  s.replay = []
  for (const p of s.players) { p.finds = []; p.t = 0; p.skips = 0; p.errors = 0; p.currentTarget = null }

  for (const p of s.players) {
    p.currentTarget = pickTarget(room, s.players.indexOf(p))
  }

  const playersInfo = s.players.map(p => ({ name: p.name }))
  const cellsData = s.cells.map(c => ({ num: c.num, site: c.site, vertices: c.vertices, found: false, fb: c.fb }))
  s.players.forEach((p, i) => {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({
        type: 'GAME_START', seed: s.seed, playerIndex: i,
        players: playersInfo, cells: cellsData, avail: s.avail,
        shared: s.shared, timeLimit: s.timeLimit,
        target: p.currentTarget,
      }))
    }
  })

  s.running = true
  if (!s.timer) {
    s.timer = setInterval(() => {
      if (!s.running) return
      s.shared--
      broadcast(room, { type: 'TIMER_SYNC', remaining: s.shared })
      if (s.shared <= 0) {
        clearInterval(s.timer)
        s.timer = null
        endGame(room)
      }
    }, 1000)
  }
}

function endGame(room) {
  const s = room
  s.phase = 'finished'
  s.running = false
  if (s.timer) { clearInterval(s.timer); s.timer = null }

  let winner = -1
  if (s.players.length === 2) {
    const p0 = s.players[0]; const p1 = s.players[1]
    const f0 = p0.finds.length, f1 = p1.finds.length
    if (f0 > f1) winner = 0
    else if (f1 > f0) winner = 1
    else if (p0.t < p1.t) winner = 0
    else if (p1.t < p0.t) winner = 1
    else if ((p0.errors || 0) < (p1.errors || 0)) winner = 0
    else if ((p1.errors || 0) < (p0.errors || 0)) winner = 1
  }

  const stats = s.players.map(p => ({ name: p.name, finds: p.finds, time: p.t, skips: p.skips }))
  broadcast(room, { type: 'GAME_OVER', winner, stats })
}

function handleMessage(room, playerIndex, data) {
  let msg
  try { msg = JSON.parse(data) } catch (e) { return }
  const s = room

  switch (msg.type) {
    case 'CLICK':
      handleClick(room, playerIndex, msg.x, msg.y)
      break
    case 'SKIP':
      handleSkip(room, playerIndex)
      break
    case 'PLAY_AGAIN':
      if (!s.replay.includes(playerIndex)) s.replay.push(playerIndex)
      broadcast(room, { type: 'OPPONENT_PLAY_AGAIN' })
      if (s.replay.length >= 2) {
        s.replay = []
        s.timer = null
        startGame(room)
      }
      break
  }
}

function handleClick(room, playerIndex, x, y) {
  const s = room
  const player = s.players[playerIndex]
  if (!player) return

  let hitCell = null
  for (const cell of s.cells) {
    if (cell.fb !== -1) continue
    if (cell.vertices && pip(x, y, cell.vertices)) {
      hitCell = cell
      break
    }
  }
  if (!hitCell || hitCell.num !== player.currentTarget) {
    player.errors = (player.errors || 0) + 1
    if (player.ws && player.ws.readyState === 1)
      player.ws.send(JSON.stringify({ type: 'CELL_WRONG', x, y }))
    return
  }

  hitCell.fb = playerIndex
  const elapsed = s.timeLimit - s.shared
  player.finds.push({ num: hitCell.num, time: elapsed })
  player.t = (player.t || 0) + elapsed
  s.found++

  s.avail = s.avail.filter(n => n !== hitCell.num)

  const nextTarget = s.avail.length > 0 ? pickTarget(room, playerIndex) : null
  player.currentTarget = nextTarget

  broadcast(room, {
    type: 'CELL_FOUND',
    num: hitCell.num,
    time: elapsed,
    playerIndex,
    nextTarget,
  })

  const otherPi = playerIndex === 0 ? 1 : 0
  const other = s.players[otherPi]
  if (other && other.currentTarget === hitCell.num) {
    other.currentTarget = s.avail.length > 0 && s.players.length > 1 ? pickTarget(room, otherPi) : null
    if (other.ws && other.ws.readyState === 1)
      other.ws.send(JSON.stringify({ type: 'TARGET_UPDATE', target: other.currentTarget }))
  }

  if (s.avail.length === 0) {
    endGame(room)
  }
}

function handleSkip(room, playerIndex) {
  const s = room
  const player = s.players[playerIndex]
  if (!player || player.skips >= 3) return
  player.skips++
  broadcast(room, { type: 'SKIP', playerIndex })
  player.currentTarget = pickTarget(room, playerIndex)
  if (player.ws && player.ws.readyState === 1)
    player.ws.send(JSON.stringify({ type: 'TARGET_UPDATE', target: player.currentTarget }))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors())
    res.end()
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/room') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const { name, timeLimit } = JSON.parse(body || '{}')
      const code = createRoom(timeLimit || 60)
      const room = rooms.get(code)
      room.players.push(makePlayer(name || 'Player 1'))
      console.log(`[API] Room ${code} created by ${name} (${timeLimit || 60}s)`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ roomCode: code, playerIndex: 0, timeLimit: room.timeLimit }))
    })
    return
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/room/')) {
    const parts = url.pathname.split('/')
    const code = parts[3]
    const room = rooms.get(code)
    if (!room) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ timeLimit: room.timeLimit, players: room.players.length }))
    return
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/room/')) {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const parts = url.pathname.split('/')
      const code = parts[3]
      const room = rooms.get(code)
      if (!room || room.players.length >= 2) {
        console.log(`[API] Join failed for ${code}: not found or full`)
        res.writeHead(400)
        res.end('Room not found or full')
        return
      }
      const { name } = JSON.parse(body || '{}')
      room.players.push(makePlayer(name || 'Player 2'))
      console.log(`[API] Room ${code} joined by ${name} (players: ${room.players.length})`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ roomCode: code, playerIndex: 1, timeLimit: room.timeLimit }))
    })
    return
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    let filePath = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname)
    const ext = path.extname(filePath)
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size })
      if (req.method === 'GET') fs.createReadStream(filePath).pipe(res)
      else res.end()
    } catch {
      res.writeHead(404)
      res.end('Not found')
    }
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const parts = url.pathname.split('/')
  if (parts[1] !== 'ws' || parts.length < 3) {
    socket.destroy()
    return
  }
  const code = parts[2]
  const room = rooms.get(code)
  if (!room) { socket.destroy(); return }

  const playerIndex = parseInt(url.searchParams.get('player'), 10)
  if (isNaN(playerIndex) || playerIndex >= room.players.length) {
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const player = room.players[playerIndex]
    player.ws = ws
    player.connected = true
    console.log(`[WS] Player ${playerIndex} connected to room ${code}`)

    ws.on('message', (data) => handleMessage(room, playerIndex, data.toString()))
    ws.on('close', () => {
      player.connected = false
      console.log(`[WS] Player ${playerIndex} disconnected from room ${code}`)
      broadcast(room, { type: 'PLAYER_DISCONNECT', playerIndex }, ws)
    })
    ws.on('error', (e) => console.log(`[WS] Player ${playerIndex} error:`, e.message))

    const pCount = room.players.length
    const allConnected = room.players.every(p => p.ws && p.ws.readyState === 1)
    console.log(`[WS] Room ${code}: ${pCount} players, all connected: ${allConnected}`)
    if (pCount === 2 && allConnected) {
      console.log(`[WS] Starting game for room ${code}`)
      startGame(room)
    }
  })
})

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

server.listen(PORT, () => {
  console.log(`Dev server: http://localhost:${PORT}`)
})
