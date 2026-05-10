import { genV, polyArea, minEdgeDist } from './voronoi.js';
import {
  show, startScreen, gameScreen, resultsScreen,
  soloStats, pvpStats, targetNumEl, packNameLabel,
  timerRingText, timerBarFill, timerRingFill,
  hudSkipBtn, playerBadge, toPlayerText, toSubText,
  toPreviewNum, goBtn, turnOverlay,
  winnerText, winnerSub, resultsGrid, resultBars,
  pvpName, pvpFound, pvpSkips, pvpTime, pvpSide,
  soloFoundEl, soloSkipsEl, soloRemainEl,
  ACCENT, P2_COLOR, WRONG, FONT_MONO,
  updateStats, showTurnReadyUI, packPicker,
  applyAccent, applyP2Color, applyMode, syncSwatches,
  currentAccent, currentP2Color, currentMode,
  ctx, fxCtx,
} from './ui.js';
import { render, cW, cH } from './renderer.js';
import { spawnFX } from './effects.js';

export const NUM_MIN = 10, NUM_MAX = 99;
export const MAX_SKIPS_SOLO = 5;
export const MAX_SKIPS_PVP = 3;

export const SYMBOL_PACKS = {
  numbers: {
    id: 'numbers', name: 'Numbers', cells: 90, desc: '10–99',
    symbols: [],
    font: 'var(--font-mono)',
    makePreview: () => ['14','67','38','92','51','26','73','45','89']
  },
};

export const THEMES = {
  accent: {
    blue:  'oklch(68% 0.2 260)',
    green: 'oklch(65% 0.18 145)',
    purple: 'oklch(62% 0.2 300)',
    orange: 'oklch(65% 0.18 55)',
    red:   'oklch(60% 0.2 25)',
    none:  'oklch(99% 0 0)'
  },
  mode: { light: 'light', dark: 'dark' }
};

export let selectedPackId = localStorage.getItem('sf-pack') || 'numbers';
export let gameDuration = 60;
export function setGameDuration(v) { gameDuration = v; }
export let lastStarter = -1;

export const G = {
  mode: 'solo', phase: 'idle',
  cells: [], avail: [], target: null,
  players: [{ n: 'Player 1', t: 0, finds: [], skips: 0 }, { n: 'Player 2', t: 0, finds: [], skips: 0 }],
  pid: 0, shared: 60, turnMs: 0, running: false,
  found: 0, best: Infinity, last: null, lt: 0, time: 0,
  fx: [],
};

export function cur() { return G.players[G.pid]; }
export function maxSkips() { return G.mode === 'solo' ? MAX_SKIPS_SOLO : MAX_SKIPS_PVP; }

function genGhosts(pad, w, h) {
  const gs = [];
  const n = Math.max(4, Math.ceil(Math.max(w, h) / (pad * 3)));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    gs.push({ x: t * w, y: -pad }, { x: t * w, y: h + pad });
  }
  for (let i = 1; i < n - 1; i++) {
    const t = i / (n - 1);
    gs.push({ x: -pad, y: t * h }, { x: w + pad, y: t * h });
  }
  return gs;
}

export function setup() {
  const pack = SYMBOL_PACKS[selectedPackId] || SYMBOL_PACKS.numbers;
  const cellCount = pack.cells;
  const symbols = pack.id === 'numbers'
    ? (() => { const s = []; for (let n = NUM_MIN; n <= NUM_MAX; n++) s.push(String(n)); return s; })()
    : [...pack.symbols];
  for (let i = symbols.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [symbols[i], symbols[j]] = [symbols[j], symbols[i]]; }

  const cells = genV(cW, cH, cellCount);
  if (cells.length === 0) { show(startScreen); return; }
  const ac = Math.min(cells.length, symbols.length);
  G.cells = cells.slice(0, ac);
  G.fx = [];
  const cx = cW / 2, cy = cH / 2;
  let maxD = 0;
  for (let i = 0; i < ac; i++) {
    const c = G.cells[i];
    c.num = symbols[i]; c.found = false; c.hover = false; c.fb = -1;
    c.d = Math.hypot(c.site.x - cx, c.site.y - cy);
    if (c.d > maxD) maxD = c.d;
    c.pa = Math.atan2(c.site.y - cy, c.site.x - cx);
    c.area = polyArea(c.vertices);
    c.minEdge = minEdgeDist(c.site.x, c.site.y, c.vertices);
  }
  for (const c of G.cells) c.nd = maxD > 0 ? c.d / maxD : 0;
  const radii = cells.map(c => c.minEdge).sort((a, b) => a - b);
  G.globalFontSize = Math.max(20, Math.min(46,
    radii[Math.max(0, Math.floor(radii.length * 0.3))] * 1.6
  ));
  const fontVar = pack.font.match(/--[\w-]+/);
  G.packFont = fontVar ? (getComputedStyle(document.documentElement).getPropertyValue(fontVar[0]).trim() || FONT_MONO) : FONT_MONO;
  G.avail = symbols.slice(0, ac);
  G.found = 0; G.best = Infinity; G.last = null;
  G.target = null; G.turnMs = 0;
  G.running = false; G.shared = gameDuration; G.lt = 0; G.time = 0;
  if (G.mode === 'pvp') {
    G.pid = (lastStarter + 1) % G.players.length;
    lastStarter = G.pid;
    soloStats.style.display = 'none';
    pvpStats.style.display = 'flex';
  } else {
    G.pid = 0;
    soloStats.style.display = 'flex';
    pvpStats.style.display = 'none';
  }

  for (const p of G.players) { p.t = 0; p.finds = []; p.skips = 0; }

  targetNumEl.textContent = '??'; targetNumEl.style.color = '';
  packNameLabel.textContent = 'Number';
  timerRingText.textContent = gameDuration.toFixed(1);
  timerBarFill.style.width = '100%'; timerBarFill.className = '';
  timerBarFill.classList.toggle('is-p2', G.pid === 1);
  const circ = 2 * Math.PI * 19;
  timerRingFill.style.stroke = G.pid === 1 ? P2_COLOR : ACCENT;
  timerRingFill.style.strokeDasharray = String(circ);
  timerRingFill.style.strokeDashoffset = '0';
  hudSkipBtn.style.display = 'none';

  document.querySelector('.hud-right .t-label').style.display = ''
  render(ctx, fxCtx, G);
  G.phase = 'playing';
  showTurnReady();
}

