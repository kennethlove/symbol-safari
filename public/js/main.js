import { G, gameDuration, setGameDuration, selectedPackId, setup, endGame, handleFind, flashWrong, handleSkip, initPackPicker, initThemeUI, startTurn, completeTurn, showTurnReady } from './state.js';
import { render, resize, hitTest, setMousePos, cW, cH } from './renderer.js';
import { polyArea, minEdgeDist } from './voronoi.js';
import { tickFX, renderFX } from './effects.js';
import { spawnFX } from './effects.js';
import {
  show, startScreen, gameScreen, resultsScreen,
  startBtn, playAgainBtn, hudSkipBtn, goBtn,
  canvas, ctx, fxCtx,
  timerRingText, timerRingFill, timerBarFill,
  ACCENT, P2_COLOR, WRONG, updateStats,
  resizeBg, initBg, drawBg, bgTime, setBgTime, bgCells,
  p2InputGroup, p2SwatchRow, p1NameInput, p2NameInput,
  timeLimitInput, playField, mPos,
  targetNumEl, turnOverlay, toPreviewNum, toPlayerText, toSubText, playerBadge,
  resultsGrid, resultBars, winnerText, winnerSub,
  showOnlineUI, onlineActions, roomLobby, joinFormEl,
  createRoomBtn, joinRoomBtn, joinBtn, roomCodeDisplay, lobbyStatus,
  showLobby, setLobbyStatus, showJoinForm, getRoomCode,
  copyCodeBtn, copyLinkBtn,
  showDisconnected, hideDisconnected,
  showOpponentDisconnected, hideOpponentDisconnected,
} from './ui.js';
import { connect, send, disconnect, setServerHost, apiURL } from './network.js';

let onlinePlayerIndex = -1

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    G.mode = btn.dataset.mode;
    p2InputGroup.style.display = G.mode === 'pvp' ? 'flex' : 'none';
    p2SwatchRow.style.display = G.mode === 'pvp' ? 'flex' : 'none';
    document.getElementById('p1-name-label').textContent = G.mode === 'online' ? 'Your Name' : 'Player 1';
    if (G.mode === 'online') {
      showOnlineUI(true);
      startBtn.style.display = 'none';
      document.querySelector('#pvp-stats').style.display = 'flex'
      document.querySelector('#solo-stats').style.display = 'none'
    } else {
      showOnlineUI(false);
      startBtn.style.display = '';
      onlineActions.classList.remove('hidden');
      roomLobby.classList.add('hidden');
      joinFormEl.classList.add('hidden');
    }
  });
});

startBtn.addEventListener('click', () => {
  let gd = parseInt(timeLimitInput.value, 10) || 60;
  if (gd < 5) gd = 5;
  if (gd > 600) gd = 600;
  setGameDuration(gd);
  G.players[0].n = p1NameInput.value.trim() || 'Player 1';
  G.players[1].n = p2NameInput.value.trim() || 'Player 2';
  show(gameScreen);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resize();
      if (cW < 100 || cH < 100) return;
      setup();
      G.lt = performance.now();
    });
  });
});

playAgainBtn.addEventListener('click', () => {
  resultsGrid.innerHTML = ''; resultBars.innerHTML = '';
  winnerText.textContent = ''; winnerSub.textContent = '';
  turnOverlay.classList.remove('active');
  toPreviewNum.className = 'to-num';
  goBtn.style.display = 'none';
  G.phase = 'idle';
  show(startScreen);
  resizeBg();
  initBg();
});

hudSkipBtn.addEventListener('click', () => {
  if (G.mode === 'online') {
    send({ type: 'SKIP' })
    return
  }
  handleSkip()
})

goBtn.addEventListener('click', () => {
  turnOverlay.classList.remove('active');
  toPreviewNum.className = 'to-num';
  goBtn.style.display = 'none';
  if (G.mode === 'online') {
    send({ type: 'READY' })
    G.phase = 'ready'
    return
  }
  if (G.phase !== 'ready') return;
  if (G.shared <= 0) { endGame(); return; }
  G.phase = 'playing';
  startTurn();
});

canvas.addEventListener('mousemove', e => {
  const m = mPos(e);
  const r = playField.getBoundingClientRect();
  setMousePos(e.clientX - r.left, e.clientY - r.top);
  if (G.phase !== 'playing') { canvas.style.cursor = 'default'; return; }
  const hit = hitTest(m.x, m.y, G);
  let ch = false;
  for (const c of G.cells) { const h = c === hit; if (c.hover !== h) { c.hover = h; ch = true; } }
  if (ch) render(ctx, fxCtx, G);
  canvas.style.cursor = hit ? 'pointer' : 'default';
});

