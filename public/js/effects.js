import { G } from './state.js';
import { ACCENT, WRONG } from './ui.js';
import { cW, cH } from './renderer.js';

export function spawnFX(x, y, kind, color) {
  if (kind === 'find') {
    const c = color || ACCENT;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 120;
      G.fx.push({ kind: 'p', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, decay: 1 + Math.random() * 2, color: c, sz: 2 + Math.random() * 3 });
    }
    G.fx.push({ kind: 'ring', x, y, r: 5, maxR: Math.min(cW, cH) * 0.35, life: 1, color: c });
    G.fx.push({ kind: 'ring', x, y, r: 3, maxR: Math.min(cW, cH) * 0.2, life: 1, color: 'oklch(100% 0 0)' });
    G.fx.push({ kind: 'flash', life: 1 });
  } else if (kind === 'wrong') {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 60;
      G.fx.push({ kind: 'p', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, decay: 1.5 + Math.random() * 2, color: WRONG, sz: 1.5 + Math.random() * 2 });
    }
  }
}

export function tickFX(dt, G) {
  for (const fx of G.fx) {
    if (fx.life <= 0) continue;
    if (fx.kind === 'flash') {
      fx.life -= dt * 3;
    } else if (fx.kind === 'p') {
      fx.x += fx.vx * dt; fx.y += fx.vy * dt;
      fx.vx *= 0.95; fx.vy *= 0.95;
      fx.life -= dt * fx.decay;
    } else if (fx.kind === 'ring') {
      fx.life -= dt * 2.5;
    } else if (fx.kind === 'text') {
      fx.life -= dt * 2;
    }
  }
  G.fx = G.fx.filter(fx => fx.life > 0);
}

export function renderFX(fxCtx, G) {
  if (G.fx.length === 0) return;
  fxCtx.clearRect(0, 0, cW, cH);
  for (const fx of G.fx) {
    if (fx.kind === 'flash') {
      fxCtx.fillStyle = `oklch(100% 0 0 / ${fx.life * 0.08})`;
      fxCtx.fillRect(0, 0, cW, cH);
    } else if (fx.kind === 'p') {
      fxCtx.save();
      fxCtx.globalAlpha = fx.life;
      fxCtx.fillStyle = fx.color;
      fxCtx.beginPath();
      fxCtx.arc(fx.x, fx.y, fx.sz * fx.life, 0, Math.PI * 2);
      fxCtx.fill();
      fxCtx.restore();
    } else if (fx.kind === 'ring') {
      const r = fx.r + (1 - fx.life) * (fx.maxR - fx.r);
      fxCtx.save();
      fxCtx.globalAlpha = fx.life * 0.35;
      fxCtx.strokeStyle = fx.color;
      fxCtx.lineWidth = 3 * fx.life;
      fxCtx.beginPath();
      fxCtx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
      fxCtx.stroke();
      fxCtx.restore();
    } else if (fx.kind === 'text') {
      const yOff = (1 - fx.life) * 40;
      fxCtx.save();
      fxCtx.globalAlpha = fx.life;
      fxCtx.fillStyle = fx.color;
      fxCtx.font = fx.font;
      fxCtx.textAlign = 'center'; fxCtx.textBaseline = 'bottom';
      fxCtx.fillText(fx.txt, fx.x, fx.y + yOff);
      fxCtx.restore();
    }
  }
}
