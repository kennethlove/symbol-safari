import http from 'http'
import fs from 'fs'
import path from 'path'
import { WebSocketServer } from 'ws'
import { randomUUID } from 'crypto'
import { genV, pip } from '../public/js/voronoi.js'

const W = 800, H = 600

function makePlayer(name) {
  return { name, ws: null, connected: true, finds: [], skips: 0, t: 0, errors: 0 }
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

const SYMBOL_PACKS = {
  numbers: { count: 90, id: 'numbers' },
}

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

function createRoom() {
  const code = randomUUID().slice(0, 8)
  rooms.set(code, {
    players: [],
    seed: null, cells: [], avail: [], target: null,
    turnMs: 0, running: false, shared: 60, found: 0, pid: 0, turnNum: 0,
    phase: 'waiting', timer: null, replay: [],
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

function startGame(room) {
  const s = room
  s.phase = 'playing'
  s.seed = Math.random()
  const seedInt = Math.floor(s.seed * 2147483647)
  const rand = mulberry32(seedInt)
  s.cells = generateCells(rand, SYMBOL_PACKS.numbers.count)
  s.avail = s.cells.map(c => c.num)
  s.shared = 60
  s.pid = 0
  s.found = 0
  s.running = false
  s.turnMs = 0
  s.turnNum = 0
  s.replay = []
  for (const p of s.players) { p.finds = []; p.t = 0; p.skips = 0; p.errors = 0 }

  const playersInfo = s.players.map(p => ({ name: p.name }))
  const cellsData = s.cells.map(c => ({ num: c.num, site: c.site, vertices: c.vertices, found: false, fb: c.fb }))
  s.players.forEach((p, i) => {
    if (p.ws && p.ws.readyState === 1) {
      p.ws.send(JSON.stringify({
        type: 'GAME_START', seed: s.seed, playerIndex: i, pid: i,
        players: playersInfo, cells: cellsData, avail: s.avail, shared: s.shared,
      }))
    }
  })
  startTurn(room)
}

function startTurn(room) {
  const s = room
  if (s.avail.length === 0) { endGame(room); return }
  const seedInt = Math.floor((s.seed + ++s.turnNum) * 2147483647)
  const rand = mulberry32(seedInt)
  const idx = Math.floor(rand() * s.avail.length)
  s.target = s.avail[idx]
  s.turnMs = 0
  s.running = false

  const active = s.players[s.pid]
  if (active.ws && active.ws.readyState === 1) {
    active.ws.send(JSON.stringify({ type: 'TURN_START', target: s.target, pid: s.pid }))
  }
  const otherPid = s.pid === 0 ? 1 : 0
  const other = s.players[otherPid]
  if (other.ws && other.ws.readyState === 1) {
    other.ws.send(JSON.stringify({ type: 'TURN_WAIT', player: s.pid }))
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
    if (p0.t < p1.t) winner = 0
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
    case 'READY': {
      if (s.running) return
      s.running = true
      const p = s.players[playerIndex]
      if (p.ws && p.ws.readyState === 1) {
        p.ws.send(JSON.stringify({ type: 'GO' }))
      }
      if (!s.timer) {
        s.timer = setInterval(() => {
          if (!s.running) return
          s.shared--
          broadcast(room, { type: 'TIMER_SYNC', remaining: s.shared })
          if (s.running) s.turnMs += 1000
          if (s.shared <= 0) {
            clearInterval(s.timer)
            s.timer = null
            endGame(room)
          }
        }, 1000)
      }
      break
    }
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
  if (playerIndex !== s.pid || !s.running) return

  let hitCell = null
  for (const cell of s.cells) {
    if (cell.fb !== -1) continue
    if (cell.vertices && pip(x, y, cell.vertices)) {
      hitCell = cell
      break
    }
  }

  if (!hitCell || hitCell.num !== s.target) {
    const active = s.players[s.pid]
    active.errors = (active.errors || 0) + 1
    if (active.ws && active.ws.readyState === 1) {
      active.ws.send(JSON.stringify({ type: 'CELL_WRONG', x, y }))
    }
    return
  }

  hitCell.fb = playerIndex
  const player = s.players[playerIndex]
  player.finds = player.finds || []
  player.finds.push({ num: hitCell.num, time: s.turnMs })
  player.t = (player.t || 0) + s.turnMs
  s.found++

  broadcast(room, { type: 'CELL_FOUND', num: hitCell.num, time: s.turnMs, playerIndex })

  s.avail = s.avail.filter(n => n !== hitCell.num)

  if (s.avail.length === 0) {
    endGame(room)
  } else {
    s.pid = s.pid === 0 ? 1 : 0
    startTurn(room)
  }
}

function handleSkip(room, playerIndex) {
  const s = room
  if (playerIndex !== s.pid) return
  const player = s.players[playerIndex]
  if (player.skips >= 3) return
  player.skips++
  broadcast(room, { type: 'SKIP', playerIndex })
  s.pid = s.pid === 0 ? 1 : 0
  startTurn(room)
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
      const { name } = JSON.parse(body || '{}')
      const code = createRoom()
      const room = rooms.get(code)
      room.players.push(makePlayer(name || 'Player 1'))
      console.log(`[API] Room ${code} created by ${name}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ roomCode: code, playerIndex: 0 }))
    })
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
      res.end(JSON.stringify({ roomCode: code, playerIndex: 1 }))
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
