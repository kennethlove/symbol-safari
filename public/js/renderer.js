import { playField, canvas, ctx, fxCanvas, fxCtx, cv, ACCENT, P2_COLOR, WRONG, FONT_MONO } from './ui.js';
import { pip } from './voronoi.js';

export let cW = 0, cH = 0;
let mouseX = -1, mouseY = -1;

export function setMousePos(x, y) {
  mouseX = x;
  mouseY = y;
}

export function resize() {
  if (!playField) return;
  const r = playField.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cW = r.width; cH = r.height;
  canvas.width = cW * dpr; canvas.height = cH * dpr;
  canvas.style.width = cW + 'px'; canvas.style.height = cH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fxCanvas.width = cW * dpr; fxCanvas.height = cH * dpr;
  fxCanvas.style.width = cW + 'px'; fxCanvas.style.height = cH + 'px';
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function okh(l, c, h) { return `oklch(${(l*100).toFixed(1)}% ${c} ${h})`; }

export function render(c, fx, G) {
  const w = cW, h = cH;
  c.clearRect(0, 0, w, h);

  const sx = mouseX >= 0 ? mouseX : w/2;
  const sy = mouseY >= 0 ? mouseY : h/2;
  const spotR = Math.max(w, h) * 0.7;

  const grad = c.createRadialGradient(sx, sy, 0, sx, sy, spotR);
  grad.addColorStop(0, 'oklch(22% 0.028 265)');
  grad.addColorStop(0.35, 'oklch(18% 0.018 260)');
  grad.addColorStop(0.6, 'oklch(14% 0.01 255)');
  grad.addColorStop(1, 'oklch(8% 0.004 250)');
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);

  const cells = G.cells;
  if (!cells || cells.length === 0) return;

  const t = G.time;
  const isP = G.phase === 'playing';
  const hueCycle = Math.sin(t * 0.08) * 5;

  const maxD2 = w * w + h * h;

  for (const cell of cells) {
    const v = cell.vertices;
    const isHover = cell.hover && isP;

    const dx = cell.site.x - sx, dy = cell.site.y - sy;
    const spot = Math.max(0, 1 - (dx*dx + dy*dy) / maxD2);

    if (v && v.length >= 3) {
      c.beginPath();
      c.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) c.lineTo(v[i].x, v[i].y);
      c.closePath();
    } else {
      c.beginPath();
      c.arc(cell.site.x, cell.site.y, 22, 0, Math.PI * 2);
      c.closePath();
    }

    if (cell.found) {
      const isOpponent = G.mode !== 'online' ? cell.fb === 1 : cell.fb !== G.selfId
      const fbColor = isOpponent ? P2_COLOR : ACCENT;
      c.save();
      c.globalAlpha = 0.15;
      c.fillStyle = fbColor;
      c.fill();
      c.globalAlpha = 0.35;
      c.strokeStyle = fbColor;
      c.lineWidth = 1.5;
      c.stroke();
      c.restore();
      continue;
    }
    if (cell.wr > 0) {
      c.fillStyle = okh(0.16, 0.25, 25);
    } else if (isHover) {
      c.fillStyle = cv(G.mode === 'online' ? 'accent-dim' : (G.pid === 1 ? 'p2-color-dim' : 'accent-dim'));
    } else {
      const b = 0.08 + 0.28 * Math.pow(spot, 2);
      c.fillStyle = `oklch(${(b * 100).toFixed(1)}% 0.022 ${260 + hueCycle})`;
    }
    c.fill();

    if (isHover) {
      const hc = G.mode === 'online' ? ACCENT : (G.pid === 1 ? P2_COLOR : ACCENT);
      c.save();
      c.shadowColor = hc;
      c.shadowBlur = 15;
      c.strokeStyle = hc;
      c.lineWidth = 2.5;
      c.stroke();
      c.restore();
    } else {
      const strokeA = 0.03 + 0.15 * Math.pow(spot, 2);
      c.strokeStyle = `oklch(55% 0.02 260 / ${strokeA.toFixed(3)})`;
      c.lineWidth = 0.5 + 0.6 * Math.pow(spot, 2);
      c.stroke();
    }
  }

  const cellFsz = G.globalFontSize || Math.max(22, Math.min(48, Math.sqrt((cW * cH) / cells.length) * 0.4));

  for (const cell of cells) {
    if (cell.num == null) continue;
    c.save();
    const dx = cell.site.x - sx, dy = cell.site.y - sy;
    const spot = Math.max(0, 1 - (dx*dx + dy*dy) / maxD2);

    if (cell.found) {
      const isOpponent = G.mode !== 'online' ? cell.fb === 1 : cell.fb !== G.selfId
      const fbColor = isOpponent ? P2_COLOR : ACCENT;
      c.globalAlpha = 0.5;
      c.fillStyle = fbColor;
      c.font = `600 ${cellFsz * 0.65}px ${G.packFont || FONT_MONO}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(cell.num), cell.site.x, cell.site.y);
      c.restore();
      continue;
    }
    if (cell.wr > 0) {
      c.fillStyle = WRONG;
      c.font = `700 ${Math.max(16, cellFsz * 0.6)}px ${FONT_MONO}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('\u2715', cell.site.x + 1, cell.site.y);
      c.restore();
      continue;
    } else {
      c.globalAlpha = 0.15 + 0.85 * Math.pow(spot, 3);
      const nb = 42 + 55 * Math.pow(spot, 2);
      c.fillStyle = `oklch(${nb.toFixed(1)}% 0.015 ${260 + hueCycle})`;
      c.font = `600 ${cellFsz}px ${G.packFont || FONT_MONO}`;
    }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(cell.num), cell.site.x, cell.site.y);
    c.restore();
  }
}

export function hitTest(mx, my, G) {
  for (const cell of G.cells) {
    if (cell.found) continue;
    if (cell.vertices) {
      if (pip(mx, my, cell.vertices)) return cell;
    } else {
      const dx = mx - cell.site.x, dy = my - cell.site.y;
      if (Math.hypot(dx, dy) < 22) return cell;
    }
  }
  return null;
}