export function startTurn() {
  if (G.phase !== 'playing' || G.avail.length === 0) return;
  G.turnMs = 0; G.running = true;
  targetNumEl.textContent = String(G.target);
  targetNumEl.style.color = G.pid === 1 ? P2_COLOR : ACCENT;
  targetNumEl.classList.add('pop');
  setTimeout(() => targetNumEl.classList.remove('pop'), 200);
  const p = cur();
  playerBadge.textContent = p.n;
  playerBadge.className = 'is-' + (G.pid === 0 ? 'p1' : 'p2');
  const skipsLeft = maxSkips() - p.skips;
  hudSkipBtn.textContent = skipsLeft > 0 ? `Skip (${skipsLeft})` : 'Skip';
  hudSkipBtn.style.display = skipsLeft > 0 ? 'inline-block' : 'none';
  updateStats(G); render(ctx, fxCtx, G);
}

export function completeTurn() {
  G.running = false; hudSkipBtn.style.display = 'none';
  if (G.phase !== 'playing') return;
  if (G.avail.length === 0 || G.shared <= 0) { endGame(); return; }
  if (G.mode === 'pvp') G.pid = (G.pid + 1) % G.players.length;
  showTurnReady();
}

export function showTurnReady() {
  G.phase = 'ready';
  if (G.avail.length > 0) {
    let idx = Math.floor(Math.random() * G.avail.length);
    if (G.avail.length > 1 && G.target !== null) {
      while (G.avail[idx] === G.target) {
        idx = Math.floor(Math.random() * G.avail.length);
      }
    }
    G.target = G.avail[idx];
  } else {
    G.target = null;
    endGame();
    return;
  }
  const p = cur();
  showTurnReadyUI(p, G.target, G.pid);
}

export function handleFind(cell) {
  if (G.phase !== 'playing' || !G.running || G.target === null) return;
  if (cell.num !== G.target) return;
  const elapsed = G.turnMs / 1000;
  G.running = false;
  const p = cur();
  p.t += elapsed; p.finds.push({ num: cell.num, time: elapsed });
  hudSkipBtn.style.display = 'none';
  G.avail = G.avail.filter(n => n !== cell.num);
  G.found++; G.last = elapsed * 1000;
  if (elapsed < G.best / 1000) G.best = elapsed * 1000;
  cell.found = true; cell.fb = G.pid;

  const pColor = G.pid === 1 ? P2_COLOR : ACCENT;
  spawnFX(cell.site.x, cell.site.y, 'find', pColor);

  const fsz2 = Math.max(14, Math.min(36, (G.globalFontSize || 28) * 0.5));
  G.fx.push({ kind: 'text', x: cell.site.x, y: cell.site.y - 18, txt: elapsed.toFixed(1) + 's', font: `700 ${fsz2}px ${FONT_MONO}`, color: pColor, life: 1 });

  updateStats(G); render(ctx, fxCtx, G);
  targetNumEl.style.color = pColor;
  setTimeout(completeTurn, 350);
}

export function flashWrong(cell) {
  spawnFX(cell.site.x, cell.site.y, 'wrong');
  cell.wr = 1; render(ctx, fxCtx, G);
  setTimeout(() => { cell.wr = 0; render(ctx, fxCtx, G); }, 200);
}

export function handleSkip() {
  if (G.phase !== 'playing' || !G.running) return;
  const p = cur();
  if (p.skips >= maxSkips()) return;
  G.running = false;
  p.skips++; G.last = null;
  hudSkipBtn.style.display = 'none';
  updateStats(G);
  setTimeout(completeTurn, 100);
}

