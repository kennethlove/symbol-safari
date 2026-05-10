import { delaunay, voronoi } from './voronoi.js';
import { G, maxSkips, gameDuration, THEMES } from './state.js';

export const $ = id => document.getElementById(id);

export function cv(name) {
  return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
}

export let ACCENT = cv('accent');
export let P2_COLOR = cv('p2-color');
export const WRONG = cv('wrong');
export const FONT_MONO = cv('font-mono');

export let currentAccent = localStorage.getItem('sf-accent') || 'blue';
export let currentP2Color = localStorage.getItem('sf-p2-color') || 'none';
export let currentMode = localStorage.getItem('sf-mode') || 'dark';

export const startScreen   = $('start-screen');
export const bgCanvas      = $('bg-canvas');
export const bgCtx         = bgCanvas.getContext('2d');
export const gameScreen    = $('game-screen');
export const resultsScreen = $('results-screen');
export const canvas        = $('game-canvas');
export const ctx           = canvas.getContext('2d');
export const fxCanvas      = $('fx-canvas');
export const fxCtx         = fxCanvas.getContext('2d');
export const startBtn      = $('start-btn');
export const timerBarFill  = $('timer-bar-fill');
export const timerRingFill = $('timer-ring-fill');
export const timerRingText = $('timer-ring-text');
export const targetNumEl   = $('target-number');
export const packNameLabel = $('pack-name-label');
export const playerBadge   = $('player-badge');
export const soloFoundEl   = $('solo-found');
export const soloSkipsEl   = $('solo-skips');
export const soloRemainEl  = $('solo-remaining');
export const soloStats     = $('solo-stats');
export const pvpStats      = $('pvp-stats');
export const pvpName       = [ $('pvp-name-0'), $('pvp-name-1') ];
export const pvpFound      = [ $('pvp-found-0'), $('pvp-found-1') ];
export const pvpSkips      = [ $('pvp-skips-0'), $('pvp-skips-1') ];
export const pvpTime       = [ $('pvp-time-0'), $('pvp-time-1') ];
export const pvpSide       = [ $('pvp-side-0'), $('pvp-side-1') ];
export const winnerText    = $('winner-text');
export const winnerSub     = $('winner-sub');
export const resultsGrid   = $('results-grid');
export const resultBars    = $('result-bars');
export const playAgainBtn  = $('play-again-btn');
export const turnOverlay   = $('turn-overlay');
export const toPlayerText  = $('to-player-text');
export const toSubText     = $('to-sub-text');
export const hudSkipBtn    = $('hud-skip-btn');
export const goBtn         = $('go-btn');
export const toPreviewNum  = $('to-preview-num');
export const playField     = $('play-field');
export const p1NameInput   = $('p1-name');
export const p2NameInput   = $('p2-name');
export const p2InputGroup  = $('p2-input-group');
export const p2SwatchRow   = $('p2-swatch-row');
export const timeLimitInput = $('time-limit');
export const packPicker     = $('pack-picker');
export const onlineSection    = $('online-section')
export const onlineActions   = $('online-actions')
export const roomLobby       = $('room-lobby')
export const roomCodeDisplay = $('room-code-display')
export const lobbyStatus     = $('lobby-status')
export const joinFormEl      = $('join-form')
export const roomCodeInput   = $('room-code-input')
export const createRoomBtn   = $('btn-create-room')
export const joinRoomBtn     = $('btn-join-room')
export const joinBtn         = $('btn-join')
export const disconnectOverlay = $('disconnect-overlay')
export const opponentDisconnectOverlay = $('opponent-disconnect-overlay')
export const opponentMsg     = $('opponent-msg')

export function show(s) {
  [startScreen, gameScreen, resultsScreen].forEach(el => el.classList.add('hidden'));
  s.classList.remove('hidden');
}

