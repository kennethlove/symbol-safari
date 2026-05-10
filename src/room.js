const SYMBOL_PACKS = {
  numbers: { count: 20, id: 'numbers' },
  letters: { count: 20, id: 'letters' },
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 800
const H = 600
const CELL_RADIUS = 20

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
    this.id = ctx.id
    this.state = {
      phase: 'waiting',
      players: [],
      seed: null,
      cells: [],
      avail: [],
      target: null,
      turnMs: 0,
      running: false,
      shared: 120,
      found: 0,
      pid: 0,
      pack: 'numbers',
    }
  }

  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'POST' && url.pathname === '/api/room') {
      const { name } = await req.json()
      this.state.players.push({ name, ws: null, connected: true, disconnectedAt: null, finds: [], skips: 0, t: 0, errors: 0 })
      return new Response(JSON.stringify({
        roomCode: this.id.toString(),
        playerIndex: 0
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/room/')) {
      if (this.state.players.length >= 2)
        return new Response('Room full', { status: 400 })
      const { name } = await req.json()
      this.state.players.push({ name, ws: null, connected: true, disconnectedAt: null, finds: [], skips: 0, t: 0, errors: 0 })
      return new Response(JSON.stringify({
        roomCode: this.id.toString(),
        playerIndex: 1
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    if (url.pathname.startsWith('/ws/')) {
      const playerIndex = parseInt(url.searchParams.get('player'))
      if (isNaN(playerIndex) || playerIndex >= this.state.players.length)
        return new Response('Invalid player', { status: 400 })

      const player = this.state.players[playerIndex]

      if (player.disconnectedAt && Date.now() - player.disconnectedAt < 30000) {
        const pair = new WebSocketPair()
        const [client, server] = Object.values(pair)
        server.accept()
        player.ws = server
        player.connected = true
        player.disconnectedAt = null

        server.addEventListener('message', (e) => this.handleMessage(playerIndex, e.data))
        server.addEventListener('close', () => this.handleDisconnect(playerIndex))

        server.send(JSON.stringify({ type: 'STATE_SYNC', state: this.serializeState() }))

        this.broadcast({ type: 'PLAYER_RECONNECT', playerIndex }, playerIndex)

        await this.ctx.storage.setAlarm(Date.now() + 1000)

        return new Response(null, { status: 101, webSocket: client })
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      server.accept()
      player.ws = server
      player.connected = true
      player.disconnectedAt = null

      server.addEventListener('message', (e) => this.handleMessage(playerIndex, e.data))
      server.addEventListener('close', () => this.handleDisconnect(playerIndex))

      if (this.state.players.length === 2 && this.state.players.every(p => p.connected)) {
        this.startGame()
      }

      return new Response(null, { status: 101, webSocket: client })
    }
  }

  broadcast(msg, excludeIndex = -1) {
    const data = JSON.stringify(msg)
    for (let i = 0; i < this.state.players.length; i++) {
      const p = this.state.players[i]
      if (i !== excludeIndex && p.ws && p.connected) {
        try { p.ws.send(data) } catch (e) { }
      }
    }
  }

  serializeState() {
    const s = this.state
    const players = s.players.map(p => ({
      name: p.name,
      finds: p.finds,
      skips: p.skips,
      t: p.t,
      connected: p.connected,
    }))
    return {
      phase: s.phase,
      players,
      seed: s.seed,
      cells: s.cells,
      avail: s.avail,
      target: s.target,
      found: s.found,
      pid: s.pid,
      shared: s.shared,
      running: s.running,
    }
  }

  generateCells(rand) {
    const count = SYMBOL_PACKS[this.state.pack].count
    const cells = []
    for (let i = 0; i < count; i++) {
      cells.push({
        site: { x: rand() * W, y: rand() * H },
        num: i,
        fb: -1,
      })
    }
    return cells
  }

  startGame() {
    const s = this.state
    s.phase = 'playing'
    s.seed = Math.random()
    s.pack = 'numbers'

    const seedInt = Math.floor(s.seed * 2147483647)
    const rand = mulberry32(seedInt)

    s.cells = this.generateCells(rand)
    s.avail = s.cells.map(c => c.num)
    s.shared = 120
    s.pid = 0
    s.found = 0
    s.running = false
    s.turnMs = 0

    const playersInfo = s.players.map(p => ({ name: p.name }))
    const cellsData = s.cells.map(c => ({ num: c.num, site: c.site, found: c.found, fb: c.fb }))
    s.players.forEach((p, i) => {
      if (p.ws && p.connected) {
        p.ws.send(JSON.stringify({
          type: 'GAME_START',
          seed: s.seed,
          playerIndex: i,
          pid: i,
          players: playersInfo,
          cells: cellsData,
          avail: s.avail,
          shared: s.shared,
        }))
      }
    })

    this.startTurn()
  }

  startTurn() {
    const s = this.state
    if (s.avail.length === 0) {
      this.endGame()
      return
    }

    const seedInt = Math.floor((s.seed + s.found + s.pid) * 2147483647) % 2147483647
    const rand = mulberry32(seedInt)
    const idx = Math.floor(rand() * s.avail.length)
    s.target = s.avail[idx]
    s.turnMs = 0
    s.running = false

    const active = s.players[s.pid]
    if (active.ws && active.connected) {
      active.ws.send(JSON.stringify({ type: 'TURN_START', target: s.target, pid: s.pid }))
    }

    const otherPid = s.pid === 0 ? 1 : 0
    const other = s.players[otherPid]
    if (other.ws && other.connected) {
      other.ws.send(JSON.stringify({ type: 'TURN_WAIT', player: s.pid }))
    }

    this.ctx.storage.setAlarm(Date.now() + 1000)
  }

  handleMessage(playerIndex, data) {
    let msg
    try { msg = JSON.parse(data) } catch (e) { return }

    switch (msg.type) {
      case 'READY':
        if (this.state.running) return
        this.state.running = true
        const p = this.state.players[playerIndex]
        if (p.ws && p.connected) {
          p.ws.send(JSON.stringify({ type: 'GO' }))
        }
        break
      case 'CLICK':
        this.handleClick(playerIndex, msg.x, msg.y)
        break
      case 'SKIP':
        this.handleSkip(playerIndex)
        break
    }
  }

  handleClick(playerIndex, x, y) {
    const s = this.state
    if (playerIndex !== s.pid || !s.running) return

    let hitCell = null
    let bestDist2 = CELL_RADIUS * CELL_RADIUS
    for (const cell of s.cells) {
      if (cell.fb !== -1) continue
      const dx = cell.site.x - x
      const dy = cell.site.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < bestDist2) {
        hitCell = cell
        bestDist2 = d2
      }
    }

    if (!hitCell || hitCell.num !== s.target) {
      const active = s.players[s.pid]
      active.errors++
      if (active.ws && active.connected) {
        active.ws.send(JSON.stringify({ type: 'CELL_WRONG', x, y }))
      }
      return
    }

    hitCell.fb = playerIndex
    const player = s.players[playerIndex]
    player.finds.push({ num: hitCell.num, time: s.turnMs })
    player.t += s.turnMs
    s.found++

    this.broadcast({ type: 'CELL_FOUND', num: hitCell.num, time: s.turnMs, playerIndex })

    s.avail = s.avail.filter(n => n !== hitCell.num)

    if (s.avail.length === 0) {
      this.endGame()
    } else {
      s.pid = s.pid === 0 ? 1 : 0
      this.startTurn()
    }
  }

  handleSkip(playerIndex) {
    const s = this.state
    if (playerIndex !== s.pid) return

    const player = s.players[playerIndex]
    if (player.skips >= 3) return

    player.skips++

    this.broadcast({ type: 'SKIP', playerIndex })

    s.pid = s.pid === 0 ? 1 : 0
    this.startTurn()
  }

  async alarm() {
    const s = this.state
    if (s.phase !== 'playing') return

    s.shared--

    this.broadcast({ type: 'TIMER_SYNC', remaining: s.shared })

    if (s.shared <= 0) {
      this.endGame()
      return
    }

    if (s.running) {
      s.turnMs += 1000
    }

    await this.ctx.storage.setAlarm(Date.now() + 1000)
  }

  endGame() {
    const s = this.state
    s.phase = 'finished'
    s.running = false

    let winner = -1
    if (s.players.length === 2) {
      const p0 = s.players[0]
      const p1 = s.players[1]
      if (p0.t < p1.t) winner = 0
      else if (p1.t < p0.t) winner = 1
      else if (p0.errors < p1.errors) winner = 0
      else if (p1.errors < p0.errors) winner = 1
    }

    const stats = s.players.map(p => ({
      name: p.name,
      finds: p.finds,
      time: p.t,
      skips: p.skips,
    }))

    this.broadcast({ type: 'GAME_OVER', winner, stats })
  }

  handleDisconnect(playerIndex) {
    const player = this.state.players[playerIndex]
    if (!player) return

    player.connected = false
    player.disconnectedAt = Date.now()

    this.broadcast({ type: 'PLAYER_DISCONNECT', playerIndex }, playerIndex)

    this.ctx.storage.setAlarm(Date.now() + 30000)
  }
}
