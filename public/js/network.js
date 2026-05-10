let ws = null
let messageHandler = null
let reconnectTimer = null
let roomCode = null
let playerIndex = null
const RECONNECT_INTERVAL = 2000

export let SERVER_HOST = location.host

export function setServerHost(host) {
  SERVER_HOST = host
}

export function apiURL(path) {
  return `//${SERVER_HOST}${path}`
}

export function connect(code, index, onMessage) {
  roomCode = code
  playerIndex = index
  messageHandler = onMessage

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${SERVER_HOST}/ws/${code}?player=${index}`
  ws = new WebSocket(url)

  ws.onopen = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (messageHandler) messageHandler(msg)
    } catch (err) {
      console.warn('Invalid message:', e.data)
    }
  }

  ws.onclose = () => {
    ws = null
    reconnectTimer = setTimeout(() => {
      if (roomCode && playerIndex !== null && messageHandler)
        connect(roomCode, playerIndex, messageHandler)
    }, RECONNECT_INTERVAL)
  }
}

export function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(msg))
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
  roomCode = null
  playerIndex = null
  messageHandler = null
}
