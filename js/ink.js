/* Lectern — vector ink: drawing, shapes, labels, numbers (all coords normalised 0..1) */
(function (H) {
  'use strict';
  H.ink = {};
  H.ink.COLORS = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#111827'];
  H.ink.SIZES = { pen: [0.0025, 0.0045, 0.008], hl: [0.012, 0.022, 0.036], shape: [0.002, 0.004, 0.007], text: [0.028, 0.04, 0.06], erase: [0.015, 0.03, 0.06] };

  function hexA(hex, a) {
    const m = hex.replace('#', '');
    const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  H.ink.drawOp = function (ctx, op, W, Hh) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (op.k === 'stroke') {
      const p = op.pts;
      if (!p || p.length < 2) { ctx.restore(); return; }
      ctx.strokeStyle = op.tool === 'hl' ? hexA(op.c, 0.38) : op.c;
      ctx.lineWidth = Math.max(1, op.w * W);
      if (op.tool === 'hl') ctx.globalCompositeOperation = 'multiply';
      ctx.beginPath();
      ctx.moveTo(p[0] * W, p[1] * Hh);
      if (p.length === 2) ctx.lineTo(p[0] * W + 0.1, p[1] * Hh + 0.1);
      for (let i = 2; i < p.length - 2; i += 2) {
        const mx = (p[i] + p[i + 2]) / 2 * W, my = (p[i + 1] + p[i + 3]) / 2 * Hh;
        ctx.quadraticCurveTo(p[i] * W, p[i + 1] * Hh, mx, my);
      }
      if (p.length >= 4) ctx.lineTo(p[p.length - 2] * W, p[p.length - 1] * Hh);
      ctx.stroke();
    } else if (op.k === 'shape') {
      const x1 = op.x1 * W, y1 = op.y1 * Hh, x2 = op.x2 * W, y2 = op.y2 * Hh;
      ctx.strokeStyle = op.c; ctx.fillStyle = hexA(op.c, 0.28);
      ctx.lineWidth = Math.max(1.5, op.w * W);
      ctx.beginPath();
      if (op.kind === 'rect') ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      else if (op.kind === 'circle') ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2 || 1, Math.abs(y2 - y1) / 2 || 1, 0, 0, Math.PI * 2);
      else { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      if (op.fill && (op.kind === 'rect' || op.kind === 'circle')) ctx.fill();
      ctx.stroke();
      if (op.kind === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1), L = Math.max(14, ctx.lineWidth * 4.5);
        ctx.beginPath();
        ctx.moveTo(x2, y2); ctx.lineTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45));
        ctx.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45)); ctx.closePath();
        ctx.fillStyle = op.c; ctx.fill();
      }
    } else if (op.k === 'text') {
      const fs = Math.max(10, op.s * W);
      ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      const lines = String(op.text).split('\n');
      const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const pad = fs * 0.35, lh = fs * 1.2, bh = lh * lines.length + pad;
      const rtl = /[؀-ۿ]/.test(op.text);
      if (op.bg !== false) {
        ctx.fillStyle = 'rgba(17,24,39,0.82)';
        roundRect(ctx, op.x * W - pad, op.y * Hh - bh / 2, tw + pad * 2, bh, fs * 0.25); ctx.fill();
      }
      ctx.fillStyle = op.c; ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
      lines.forEach((l, i) => ctx.fillText(l, op.x * W + (rtl ? tw : 0), op.y * Hh - bh / 2 + pad / 2 + lh * (i + 0.5)));
    } else if (op.k === 'num') {
      const r = Math.max(10, op.s * W * 0.6);
      ctx.beginPath(); ctx.arc(op.x * W, op.y * Hh, r, 0, Math.PI * 2);
      ctx.fillStyle = op.c; ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.12); ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = contrast(op.c); ctx.font = `800 ${r * 1.15}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(op.n), op.x * W, op.y * Hh + r * 0.05);
    }
    ctx.restore();
  };
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function contrast(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const l = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return l > 150 ? '#111827' : '#ffffff';
  }

  H.ink.render = function (canvas, ops, live) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, Hh = canvas.height;
    ctx.clearRect(0, 0, W, Hh);
    (ops || []).forEach((o) => H.ink.drawOp(ctx, o, W, Hh));
    if (live) (Array.isArray(live) ? live : [live]).forEach((o) => o && H.ink.drawOp(ctx, o, W, Hh));
  };

  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let tt = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
    tt = Math.max(0, Math.min(1, tt));
    return Math.hypot(px - (x1 + tt * dx), py - (y1 + tt * dy));
  }
  /** index of top-most op hit at (x,y) within radius r (normalised, aspect = W/H) */
  H.ink.hit = function (ops, x, y, r, aspect = 16 / 9) {
    const ax = (v) => v * aspect; // measure in height units so circles are round
    for (let i = ops.length - 1; i >= 0; i--) {
      const o = ops[i];
      if (o.k === 'stroke') {
        const p = o.pts, rr = r + o.w * aspect / 2;
        for (let j = 0; j < p.length - 2; j += 2) if (segDist(ax(x), y, ax(p[j]), p[j + 1], ax(p[j + 2]), p[j + 3]) < rr) return i;
        if (p.length === 2 && Math.hypot(ax(x - p[0]), y - p[1]) < rr) return i;
      } else if (o.k === 'shape') {
        const x1 = Math.min(o.x1, o.x2), x2 = Math.max(o.x1, o.x2), y1 = Math.min(o.y1, o.y2), y2 = Math.max(o.y1, o.y2);
        if (o.kind === 'line' || o.kind === 'arrow') { if (segDist(ax(x), y, ax(o.x1), o.y1, ax(o.x2), o.y2) < r * 1.3) return i; }
        else if (x > x1 - r && x < x2 + r && y > y1 - r && y < y2 + r) return i;
      } else if (o.k === 'text') {
        const w = o.s * String(o.text).length * 0.6, hh = o.s * aspect * 1.4 * String(o.text).split('\n').length;
        if (x > o.x - r && x < o.x + w + r && Math.abs(y - o.y) < hh / 2 + r) return i;
      } else if (o.k === 'num') {
        if (Math.hypot(ax(x - o.x), y - o.y) < o.s * aspect * 0.7 + r) return i;
      }
    }
    return -1;
  };
})(window.Hub);