export function resizeBg() {
  const r = startScreen.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  bgCanvas.width = r.width * dpr; bgCanvas.height = r.height * dpr;
  bgCanvas.style.width = r.width + 'px'; bgCanvas.style.height = r.height + 'px';
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function mPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

export function updateStats(G) {
  const remaining = G.avail.length;

  if (G.mode === 'solo') {
    soloFoundEl.textContent = `${G.found} / ${G.cells.length}`;
    const skipsLeft = maxSkips() - G.players[0].skips;
    soloSkipsEl.textContent = `${Math.max(0, skipsLeft)} / ${maxSkips()}`;
    soloRemainEl.textContent = String(remaining);
  } else {
    for (let i = 0; i < 2; i++) {
      const p = G.players[i];
      const isActive = G.pid === i && G.phase === 'playing';
      const skipsLeft = maxSkips() - p.skips;
      pvpFound[i].textContent = String(p.finds.length);
      pvpSkips[i].textContent = `${Math.max(0, skipsLeft)} / ${maxSkips()}`;
      pvpTime[i].textContent = p.t.toFixed(1) + 's';
      pvpName[i].textContent = p.n;
      pvpSide[i].classList.toggle('active-turn', isActive);
      if (G.mode === 'online') {
        pvpSide[i].classList.toggle('is-p2', i !== G.selfId);
      } else {
        pvpSide[i].classList.toggle('is-p2', i === 1);
      }
    }
  }
  timerRingText.textContent = String(Math.max(0, Math.ceil(G.shared)));
  const pct = G.shared / gameDuration;
  const circ = 2 * Math.PI * 19;
  timerRingFill.style.strokeDashoffset = String(circ * (1 - pct));
  timerBarFill.style.width = (pct * 100) + '%';
}

export function showTurnReadyUI(p, target, pid) {
  targetNumEl.style.color = pid === 1 ? P2_COLOR : ACCENT;
  targetNumEl.textContent = '??';
  toPlayerText.textContent = p.n;
  toSubText.textContent = 'Find the symbol';
  toPreviewNum.textContent = String(target);
  toPreviewNum.className = 'to-num show' + (G.mode !== 'online' && pid === 1 ? ' is-p2' : '');
  playerBadge.textContent = p.n;
  playerBadge.className = 'is-' + (pid === 0 ? 'p1' : 'p2');
  goBtn.style.display = 'inline-block';
  goBtn.classList.toggle('is-p2', pid === 1);
  turnOverlay.classList.add('active');
}

export function applyAccent(id) {
  const c = THEMES.accent[id];
  if (!c) return;
  document.documentElement.style.setProperty('--accent', c);
  const hslMatch = c.match(/oklch\([^)]+\)/);
  if (hslMatch) {
    const dim = hslMatch[0].replace(')', ' / 0.15)');
    const glow = hslMatch[0].replace(')', ' / 0.35)');
    document.documentElement.style.setProperty('--accent-dim', dim);
    document.documentElement.style.setProperty('--accent-glow', glow);
  }
  document.querySelectorAll('.swatch-row:not(#p2-swatch-row) .swatch').forEach(s => s.classList.toggle('selected', s.dataset.accent === id));
  currentAccent = id;
  localStorage.setItem('sf-accent', id);
  ACCENT = cv('accent');
  syncSwatches();
}

export function applyP2Color(id) {
  const c = THEMES.accent[id];
  if (!c) return;
  document.documentElement.style.setProperty('--p2-color', c);
  const m = c.match(/oklch\([^)]+\)/);
  if (m) {
    const bg = m[0].replace(')', ' / 0.08)');
    document.documentElement.style.setProperty('--p2-color-bg', bg);
    const dim = m[0].replace(')', ' / 0.15)');
    document.documentElement.style.setProperty('--p2-color-dim', dim);
  }
  document.querySelectorAll('#p2-swatch-row .swatch').forEach(s => s.classList.toggle('selected', s.dataset.p2Color === id));
  currentP2Color = id;
  localStorage.setItem('sf-p2-color', id);
  P2_COLOR = cv('p2-color');
  syncSwatches();
}

export function syncSwatches() {
  if (G.mode === 'online') return
  document.querySelectorAll('.swatch-row:not(#p2-swatch-row) .swatch').forEach(s => {
    s.classList.toggle('disabled', s.dataset.accent === currentP2Color && s.dataset.accent !== 'none');
  });
  document.querySelectorAll('#p2-swatch-row .swatch').forEach(s => {
    s.classList.toggle('disabled', s.dataset.p2Color === currentAccent);
  });
}

export function showOnlineUI(show) {
  onlineSection.classList.toggle('hidden', !show)
}