canvas.addEventListener('mousedown', e => {
  if (G.phase !== 'playing') return;
  const m = mPos(e);
  const hit = hitTest(m.x, m.y, G);
  if (!hit) return;
  if (G.mode === 'online') {
    send({ type: 'CLICK', x: m.x, y: m.y })
    return
  }
  if (hit.num === G.target) handleFind(hit);
  else flashWrong(hit);
});

window.addEventListener('resize', () => {
  resize();
  resizeBg();
  if (G.phase === 'playing') render(ctx, fxCtx, G);
});

// ── Online handlers ──

createRoomBtn.addEventListener('click', async () => {
  try {
    const name = p1NameInput.value.trim() || 'Player 1'
    const res = await fetch(apiURL('/api/room'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    if (!res.ok) { setLobbyStatus('Server error'); return }
    const data = await res.json()
    onlinePlayerIndex = data.playerIndex
    G.players[onlinePlayerIndex].n = name
    showLobby(data.roomCode)
    updateStats(G)
    connect(data.roomCode, data.playerIndex, handleMsg)
  } catch (e) {
    setLobbyStatus('Failed to create room')
  }
})

joinRoomBtn.addEventListener('click', () => showJoinForm())

joinBtn.addEventListener('click', async () => {
  try {
    const name = p1NameInput.value.trim() || 'Player 1'
    const code = getRoomCode()
    if (!code) return
    const res = await fetch(apiURL(`/api/room/${code}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    if (!res.ok) { setLobbyStatus('Room not found or full'); return }
    const data = await res.json()
    onlinePlayerIndex = data.playerIndex
    G.players[onlinePlayerIndex].n = name
    showLobby(code)
    updateStats(G)
    connect(code, data.playerIndex, handleMsg)
  } catch (e) {
    setLobbyStatus('Failed to join room')
  }
})

copyCodeBtn.addEventListener('click', async () => {
  const code = roomCodeDisplay.textContent
  if (!code) return
  try {
    await navigator.clipboard.writeText(code)
    copyCodeBtn.classList.add('copied')
    copyCodeBtn.textContent = 'Copied!'
    setTimeout(() => { copyCodeBtn.classList.remove('copied'); copyCodeBtn.textContent = 'Copy Code' }, 2000)
  } catch { /* fallback: select the code text */ }
})

copyLinkBtn.addEventListener('click', async () => {
  const code = roomCodeDisplay.textContent
  if (!code) return
  const link = window.location.origin + window.location.pathname.replace(/\/$/, '') + '?room=' + code
  try {
    await navigator.clipboard.writeText(link)
    copyLinkBtn.classList.add('copied')
    copyLinkBtn.textContent = 'Copied!'
    setTimeout(() => { copyLinkBtn.classList.remove('copied'); copyLinkBtn.textContent = 'Copy Link' }, 2000)
  } catch { /* fallback */ }
})

function handleMsg(msg) {
  switch (msg.type) {
    case 'GAME_START': {
      G.mode = 'online'
      G.phase = 'playing'
      G.selfId = onlinePlayerIndex
      G.players = msg.players.map((p, i) => ({ n: p.name, t: 0, finds: [], skips: 0 }))
      G.cells = msg.cells.map(c => ({ ...c, hover: false, wr: 0 }))
      G.avail = msg.avail.slice()
      G.found = 0
      G.seed = msg.seed
      G.shared = msg.shared
      G.pid = msg.pid
      G.running = false
      G.turnMs = 0
      G.last = null
      G.best = Infinity
      G.fx = []
      G.target = null
      G.packFont = ''
      G.time = 0
      G.lt = 0

      document.querySelector('#pvp-stats').style.display = 'flex'
      document.querySelector('#solo-stats').style.display = 'none'
      document.querySelector('.hud-right .t-label').style.display = 'none'
      show(gameScreen)
      resize()
      const cx = cW / 2, cy = cH / 2
      let maxD = 0
      for (const c of G.cells) {
        c.d = Math.hypot(c.site.x - cx, c.site.y - cy)
        if (c.d > maxD) maxD = c.d
        c.pa = Math.atan2(c.site.y - cy, c.site.x - cx)
        c.area = polyArea(c.vertices)
        c.minEdge = minEdgeDist(c.site.x, c.site.y, c.vertices)
      }
      for (const c of G.cells) c.nd = maxD > 0 ? c.d / maxD : 0
      const radii = G.cells.map(c => c.minEdge).sort((a, b) => a - b)
      G.globalFontSize = Math.max(20, Math.min(46, radii[Math.max(0, Math.floor(radii.length * 0.3))] * 1.6))
      render(ctx, fxCtx, G)
      updateStats(G)
      targetNumEl.textContent = '??'
      targetNumEl.style.color = ''
      timerRingText.textContent = String(G.shared.toFixed(1))
      timerBarFill.style.width = '100%'
      timerBarFill.className = ''
      const circ = 2 * Math.PI * 19
      timerRingFill.style.stroke = ACCENT
      timerRingFill.style.strokeDasharray = String(circ)
      timerRingFill.style.strokeDashoffset = '0'
      playerBadge.textContent = G.players[onlinePlayerIndex].n
      playerBadge.className = 'is-p1'
      break
    }
    case 'TURN_START': {
      G.phase = 'ready'
      G.target = msg.target
      G.pid = msg.pid
      const p = G.players[onlinePlayerIndex]
      toPlayerText.textContent = p.n
      toSubText.textContent = 'Find the symbol'
      toPreviewNum.textContent = String(msg.target)
      toPreviewNum.className = 'to-num show'
      playerBadge.textContent = p.n
      playerBadge.className = 'is-p1'
      goBtn.style.display = 'inline-block'
      goBtn.classList.toggle('is-p2', G.mode !== 'online' && onlinePlayerIndex === 1)
      turnOverlay.classList.add('active')
      targetNumEl.style.color = ACCENT
      targetNumEl.textContent = '??'
      break
    }
    case 'GO': {
      G.phase = 'playing'
      G.running = true
      G.turnMs = 0
      turnOverlay.classList.remove('active')
      targetNumEl.textContent = String(G.target)
      targetNumEl.style.color = ACCENT
      targetNumEl.classList.add('pop')
      setTimeout(() => targetNumEl.classList.remove('pop'), 200)
      render(ctx, fxCtx, G)
      break
    }
    case 'CELL_FOUND': {
      const cell = G.cells.find(c => c.num === msg.num)
      if (!cell) break
      cell.found = true
      cell.fb = msg.playerIndex
      G.avail = G.avail.filter(n => n !== msg.num)
      G.found++
      if (msg.playerIndex === onlinePlayerIndex) {
        G.players[msg.playerIndex].t += msg.time / 1000
        G.players[msg.playerIndex].finds.push({ num: msg.num, time: msg.time / 1000 })
      }
      const pColor = msg.playerIndex === onlinePlayerIndex ? ACCENT : P2_COLOR
      spawnFX(cell.site.x, cell.site.y, 'find', pColor)
      updateStats(G)
      render(ctx, fxCtx, G)
      break
    }
    case 'CELL_WRONG': {
      const hit = G.cells.find(c => {
        const dx = c.site.x - msg.x, dy = c.site.y - msg.y
        return !c.found && Math.hypot(dx, dy) < 22
      })
      if (hit) {
        hit.wr = 1
        render(ctx, fxCtx, G)
        setTimeout(() => { hit.wr = 0; render(ctx, fxCtx, G) }, 200)
      }
      break
    }
    case 'SKIP': {
      const p = G.players[msg.playerIndex]
      if (p) p.skips++
      updateStats(G)
      break
    }
    case 'TURN_WAIT': {
      G.phase = 'ready'
      toPlayerText.textContent = G.players[msg.player].n
      toSubText.textContent = 'is finding the symbol...'
      toPreviewNum.textContent = ''
      toPreviewNum.className = 'to-num'
      goBtn.style.display = 'none'
      playerBadge.textContent = G.players[onlinePlayerIndex].n
      playerBadge.className = 'is-p1'
      updateStats(G)
      turnOverlay.classList.add('active')
      break
    }
    case 'TIMER_SYNC':
      G.shared = msg.remaining
      updateStats(G)
      break
    case 'GAME_OVER': {
      G.phase = 'result'; G.running = false;
      if (msg.winner === onlinePlayerIndex) {
        winnerText.textContent = 'You Win!'
      } else if (msg.winner === -1) {
        winnerText.textContent = "It's a Tie!"
      } else {
        winnerText.textContent = 'You Lose'
      }
      winnerSub.textContent = `${gameDuration.toFixed(1)}s · Numbers (${G.cells.length} cells)`
      const p1s = msg.stats[0], p2s = msg.stats[1]
      const t1 = p1s.time / 1000, t2 = p2s.time / 1000
      const mx = Math.max(t1, t2, 0.01)
      const selfColor = 'var(--accent)'
      const oppColor = 'oklch(55% 0 0)'
      const c1 = onlinePlayerIndex === 0 ? selfColor : oppColor
      const c2 = onlinePlayerIndex === 1 ? selfColor : oppColor
      resultBars.innerHTML = `
        <div class="rb-group"><div class="rb-label" style="color:${c1}">${p1s.name}</div><div class="rb-track"><div class="rb-fill" style="height:0%;background:${c1};border-radius:4px"></div></div><div class="rb-val">${t1.toFixed(1)}s</div></div>
        <div class="rb-group"><div class="rb-label" style="color:${c2}">${p2s.name}</div><div class="rb-track"><div class="rb-fill" style="height:0%;background:${c2};border-radius:4px"></div></div><div class="rb-val">${t2.toFixed(1)}s</div></div>`
      setTimeout(() => {
        const fs = resultBars.querySelectorAll('.rb-fill')
        if (fs[0]) fs[0].style.height = ((t1 / mx) * 100) + '%'
        if (fs[1]) fs[1].style.height = ((t2 / mx) * 100) + '%'
      }, 50)
      const card = (stats, iw, hl) => {
        const cnt = stats.finds.length
        const t = stats.time / 1000
        const avg = cnt > 0 ? t / cnt : 0
        const pts = []
        if (stats.skips > 0) pts.push(`${stats.skips} skipped`)
        if (avg > 0) pts.push(`${avg.toFixed(2)}s avg`)
        const wStyle = iw ? `border-color:${hl};background:color-mix(in srgb, ${hl} 10%, transparent)` : ''
        return `<div class="r-card"${iw ? ` style="${wStyle}"` : ''}><div class="rc-name">${stats.name}</div><div class="rc-stat">${cnt} found · ${t.toFixed(1)}s</div><div class="rc-sub" style="font-size:12px;color:var(--muted);margin-top:4px">${pts.join(' \u00b7 ')}</div></div>`
      }
      resultsGrid.innerHTML = card(p1s, 0 === msg.winner, c1) + card(p2s, 1 === msg.winner, c2)
      gameScreen.classList.add('hidden')
      resultsScreen.classList.remove('hidden')
      break
    }
    case 'PLAYER_DISCONNECT':
      showOpponentDisconnected()
      break
    case 'PLAYER_RECONNECT':
      hideOpponentDisconnected()
      break
    case 'STATE_SYNC':
      G.cells = msg.state.cells.map(c => ({ ...c, hover: false, wr: 0 }))
      G.avail = msg.state.avail
      G.found = msg.state.found
      G.shared = msg.state.shared
      G.target = msg.state.target
      G.pid = msg.state.pid
      G.phase = msg.state.phase
      G.running = false
      G.turnMs = 0
      updateStats(G)
      render(ctx, fxCtx, G)
      hideDisconnected()
      break
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  if (G.phase === 'idle' || G.phase === 'result') { G.lt = 0; return; }
  if (G.lt === 0) { G.lt = now; return; }
  const dt = Math.min((now - G.lt) / 1000, gameDuration * 2);
  G.lt = now; G.time += dt;
  if (G.running) G.turnMs += dt * 1000;

  if (G.mode !== 'online' && G.phase !== 'ready') G.shared -= dt;
  if (G.shared <= 0 && G.mode !== 'online') { G.shared = 0; updateStats(G); if (G.phase === 'playing' || G.phase === 'ready') endGame(); return; }

  timerRingText.textContent = G.shared.toFixed(1);

  if (G.mode !== 'online') {
    const ringColor = G.pid === 1 ? P2_COLOR : ACCENT;
    timerRingFill.style.stroke = G.shared < 10 ? WRONG : ringColor;
    timerBarFill.classList.toggle('urgent', G.shared < 10);
    timerBarFill.classList.toggle('is-p2', G.pid === 1);
    timerRingFill.style.stroke = G.shared < 10 ? WRONG : ringColor;
  }

  const pct = G.shared / gameDuration;
  const circ = 2 * Math.PI * 19;
  timerRingFill.style.strokeDashoffset = String(circ * (1 - pct));
  timerBarFill.style.width = (pct * 100) + '%';

  tickFX(dt, G);
  renderFX(fxCtx, G);
  if (G.phase === 'playing') render(ctx, fxCtx, G);
}

document.addEventListener('DOMContentLoaded', () => {
  show(startScreen);
  resizeBg();
  initBg();
  initPackPicker();
  initThemeUI();
  requestAnimationFrame(function bgLoop(now) {
    if (G.phase === 'idle') { setBgTime(now / 1000); drawBg(now); }
    requestAnimationFrame(bgLoop);
  });
  requestAnimationFrame(loop);

  const roomParam = new URLSearchParams(window.location.search).get('room')
  if (roomParam) {
    const onlineBtn = document.querySelector('.mode-btn[data-mode="online"]')
    if (onlineBtn) onlineBtn.click()
    document.getElementById('room-code-input').value = roomParam
    showJoinForm()
  }
});
