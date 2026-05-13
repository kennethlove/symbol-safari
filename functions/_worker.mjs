import { RoomDO } from '../src/room.mjs'

export { RoomDO }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() })
    }

    if (request.method === 'POST' && url.pathname === '/api/room') {
      return handleCreateRoom(request, env)
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/room/')) {
      return handleGetRoom(request, env, url)
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/room/')) {
      return handleJoinRoom(request, env, url)
    }

    if (url.pathname.startsWith('/ws/')) {
      return handleWebSocket(request, env, url)
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : undefined
  },
}

function makeRoomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

async function handleCreateRoom(request, env) {
  const body = await request.json().catch(() => ({}))
  const roomCode = makeRoomId()
  const id = env.ROOM.idFromName(roomCode)
  const stub = env.ROOM.get(id)

  const res = await stub.fetch(new Request(`http://do/api/room/${roomCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create', name: body.name, timeLimit: body.timeLimit, roomCode }),
  }))
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } })
}

async function handleGetRoom(request, env, url) {
  const parts = url.pathname.split('/')
  const roomCode = parts[3]
  const id = env.ROOM.idFromName(roomCode)
  const stub = env.ROOM.get(id)

  const res = await stub.fetch(new Request('http://do/api/room', { method: 'GET' }))
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } })
}

async function handleJoinRoom(request, env, url) {
  const parts = url.pathname.split('/')
  const roomCode = parts[3]
  const body = await request.json().catch(() => ({}))
  const id = env.ROOM.idFromName(roomCode)
  const stub = env.ROOM.get(id)

  const res = await stub.fetch(new Request(`http://do/api/room/${roomCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'join', name: body.name }),
  }))
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } })
}

async function handleWebSocket(request, env, url) {
  const parts = url.pathname.split('/')
  const roomCode = parts[2]
  const id = env.ROOM.idFromName(roomCode)
  const stub = env.ROOM.get(id)

  return stub.fetch(request)
}