export function showLobby(code) {
  onlineActions.classList.add('hidden')
  roomLobby.classList.remove('hidden')
  joinFormEl.classList.add('hidden')
  roomCodeDisplay.textContent = code
}

export function setLobbyStatus(text) {
  lobbyStatus.textContent = text
}

export function showJoinForm() {
  onlineActions.classList.add('hidden')
  joinFormEl.classList.remove('hidden')
}

export function showDisconnected() {
  disconnectOverlay.classList.remove('hidden')
}

export function hideDisconnected() {
  disconnectOverlay.classList.add('hidden')
}

export function showOpponentDisconnected(msg) {
  opponentMsg.textContent = msg || 'Waiting for reconnection...'
  opponentDisconnectOverlay.classList.remove('hidden')
}

export function hideOpponentDisconnected() {
  opponentDisconnectOverlay.classList.add('hidden')
}

export function getRoomCode() {
  return roomCodeInput.value.trim()
}

export function bindEvents() {
  window.addEventListener('resize', resizeBg);
}

export function applyMode(m) {
  document.documentElement.setAttribute('data-theme', m);
  document.querySelectorAll('.mode-toggle button').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  currentMode = m;
  localStorage.setItem('sf-mode', m);
}

export let bgTime = 0;
export function setBgTime(t) { bgTime = t; }
export let bgCells = [];

export function initBg() {
  const rect = startScreen.getBoundingClientRect();
  const w = rect.width, h = rect.height;
  if (w < 100 || h < 100) return;
  bgCells = [];
  const sites = [];
  for (let i = 0; i < 35; i++) {
    sites.push({ x: 20 + Math.random() * (w - 40), y: 20 + Math.random() * (h - 40), ph: Math.random() * Math.PI * 2, sp: 0.2 + Math.random() * 0.4, ox: 0, oy: 0 });
  }
  const m = Math.max(w, h), cx = w/2, cy = h/2;
  const all = [...sites,
    { x: cx - m, y: cy - m }, { x: cx, y: cy - m }, { x: cx + m, y: cy - m },
    { x: cx - m, y: cy }, { x: cx + m, y: cy },
    { x: cx - m, y: cy + m }, { x: cx, y: cy + m }, { x: cx + m, y: cy + m }
  ];
  const tris = delaunay(all);
  const cells = voronoi(tris, all, sites.length, w, h);
  for (const c of cells) {
    c.nd = Math.hypot(c.site.x - cx, c.site.y - cy) / Math.max(w, h) * 2;
    c.ph = Math.random() * Math.PI * 2;
  }
  bgCells = cells;
}

export function drawBg(now) {
  const dpr = window.devicePixelRatio || 1;
  const w = bgCanvas.width / dpr, h = bgCanvas.height / dpr;
  if (w < 100 || h < 100 || bgCells.length === 0) return;
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  bgCtx.save();
  bgCtx.scale(dpr, dpr);
  bgCtx.fillStyle = cv('bg');
  bgCtx.fillRect(0, 0, w, h);

  const t = bgTime;
  const cx = w/2, cy = h/2;

  for (const cell of bgCells) {
    const v = cell.vertices;
    if (v.length < 3) continue;
    const nd = cell.nd || 0;
    const pulse = 0.06 + 0.04 * Math.sin(t * 0.5 + cell.ph);
    const hVal = 260 - nd * 40 + Math.sin(t * 0.3 + cell.ph) * 10;
    bgCtx.beginPath();
    bgCtx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) bgCtx.lineTo(v[i].x, v[i].y);
    bgCtx.closePath();
    bgCtx.fillStyle = `oklch(${(pulse * 100).toFixed(1)}% 0.03 ${hVal})`;
    bgCtx.fill();
    bgCtx.strokeStyle = `oklch(60% 0.02 260 / 0.04)`;
    bgCtx.lineWidth = 0.5;
    bgCtx.stroke();
  }

  const grad2 = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.55);
  grad2.addColorStop(0, 'oklch(68% 0.2 260 / 0.08)');
  grad2.addColorStop(0.5, 'oklch(65% 0.18 145 / 0.03)');
  grad2.addColorStop(1, 'transparent');
  bgCtx.fillStyle = grad2;
  bgCtx.fillRect(0, 0, w, h);

  bgCtx.restore();
}