export function endGame() {
  if (G.phase === 'result') return;
  G.running = false;
  G.phase = 'result';
  targetNumEl.textContent = '??'; targetNumEl.style.color = '';
  hudSkipBtn.style.display = 'none';
  turnOverlay.classList.remove('active');
  toPreviewNum.className = 'to-num';
  goBtn.style.display = 'none';
  gameScreen.classList.add('hidden');
  resultsScreen.classList.remove('hidden');

  const pack = SYMBOL_PACKS[selectedPackId] || SYMBOL_PACKS.numbers;
  const packLabel = pack.name + ' (' + pack.cells + ' cells)';

  if (G.mode === 'solo') {
    const p = G.players[0];
    const avg = p.finds.length > 0 ? (p.t / p.finds.length) : 0;
    winnerText.textContent = 'Game Over';
    winnerSub.textContent = `${gameDuration.toFixed(1)}s · ${packLabel}`;
    const xs = [];
    if (p.finds.length > 0) xs.push(`${avg.toFixed(2)}s avg`);
    if (p.skips > 0) xs.push(`${p.skips} skipped`);
    const estr = xs.length > 0 ? ' \u00b7 ' + xs.join(' \u00b7 ') : '';
    resultsGrid.innerHTML = `<div class="r-card winner"><div class="rc-name">${p.n}</div><div class="rc-stat" style="color:var(--accent)">${G.found} found · ${p.t.toFixed(1)}s</div><div class="rc-sub">${G.found} / ${G.cells.length} symbols${estr}</div></div>`;
    resultBars.innerHTML = '';
  } else {
    const p1 = G.players[0], p2 = G.players[1];
    const mx = Math.max(p1.t, p2.t, 0.01);
    const tie = Math.abs(p1.t - p2.t) < 0.01;
    let w = null;
    if (!tie) w = p1.t < p2.t ? p1 : p2;
    resultBars.innerHTML = `
      <div class="rb-group"><div class="rb-label" style="color:var(--accent)">${p1.n}</div><div class="rb-track"><div class="rb-fill p1" style="height:0%"></div></div><div class="rb-val">${p1.t.toFixed(1)}s</div></div>
      <div class="rb-group"><div class="rb-label" style="color:var(--p2-color)">${p2.n}</div><div class="rb-track"><div class="rb-fill p2" style="height:0%"></div></div><div class="rb-val">${p2.t.toFixed(1)}s</div></div>`;
    setTimeout(() => {
      const fs = resultBars.querySelectorAll('.rb-fill');
      if (fs[0]) fs[0].style.height = ((p1.t / mx) * 100) + '%';
      if (fs[1]) fs[1].style.height = ((p2.t / mx) * 100) + '%';
    }, 50);

    const card = (p, iw) => {
      const avg = p.finds.length > 0 ? (p.t / p.finds.length) : 0;
      const pts = [];
      if (p.skips > 0) pts.push(`${p.skips} skipped`);
      if (avg > 0) pts.push(`${avg.toFixed(2)}s avg`);
      const isP2 = p === G.players[1];
      const wClass = iw ? (isP2 ? ' winner-p2' : ' winner') : '';
      return `<div class="r-card${wClass}"><div class="rc-name">${p.n}</div><div class="rc-stat">${p.finds.length} found · ${p.t.toFixed(1)}s</div><div class="rc-sub" style="font-size:12px;color:var(--muted);margin-top:4px">${pts.join(' \u00b7 ')}</div></div>`;
    };
    if (tie) { winnerText.textContent = "It's a Tie!"; winnerSub.textContent = `${gameDuration.toFixed(1)}s · ${packLabel}`; }
    else { winnerText.textContent = `${w.n} Wins!`; winnerSub.textContent = `${gameDuration.toFixed(1)}s · ${packLabel}`; }
    resultsGrid.innerHTML = card(p1, w === p1) + card(p2, w === p2);
  }
}

export function initPackPicker() {
  packPicker.innerHTML = '';
  const ids = Object.keys(SYMBOL_PACKS);
  ids.forEach(id => {
    const p = SYMBOL_PACKS[id];
    const card = document.createElement('div');
    card.className = 'pack-card' + (id === selectedPackId ? ' selected' : '');
    card.dataset.pack = id;
    const pre = p.makePreview();
    card.innerHTML = `<div class="pc-name">${p.name}</div>
      <div class="pc-desc">${p.desc} · ${p.cells} cells</div>
      <div class="pc-grid">${pre.map(s => `<div class="pc-cell">${s}</div>`).join('')}</div>`;
    card.addEventListener('click', () => {
      document.querySelectorAll('.pack-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedPackId = id;
      localStorage.setItem('sf-pack', id);
    });
    packPicker.appendChild(card);
  });
}

export function initThemeUI() {
  applyAccent(currentAccent);
  applyP2Color(currentP2Color);
  applyMode(currentMode);
  syncSwatches();
  document.querySelectorAll('.swatch-row:not(#p2-swatch-row) .swatch').forEach(s => {
    s.addEventListener('click', () => applyAccent(s.dataset.accent));
  });
  document.querySelectorAll('#p2-swatch-row .swatch').forEach(s => {
    s.addEventListener('click', () => applyP2Color(s.dataset.p2Color));
  });
  document.querySelectorAll('.mode-toggle button').forEach(b => {
    b.addEventListener('click', () => applyMode(b.dataset.mode));
  });
}
