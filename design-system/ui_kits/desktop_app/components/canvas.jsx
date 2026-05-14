// Simplified pattern renderer — mesh / geometric / dots / stripes / emoji
// (emoji uses Twemoji-style PNGs via jsdelivr so we don't bundle a font).
// This is for the UI kit preview only; production logic lives in
// ambient/src/lib/patterns.ts and is more sophisticated.

const PRESET_PALETTES = {
  Sunset:  ['#1f0e3d', '#7b2cbf', '#e94560', '#ff9f1c', '#fcd34d'],
  Ocean:   ['#011627', '#0e2954', '#2e8bc0', '#5fd3bc', '#bfffcc'],
  Forest:  ['#0f1f12', '#264e36', '#5a8a52', '#a4c47e', '#dad7a0'],
  Pastel:  ['#fdf2f8', '#fbcfe8', '#c7d2fe', '#a7f3d0', '#fef3c7'],
  Mono:    ['#0a0a0a', '#262626', '#525252', '#a3a3a3', '#fafafa'],
  Vibrant: ['#0d0221', '#ff006e', '#fb5607', '#ffbe0b', '#3a86ff'],
  Cosmic:  ['#0c0a1f', '#7c5cff', '#ec4899', '#fbbf24', '#f1ecff'],
};

const DEFAULT_EMOJIS = ['✨', '🌙', '⭐', '💫', '🪐'];

function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1103515245 + 12345) >>> 0; return s / 0x100000000; };
}
function hexToRgba(hex, a) {
  const m = hex.replace('#', '');
  return `rgba(${parseInt(m.slice(0,2),16)},${parseInt(m.slice(2,4),16)},${parseInt(m.slice(4,6),16)},${a})`;
}

function drawMesh(ctx, w, h, cfg) {
  ctx.fillStyle = cfg.colors[0]; ctx.fillRect(0, 0, w, h);
  const r = seededRandom(cfg.seed);
  const blobs = 8;
  for (let i = 0; i < blobs; i++) {
    const cx = r() * w, cy = r() * h;
    const rad = Math.max(w, h) * (0.35 + r() * 0.45);
    const c = cfg.colors[1 + Math.floor(r() * (cfg.colors.length - 1))];
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, hexToRgba(c, 0.85));
    g.addColorStop(1, hexToRgba(c, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
}
function drawGeometric(ctx, w, h, cfg) {
  ctx.fillStyle = cfg.colors[0]; ctx.fillRect(0, 0, w, h);
  const r = seededRandom(cfg.seed);
  const n = Math.round(cfg.density * 0.6);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cfg.colors[1 + Math.floor(r() * (cfg.colors.length - 1))];
    const x = r() * w, y = r() * h, s = cfg.size * (0.6 + r() * 1.2);
    const shape = Math.floor(r() * 3);
    if (shape === 0) { ctx.fillRect(x - s/2, y - s/2, s, s); }
    else if (shape === 1) { ctx.beginPath(); ctx.arc(x, y, s/2, 0, Math.PI*2); ctx.fill(); }
    else {
      ctx.beginPath();
      ctx.moveTo(x, y - s/2);
      ctx.lineTo(x + s/2, y + s/2);
      ctx.lineTo(x - s/2, y + s/2);
      ctx.closePath(); ctx.fill();
    }
  }
}
function drawDots(ctx, w, h, cfg) {
  ctx.fillStyle = cfg.colors[0]; ctx.fillRect(0, 0, w, h);
  const r = seededRandom(cfg.seed);
  const cols = cfg.density;
  const cell = w / cols;
  const rows = Math.ceil(h / cell);
  const rad = cell * 0.4 * (cfg.size / 80);
  for (let yi = 0; yi < rows; yi++) {
    for (let xi = 0; xi < cols; xi++) {
      const jx = (r() - 0.5) * cell * cfg.randomness;
      const jy = (r() - 0.5) * cell * cfg.randomness;
      ctx.fillStyle = cfg.colors[1 + Math.floor(r() * (cfg.colors.length - 1))];
      ctx.beginPath(); ctx.arc(xi * cell + cell/2 + jx, yi * cell + cell/2 + jy, rad, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function drawStripes(ctx, w, h, cfg) {
  ctx.save();
  ctx.fillStyle = cfg.colors[0]; ctx.fillRect(0, 0, w, h);
  const r = seededRandom(cfg.seed);
  const stripeW = cfg.size * 1.5;
  const diag = Math.sqrt(w*w + h*h);
  ctx.translate(w/2, h/2); ctx.rotate(-Math.PI / 6); ctx.translate(-diag, -diag);
  let x = 0;
  while (x < diag * 2) {
    const t = stripeW * (0.6 + r() * 1.4);
    ctx.fillStyle = cfg.colors[1 + Math.floor(r() * (cfg.colors.length - 1))];
    ctx.fillRect(x, 0, t, diag * 2);
    x += t;
  }
  ctx.restore();
}
function drawEmojiBg(ctx, w, h, cfg, emojiImgs) {
  ctx.fillStyle = cfg.colors[0]; ctx.fillRect(0, 0, w, h);
  if (!emojiImgs || emojiImgs.length === 0) return;
  const r = seededRandom(cfg.seed);
  const cell = cfg.size * 1.6;
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  for (let yi = 0; yi < rows; yi++) {
    for (let xi = 0; xi < cols; xi++) {
      const img = emojiImgs[Math.floor(r() * emojiImgs.length)];
      if (!img) continue;
      const offset = yi % 2 === 1 ? cell / 2 : 0;
      const x = xi * cell - cell/2 + offset;
      const y = yi * cell - cell/2;
      const rot = (r() - 0.5) * 0.6;
      ctx.save(); ctx.translate(x + cell/2, y + cell/2); ctx.rotate(rot);
      const flip = r() > 0.5 ? -1 : 1;
      ctx.scale(flip, 1);
      ctx.drawImage(img, -cfg.size/2, -cfg.size/2, cfg.size, cfg.size);
      ctx.restore();
    }
  }
}

function renderPattern(ctx, w, h, cfg, emojiImgs) {
  if (cfg.type === 'mesh') return drawMesh(ctx, w, h, cfg);
  if (cfg.type === 'geometric') return drawGeometric(ctx, w, h, cfg);
  if (cfg.type === 'dots') return drawDots(ctx, w, h, cfg);
  if (cfg.type === 'stripes') return drawStripes(ctx, w, h, cfg);
  if (cfg.type === 'emoji') return drawEmojiBg(ctx, w, h, cfg, emojiImgs);
}

// Twemoji CDN — small PNGs we can render reliably in canvas. Fluent 3D would
// be ideal but is a much bigger setup; Twemoji conveys the idea.
function codepointKey(emoji) {
  const cps = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f) continue;
    cps.push(cp.toString(16));
  }
  return cps.join('-');
}
const _emojiCache = new Map();
function loadEmojiImg(emoji) {
  const key = codepointKey(emoji);
  if (_emojiCache.has(key)) return _emojiCache.get(key);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${key}.png`;
  });
  _emojiCache.set(key, p);
  return p;
}

Object.assign(window, {
  PRESET_PALETTES, DEFAULT_EMOJIS,
  renderPattern, loadEmojiImg, seededRandom,
});
