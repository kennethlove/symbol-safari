import { genV, pip } from '../public/js/voronoi.js'

const W = 800, H = 600
const CELL_COUNT = 90

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makePlayer(name) {
  return { name, ws: null, connected: true, finds: [], skips: 0, t: 0, errors: 0, currentTarget: null }
}

function generateCells(rand, count) {
  const c = genV(W, H, count, rand)
  c.forEach((cell, i) => { cell.num = i; cell.fb = -1; cell.found = false })
  return c
}

export class RoomDO {
  constructor(state, env) {
    this.state = state
    this.players = []
    this.seed = null; this.cells = []; this.avail = []; this.shared = 60
    this.found = 0; this.phase = 'waiting'; this.replay = []; this.timeLimit = 60; this.roomCode = null
    this.running = false

    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get('roomState')
      if (saved) {
        this.players = (saved.players || []).map(p => ({
          ...p, currentTarget: p.currentTarget || null, ws: null, connected: p.connected !== false,
        }))
        this.roomCode = saved.roomCode || null
        this.timeLimit = saved.timeLimit || 60
        this.seed = saved.seed
        this.cells = saved.cells || []
        this.avail = saved.avail || []
        this.shared = saved.shared
        this.found = saved.found || 0
        this.phase = saved.phase || 'waiting'
        this.running = saved.running || false
        this.replay = saved.replay || []
      }
    })
  }

  async saveState() {
    await this.state.storage.put('roomState', {
      players: this.players.map(p => ({
        name: p.name, connected: p.connected,
        finds: p.finds, skips: p.skips, t: p.t, errors: p.errors,
        currentTarget: p.currentTarget,
      })),
      roomCode: this.roomCode, timeLimit: this.timeLimit,
      seed: this.seed, cells: this.cells,
      avail: this.avail, shared: this.shared,
      found: this.found,
      phase: this.phase, running: this.running, replay: this.replay,
    })
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') === 'websocket')
      return this.handleWSUpgrade(request)

    const url = new URL(request.url)

    if (request.method === 'GET') {
      return new Response(JSON.stringify({ timeLimit: this.timeLimit, players: this.players.length }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (request.method === 'POST') {
      const body = await request.json().catch(() => ({}))

      if (body.action === 'create') {
        if (this.players.length > 0)
          return new Response('Already exists', { status: 400 })
        this.timeLimit = body.timeLimit || 60
        this.roomCode = body.roomCode
        this.players.push(makePlayer(body.name || 'Player 1'))
        await this.saveState()
        return new Response(JSON.stringify({ roomCode: this.roomCode, playerIndex: 0, timeLimit: this.timeLimit }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (body.action === 'join') {
        if (!this.roomCode)
          return new Response('Room not found', { status: 404 })
        if (this.players.length >= 2) {
          const connected = this.players.some(p => p.ws && p.connected)
          if (this.phase !== 'waiting' || connected || this.players.length > 2)
            return new Response('Full', { status: 400 })
          this.players[1] = makePlayer(body.name || 'Player 2')
          await this.saveState()
          return new Response(JSON.stringify({ roomCode: this.roomCode, playerIndex: 1, timeLimit: this.timeLimit }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }
        this.players.push(makePlayer(body.name || 'Player 2'))
        const idx = this.players.length - 1
        await this.saveState()
        return new Response(JSON.stringify({ roomCode: this.roomCode, playerIndex: idx, timeLimit: this.timeLimit }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not found', { status: 404 })
  }

  async handleWSUpgrade(request) {
    const url = new URL(request.url)
    const pi = parseInt(url.searchParams.get('player'), 10)
    if (isNaN(pi) || pi >= this.players.length)
      return new Response('Bad player', { status: 400 })

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    this.state.acceptWebSocket(server)
    this.players[pi].ws = server
    this.players[pi].connected = true

    if (this.players.length === 2 && this.players.every(p => p.ws && p.ws.readyState === 1))
      await this.startGame()

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, data) {
    let msg
    try { msg = JSON.parse(data) } catch { return }
    const pi = this.players.findIndex(p => p.ws === ws)
    if (pi === -1) return

    switch (msg.type) {
      case 'CLICK':
        await this.handleClick(pi, msg.x, msg.y)
        break
      case 'SKIP':
        await this.handleSkip(pi)
        break
      case 'PLAY_AGAIN':
        if (!this.replay.includes(pi)) this.replay.push(pi)
        this.broadcast({ type: 'OPPONENT_PLAY_AGAIN' })
        await this.saveState()
        if (this.replay.length >= 2) { this.replay = []; await this.startGame() }
        break
    }
  }

  async webSocketClose(ws) {
    const pi = this.players.findIndex(p => p.ws === ws)
    if (pi === -1) return
    this.players[pi].connected = false
    this.players[pi].ws = null
    this.broadcast({ type: 'PLAYER_DISCONNECT', playerIndex: pi })
    await this.saveState()
  }

  async alarm() {
    if (!this.running) return
    this.shared--
    this.broadcast({ type: 'TIMER_SYNC', remaining: this.shared })
    if (this.shared <= 0) {
      await this.endGame()
    } else {
      this.state.storage.setAlarm(Date.now() + 1000)
    }
  }

  broadcast(msg, excludeWs = null) {
    const data = JSON.stringify(msg)
    for (const p of this.players) {
      if (p.ws && p.ws.readyState === 1 && p.ws !== excludeWs) {
        try { p.ws.send(data) } catch {}
      }
    }
  }

  pickTarget(forPlayerIndex) {
    if (this.avail.length === 0) return null
    const other = this.players[1 - forPlayerIndex]
    const otherTarget = other ? other.currentTarget : null
    let pool = otherTarget !== null ? this.avail.filter(n => n !== otherTarget) : this.avail
    if (pool.length === 0) pool = this.avail
    const idx = Math.floor(Math.random() * pool.length)
    return pool[idx]
  }

  async startGame() {
    this.phase = 'playing'
    this.seed = Math.random()
    const seedInt = Math.floor(this.seed * 2147483647)
    const rand = mulberry32(seedInt)
    this.cells = generateCells(rand, CELL_COUNT)
    this.avail = this.cells.map(c => c.num)
    this.shared = this.timeLimit
    this.running = false
    this.replay = []
    for (const p of this.players) { p.finds = []; p.t = 0; p.skips = 0; p.errors = 0; p.currentTarget = null }

    for (const p of this.players) {
      p.currentTarget = this.pickTarget(this.players.indexOf(p))
    }

    const pi = this.players.map(p => ({ name: p.name }))
    const cd = this.cells.map(c => ({ num: c.num, site: c.site, vertices: c.vertices, found: false, fb: c.fb }))
    this.players.forEach((p, i) => {
      if (p.ws && p.ws.readyState === 1)
        p.ws.send(JSON.stringify({
          type: 'GAME_START', seed: this.seed, playerIndex: i,
          players: pi, cells: cd, avail: this.avail,
          shared: this.shared, timeLimit: this.timeLimit,
          target: p.currentTarget,
        }))
    })

    this.running = true
    this.state.storage.setAlarm(Date.now() + 1000)
    await this.saveState()
  }

  async handleClick(pi, x, y) {
    const player = this.players[pi]
    if (!player) return

    let hit = null
    for (const cell of this.cells) {
      if (cell.fb !== -1) continue
      if (cell.vertices && pip(x, y, cell.vertices)) { hit = cell; break }
    }
    if (!hit || hit.num !== player.currentTarget) {
      player.errors++
      await this.saveState()
      if (player.ws && player.ws.readyState === 1)
        player.ws.send(JSON.stringify({ type: 'CELL_WRONG', x, y }))
      return
    }

    hit.fb = pi
    const elapsed = this.timeLimit - this.shared
    player.finds.push({ num: hit.num, time: elapsed })
    player.t += elapsed
    this.found++

    this.avail = this.avail.filter(n => n !== hit.num)

    const nextTarget = this.avail.length > 0 ? this.pickTarget(pi) : null
    player.currentTarget = nextTarget

    this.broadcast({
      type: 'CELL_FOUND',
      num: hit.num,
      time: elapsed,
      playerIndex: pi,
      nextTarget,
    })

    const otherPi = 1 - pi
    const other = this.players[otherPi]
    if (other && other.currentTarget === hit.num) {
      other.currentTarget = this.avail.length > 0 && this.players.length > 1 ? this.pickTarget(otherPi) : null
      if (other.ws && other.ws.readyState === 1)
        other.ws.send(JSON.stringify({ type: 'TARGET_UPDATE', target: other.currentTarget }))
    }

    if (this.avail.length === 0) {
      await this.endGame()
    } else {
      await this.saveState()
    }
  }

  async handleSkip(pi) {
    const player = this.players[pi]
    if (!player || player.skips >= 3) return
    player.skips++
    this.broadcast({ type: 'SKIP', playerIndex: pi })
    player.currentTarget = this.pickTarget(pi)
    if (player.ws && player.ws.readyState === 1)
      player.ws.send(JSON.stringify({ type: 'TARGET_UPDATE', target: player.currentTarget }))
    await this.saveState()
  }

  async endGame() {
    this.phase = 'finished'; this.running = false
    let winner = -1
    if (this.players.length === 2) {
      const p0 = this.players[0], p1 = this.players[1]
      const f0 = p0.finds.length, f1 = p1.finds.length
      if (f0 > f1) winner = 0
      else if (f1 > f0) winner = 1
      else if (p0.t < p1.t) winner = 0
      else if (p1.t < p0.t) winner = 1
      else if ((p0.errors || 0) < (p1.errors || 0)) winner = 0
      else if ((p1.errors || 0) < (p0.errors || 0)) winner = 1
    }
    this.broadcast({
      type: 'GAME_OVER',
      winner,
      stats: this.players.map(p => ({ name: p.name, finds: p.finds, time: p.t, skips: p.skips })),
    })
    await this.saveState()
  }
}
