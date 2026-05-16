export type PatternType = 'mesh' | 'geometric' | 'dots' | 'stripes' | 'emoji';

export type GeometricShape = 'circles' | 'triangles' | 'squares' | 'mix';
export type GeometricFill = 'solid' | 'outline' | 'mix';

export interface PatternConfig {
  type: PatternType;
  colors: string[];
  density: number;
  size: number;
  emojis: string[];
  seed: number;
  // Tracks which preset (from COLOR_PRESETS) the current palette came
  // from. Clearing this on manual color edits lets the theme-mode swap
  // skip the override so custom palettes survive light/dark toggles.
  // Optional for migration: older saved configs predate this field.
  colorPresetId?: string;

  // --- Per-type fine-grained knobs. All optional; each renderer falls
  //     back to a sensible default when missing, so older persisted
  //     configs render unchanged.

  // Mesh: layer count + blur. meshBubbles defaults to a function of the
  // palette size (matches v0 behavior); meshSoftness 0–1 maps to a
  // blur range of ~0.5%–3% of max(w, h).
  meshBubbles?: number;
  meshSoftness?: number;

  // Geometric: restrict shape pool ('mix' = all four including lines,
  // anything else excludes lines and uses only the named shape) and
  // pick fill / outline / mix.
  geometricShape?: GeometricShape;
  geometricFill?: GeometricFill;

  // Dots: independent jitter and size-variation amounts. v0 wired both
  // to the (now removed) randomness slider.
  dotsJitter?: number;
  dotsSizeVar?: number;

  // Stripes: explicit angle in degrees (0 = vertical, 90 = horizontal)
  // and per-stripe width variation. v0 picked a random angle per seed.
  stripesAngle?: number;
  stripesWidthVar?: number;

  // Emoji: cap the ±rotation range (degrees), per-emoji size scatter,
  // and grid spacing as a percentage of the base glyph size (175 = the
  // hard-coded 1.75× from the previous pass).
  emojiRotationMax?: number;
  emojiSizeVar?: number;
  emojiSpacing?: number;
}

export interface ColorPreset {
  id: string;
  name: string;
  // First emoji is shown as the preset's visual badge; the full list is
  // applied to config.emojis when the preset is picked, so the Emoji
  // pattern type immediately renders in-theme.
  emojis: string[];
  light: string[];
  dark: string[];
}

// Curated set of 7 themed palettes. Each ships with a light and dark
// variant chosen to read well against the corresponding bg-base, plus
// paired emoji set so picking a theme auto-swaps the Emoji pattern's
// glyphs to match. Cosmic is first because it's the brand default.
export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'cosmic',
    name: 'Cosmic',
    emojis: ['✨', '🌙', '⭐', '💫', '🪐', '🌟', '☄️', '🌌', '🌠'],
    dark: ['#0c0a1f', '#7c5cff', '#ec4899', '#fbbf24', '#f1ecff'],
    light: ['#f1ecff', '#d6c1ff', '#ec4899', '#fbbf24', '#7c5cff'],
  },
  {
    id: 'pastel',
    name: 'Pastel',
    emojis: ['🌸', '🌷', '🍡', '🦄', '🩰', '🌺', '🐰', '🧸', '🪄', '🎀'],
    light: ['#fdf2f8', '#fbcfe8', '#c7d2fe', '#a7f3d0', '#fef3c7'],
    dark: ['#2a1f2e', '#7a4a6e', '#5a6da8', '#5a8a7e', '#a89968'],
  },
  {
    id: 'nature',
    name: 'Nature',
    emojis: ['🌿', '🌳', '🍃', '🌻', '🦋', '🌱', '🌷', '🐝', '🍄', '🌾'],
    light: ['#f0fdf4', '#bbf7d0', '#86efac', '#fde047', '#a16207'],
    dark: ['#0f1f12', '#264e36', '#5a8a52', '#a4c47e', '#dad7a0'],
  },
  {
    id: 'halloween',
    name: 'Halloween',
    emojis: ['🎃', '👻', '🦇', '🕸️', '🌙', '🕷️', '💀', '🧙', '🍬', '⚰️'],
    light: ['#fff7ed', '#fed7aa', '#ea580c', '#7c2d12', '#1a0f1a'],
    dark: ['#0a0010', '#1f0a1f', '#ea580c', '#dc2626', '#fbbf24'],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    emojis: ['🌊', '🐚', '🐠', '🪸', '⛵', '🐙', '🐡', '🦀', '🐳', '🦈'],
    light: ['#f0f9ff', '#bae6fd', '#38bdf8', '#0284c7', '#082f49'],
    dark: ['#011627', '#0e2954', '#2e8bc0', '#5fd3bc', '#bfffcc'],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    emojis: ['🌅', '🌇', '🔥', '🌺', '🌴', '🌵', '🌞', '🦩', '🏝️', '☀️'],
    light: ['#fff7ed', '#fed7aa', '#fb923c', '#f43f5e', '#7c2d12'],
    dark: ['#1f0e3d', '#7b2cbf', '#e94560', '#ff9f1c', '#fcd34d'],
  },
  {
    id: 'mono',
    name: 'Mono',
    // Full 8-phase lunar cycle reads as a single rhythmic set rather than
    // five random circles. New, Waxing crescent, First quarter, Waxing
    // gibbous, Full, Waning gibbous, Last quarter, Waning crescent.
    emojis: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
    light: ['#ffffff', '#e5e5e5', '#a3a3a3', '#525252', '#171717'],
    dark: ['#0a0a0a', '#262626', '#525252', '#a3a3a3', '#fafafa'],
  },
];

export function getPreset(id: string | undefined): ColorPreset | undefined {
  if (!id) return undefined;
  return COLOR_PRESETS.find((p) => p.id === id);
}

export const DEFAULT_EMOJIS = COLOR_PRESETS[0].emojis;

export const DEFAULT_CONFIG: PatternConfig = {
  type: 'mesh',
  colors: COLOR_PRESETS[0].dark,
  density: 40,
  size: 80,
  emojis: DEFAULT_EMOJIS,
  seed: Math.floor(Math.random() * 1_000_000),
  colorPresetId: COLOR_PRESETS[0].id,
};

// User-facing metadata for each pattern type — single source of truth used
// by the type picker UI and by library entries.
export const PATTERN_TYPES: { id: PatternType; emoji: string; name: string }[] = [
  { id: 'mesh', emoji: '🎨', name: 'Mesh' },
  { id: 'geometric', emoji: '🔺', name: 'Geometric' },
  { id: 'dots', emoji: '🔘', name: 'Dots' },
  { id: 'stripes', emoji: '🦓', name: 'Stripes' },
  { id: 'emoji', emoji: '😀', name: 'Emoji' },
];

// When the user switches pattern types we re-seed density/size + the
// per-type knobs into values that look right for the new renderer. Each
// entry seeds the type-specific defaults so the user always lands on a
// good starting point even if they never touch the controls.
export const TYPE_DEFAULTS: Record<PatternType, Partial<PatternConfig>> = {
  mesh: { meshBubbles: 16, meshSoftness: 0.5 },
  geometric: {
    density: 40,
    size: 60,
    geometricShape: 'mix',
    geometricFill: 'solid',
  },
  dots: { density: 18, size: 28, dotsJitter: 0.5, dotsSizeVar: 0.7 },
  stripes: { size: 60, stripesAngle: 30, stripesWidthVar: 0.5 },
  emoji: {
    size: 90,
    emojiRotationMax: 34,
    emojiSizeVar: 0.75,
    emojiSpacing: 175,
  },
};

// Per-type slider ranges + labels. Patterns that don't use a given control
// omit it here, and the UI hides the slider so dragging always changes
// something visible.
export const SLIDER_RANGES: Partial<
  Record<
    PatternType,
    {
      density?: { min: number; max: number; label: string };
      size?: { min: number; max: number };
    }
  >
> = {
  geometric: {
    density: { min: 10, max: 200, label: 'Shape count' },
    size: { min: 12, max: 120 },
  },
  dots: {
    density: { min: 6, max: 60, label: 'Density' },
    size: { min: 6, max: 80 },
  },
  stripes: { size: { min: 10, max: 140 } },
  emoji: { size: { min: 40, max: 140 } },
};

export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 0x100000000;
  };
}

function remap(t: number, min: number, max: number): number {
  return min + t * (max - min);
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

function preferHighQuality(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

// --- SVG emoji loader (Noto Emoji from jsDelivr) ---------------------------

type EmojiState =
  | { kind: 'loaded'; img: HTMLImageElement }
  | { kind: 'pending'; promise: Promise<HTMLImageElement> }
  | { kind: 'failed' };

const EMOJI_CACHE = new Map<string, EmojiState>();

// Cache key per unique emoji cluster (codepoints joined, VS16 stripped).
function codepointKey(emoji: string): string {
  const cps: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0xfe0f) continue; // skip VS16
    cps.push(cp.toString(16));
  }
  return cps.join('_');
}

// Microsoft Fluent 3D variants live at name-based paths in the fluentui-emoji
// repo. Curated map of popular wallpaper-aesthetic emojis → relative paths
// under the assets/ directory. Anything not in this map falls back to
// Fluent Color (flat) via emojicdn.elk.sh.
//
// Path format: <Directory>/3D/<filename>_3d.png  (spaces URL-encoded)
const FLUENT_3D: Record<string, string> = {
  '2728': 'Sparkles/3D/sparkles_3d.png',
  '1f319': 'Crescent%20moon/3D/crescent_moon_3d.png',
  '2b50': 'Star/3D/star_3d.png',
  '1f31f': 'Glowing%20star/3D/glowing_star_3d.png',
  '1f4ab': 'Dizzy/3D/dizzy_3d.png',
  '1fa90': 'Ringed%20planet/3D/ringed_planet_3d.png',
  '2764': 'Red%20heart/3D/red_heart_3d.png',
  '1f49c': 'Purple%20heart/3D/purple_heart_3d.png',
  '1f49b': 'Yellow%20heart/3D/yellow_heart_3d.png',
  '1f499': 'Blue%20heart/3D/blue_heart_3d.png',
  '1f49a': 'Green%20heart/3D/green_heart_3d.png',
  '1f9e1': 'Orange%20heart/3D/orange_heart_3d.png',
  '1f338': 'Cherry%20blossom/3D/cherry_blossom_3d.png',
  '1f33a': 'Hibiscus/3D/hibiscus_3d.png',
  '1f33b': 'Sunflower/3D/sunflower_3d.png',
  '1f339': 'Rose/3D/rose_3d.png',
  '1f33c': 'Blossom/3D/blossom_3d.png',
  '1f337': 'Tulip/3D/tulip_3d.png',
  '1f33f': 'Herb/3D/herb_3d.png',
  '1f343': 'Leaf%20fluttering%20in%20wind/3D/leaf_fluttering_in_wind_3d.png',
  '1f98b': 'Butterfly/3D/butterfly_3d.png',
  '1f308': 'Rainbow/3D/rainbow_3d.png',
  '26a1': 'High%20voltage/3D/high_voltage_3d.png',
  '1f525': 'Fire/3D/fire_3d.png',
  '1f48e': 'Gem%20stone/3D/gem_stone_3d.png',
  '1f380': 'Ribbon/3D/ribbon_3d.png',
  '1f353': 'Strawberry/3D/strawberry_3d.png',
  '1f351': 'Peach/3D/peach_3d.png',
  '1f352': 'Cherries/3D/cherries_3d.png',
  '1f344': 'Mushroom/3D/mushroom_3d.png',
  '1f335': 'Cactus/3D/cactus_3d.png',
  '1f31e': 'Sun%20with%20face/3D/sun_with_face_3d.png',
  '2600': 'Sun/3D/sun_3d.png',
  '2601': 'Cloud/3D/cloud_3d.png',
  '2604': 'Comet/3D/comet_3d.png',
  '1f389': 'Party%20popper/3D/party_popper_3d.png',
  '1f38a': 'Confetti%20ball/3D/confetti_ball_3d.png',
  '1f388': 'Balloon/3D/balloon_3d.png',
  '1f381': 'Wrapped%20gift/3D/wrapped_gift_3d.png',
  '1f382': 'Birthday%20cake/3D/birthday_cake_3d.png',
  '1f984': 'Unicorn/3D/unicorn_3d.png',
};

function fluent3dUrl(key: string): string | null {
  const path = FLUENT_3D[key];
  return path
    ? `https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/${path}`
    : null;
}

// Prefer Fluent 3D for emojis in our curated map; fall back to Fluent Color
// (flat) via emojicdn.elk.sh — Cloudflare-backed proxy resolving any emoji
// to its Microsoft Fluent Emoji asset. Both routes are MIT-licensed art.
function emojiUrl(emoji: string, key: string): string {
  return (
    fluent3dUrl(key) ??
    `https://emojicdn.elk.sh/${encodeURIComponent(emoji)}?style=microsoft`
  );
}

function loadOne(emoji: string): Promise<HTMLImageElement> {
  const key = codepointKey(emoji);
  const state = EMOJI_CACHE.get(key);
  if (state?.kind === 'loaded') return Promise.resolve(state.img);
  if (state?.kind === 'pending') return state.promise;
  if (state?.kind === 'failed') return Promise.reject(new Error(`no asset for ${emoji}`));

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      EMOJI_CACHE.set(key, { kind: 'loaded', img });
      resolve(img);
    };
    img.onerror = () => {
      EMOJI_CACHE.set(key, { kind: 'failed' });
      reject(new Error(`failed to load ${emoji}`));
    };
    img.src = emojiUrl(emoji, key);
  });
  EMOJI_CACHE.set(key, { kind: 'pending', promise });
  return promise;
}

// Load all emoji SVGs in parallel. Resolves once they're all settled —
// individual failures don't reject the whole batch.
export async function preloadEmojis(emojis: string[]): Promise<void> {
  const unique = Array.from(new Set(emojis.filter((e) => e.trim())));
  await Promise.allSettled(unique.map(loadOne));
}

function cachedEmoji(emoji: string): HTMLImageElement | null {
  const state = EMOJI_CACHE.get(codepointKey(emoji));
  return state?.kind === 'loaded' ? state.img : null;
}

// ---------------------------------------------------------------------------

export function renderPattern(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  config: PatternConfig,
): void {
  preferHighQuality(ctx);
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  switch (config.type) {
    case 'mesh':
      renderMesh(ctx, w, h, config);
      break;
    case 'geometric':
      renderGeometric(ctx, w, h, config);
      break;
    case 'dots':
      renderDots(ctx, w, h, config);
      break;
    case 'stripes':
      renderStripes(ctx, w, h, config);
      break;
    case 'emoji':
      renderEmoji(ctx, w, h, config);
      break;
  }
  ctx.restore();
}

function renderMesh(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cfg: PatternConfig,
): void {
  const rng = seededRandom(cfg.seed);
  ctx.fillStyle = cfg.colors[0];
  ctx.fillRect(0, 0, w, h);

  // Bubble count is now user-controllable; default to the v0 heuristic
  // when unset so existing saved configs render unchanged.
  const layers = cfg.meshBubbles ?? Math.max(10, cfg.colors.length * 3);
  const seedOffset = Math.floor(rng() * 1000);

  for (let i = 0; i < layers; i++) {
    const color = cfg.colors[(i + 1) % cfg.colors.length];
    const cx = remap(halton(i + 1 + seedOffset, 2), -0.1, 1.1) * w;
    const cy = remap(halton(i + 1 + seedOffset, 3), -0.1, 1.1) * h;
    const radius = remap(rng(), 0.35, 0.75) * Math.max(w, h);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const alpha = remap(rng(), 0.55, 0.9);
    grad.addColorStop(0, hexToRgba(color, alpha));
    grad.addColorStop(0.5, hexToRgba(color, alpha * 0.4));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // Softness 0 → 0.5% blur (visible bubbles, almost no smearing).
  // Softness 1 → 3% blur (very silky, bubbles bleed together).
  // Default 0.5 lands at 1.75%, close to the v0 hard-coded 1.5%.
  const softness = cfg.meshSoftness ?? 0.5;
  const blurPx = Math.round(Math.max(w, h) * (0.005 + softness * 0.025));
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(ctx.canvas, 0, 0);
  ctx.filter = 'none';
}

function renderGeometric(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cfg: PatternConfig,
): void {
  const rng = seededRandom(cfg.seed);
  ctx.fillStyle = cfg.colors[0];
  ctx.fillRect(0, 0, w, h);

  const palette = cfg.colors.slice(1).length > 0 ? cfg.colors.slice(1) : cfg.colors;
  const scale = Math.max(w, h) / 1920;
  const baseSize = cfg.size * scale;
  const count = Math.round(cfg.density * scale * scale);
  const shapeFilter = cfg.geometricShape ?? 'mix';
  const fillMode = cfg.geometricFill ?? 'solid';

  for (let i = 0; i < count; i++) {
    const color = palette[Math.floor(rng() * palette.length)];
    const x = rng() * w;
    const y = rng() * h;
    // Fixed ±20% size variation (the slider that used to drive this is
    // gone; this constant keeps shapes visually varied without going to
    // the 0× extreme the old `randomness * 2` would produce).
    const variation = (rng() - 0.5) * 0.4;
    const s = baseSize * (1 + variation);
    // 0=circle, 1=square, 2=triangle, 3=line. The targeted filters
    // exclude lines (which only really work as a stroke); 'mix' draws
    // from the full pool.
    let shape: number;
    switch (shapeFilter) {
      case 'circles':
        shape = 0;
        break;
      case 'squares':
        shape = 1;
        break;
      case 'triangles':
        shape = 2;
        break;
      default:
        shape = Math.floor(rng() * 4);
    }
    // Per-shape decision: outline always, fill always, or 50/50 in mix.
    // Line (shape 3) is structurally stroke-only — fillMode is ignored
    // there.
    const outline =
      shape !== 3 && (fillMode === 'outline' || (fillMode === 'mix' && rng() < 0.5));
    const alpha = remap(rng(), 0.55, 1);
    ctx.fillStyle = hexToRgba(color, alpha);
    ctx.strokeStyle = hexToRgba(color, alpha);
    ctx.lineWidth = s * 0.18;
    if (shape === 0) {
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      if (outline) ctx.stroke();
      else ctx.fill();
    } else if (shape === 1) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng() * Math.PI * 2);
      if (outline) ctx.strokeRect(-s, -s, s * 2, s * 2);
      else ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.restore();
    } else if (shape === 2) {
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.lineTo(x - s * 0.866, y + s * 0.5);
      ctx.lineTo(x + s * 0.866, y + s * 0.5);
      ctx.closePath();
      if (outline) ctx.stroke();
      else ctx.fill();
    } else {
      // Line stroke (mix-only path; targeted filters exclude this).
      const angle = rng() * Math.PI * 2;
      const len = s * 3;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(angle) * len, y - Math.sin(angle) * len);
      ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
      ctx.stroke();
    }
  }
}

function renderDots(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cfg: PatternConfig,
): void {
  const rng = seededRandom(cfg.seed);
  ctx.fillStyle = cfg.colors[0];
  ctx.fillRect(0, 0, w, h);

  const palette = cfg.colors.slice(1).length > 0 ? cfg.colors.slice(1) : cfg.colors;
  const spacing = Math.max(w, h) / Math.max(8, cfg.density);
  const scale = Math.max(w, h) / 1920;
  const baseRadius = cfg.size * scale * 0.45;
  // dotsJitter=0 → exact grid, dotsJitter=1 → half-spacing scatter.
  const jitter = cfg.dotsJitter ?? 0.5;
  // dotsSizeVar=0 → all dots same radius, dotsSizeVar=1 → ±100% scatter.
  const sizeVar = cfg.dotsSizeVar ?? 0.7;

  for (let row = 0, y = spacing / 2; y < h; row++, y += spacing) {
    const stagger = (row % 2) * spacing * 0.5;
    for (let x = stagger - spacing; x < w + spacing; x += spacing) {
      const jx = x + (rng() - 0.5) * spacing * jitter;
      const jy = y + (rng() - 0.5) * spacing * jitter;
      const r = Math.max(2, baseRadius * (1 + (rng() - 0.5) * sizeVar));
      const color = palette[Math.floor(rng() * palette.length)];
      const dotGrad = ctx.createRadialGradient(jx, jy, 0, jx, jy, r);
      dotGrad.addColorStop(0, color);
      dotGrad.addColorStop(0.85, color);
      dotGrad.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = dotGrad;
      ctx.fillRect(jx - r, jy - r, r * 2, r * 2);
    }
  }
}

function renderStripes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cfg: PatternConfig,
): void {
  const rng = seededRandom(cfg.seed);
  ctx.fillStyle = cfg.colors[0];
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  // 0° = vertical stripes, 90° = horizontal. The UI caps at 90 since
  // beyond that just mirrors the same orientations; clamp here too so
  // any pre-clamp persisted value renders within the supported range.
  const angleDeg = Math.min(90, Math.max(0, cfg.stripesAngle ?? 30));
  ctx.rotate((angleDeg * Math.PI) / 180);

  const diag = Math.sqrt(w * w + h * h) * 1.1;
  const scale = Math.max(w, h) / 1920;
  const baseWidth = cfg.size * scale * 1.5;
  // stripesWidthVar=0 → uniform stripe widths, 1 → ±100% scatter.
  const widthVar = cfg.stripesWidthVar ?? 0.5;

  let x = -diag;
  let i = 0;
  while (x < diag) {
    const stripeW = Math.max(2, baseWidth * (1 + (rng() - 0.5) * widthVar));
    const color = cfg.colors[i % cfg.colors.length];
    ctx.fillStyle = color;
    ctx.fillRect(x - 1, -diag, stripeW + 2, diag * 2);
    x += stripeW;
    i++;
  }
  ctx.restore();
}

function renderEmoji(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cfg: PatternConfig,
): void {
  const rng = seededRandom(cfg.seed);
  ctx.fillStyle = cfg.colors[0];
  ctx.fillRect(0, 0, w, h);

  const emojis = cfg.emojis.filter((e) => e.trim());
  if (emojis.length === 0) return;

  const scale = Math.max(w, h) / 1920;
  const size = cfg.size * scale * 1.3;
  // Grid spacing as a percentage of glyph size. 100% = exactly one
  // glyph-width gap → tight packing with overlap from size scatter.
  // 300% = three glyph-widths → very airy. Default 175% matches the
  // previous hard-coded value.
  const grid = size * ((cfg.emojiSpacing ?? 175) / 100);
  // Fallback styling for any emoji not yet loaded as SVG.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(size)}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;

  // Convert the user-facing degree cap to radians, total range ±rotMax.
  const rotMaxRad = ((cfg.emojiRotationMax ?? 34) * Math.PI) / 180;
  // sizeVar=0 → all same size, sizeVar=1 → 0.5×–1.5× scatter.
  const sizeVar = cfg.emojiSizeVar ?? 0.75;

  let row = 0;
  for (let y = grid / 2; y < h + grid; y += grid) {
    const offset = (row % 2) * grid * 0.5;
    for (let x = -grid + offset; x < w + grid; x += grid) {
      // Position jitter stays fixed at 0.55 × grid — feels like the right
      // amount of scatter and there's no obvious user knob to expose
      // here that would be more useful than just re-seeding.
      const jx = x + (rng() - 0.5) * grid * 0.55;
      const jy = y + (rng() - 0.5) * grid * 0.55;
      const rotation = (rng() - 0.5) * 2 * rotMaxRad;
      const sizeMul = 1 - sizeVar / 2 + rng() * sizeVar;
      const drawSize = size * sizeMul;
      const ei = Math.floor(rng() * emojis.length);
      const emoji = emojis[ei];
      const img = cachedEmoji(emoji);

      // Random horizontal mirror — independent of any slider now that
      // randomness is fixed at full. ~40% of emojis flip.
      const flip = rng() < 0.4;
      ctx.save();
      ctx.translate(jx, jy);
      if (rotation !== 0) ctx.rotate(rotation);
      if (flip) ctx.scale(-1, 1);
      if (img) {
        // PNG/SVG asset — draws crisp at the target size.
        ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
      } else {
        // Asset not loaded (still fetching or unsupported emoji) — fall back
        // to the system color emoji font for this glyph. The scatter-size
        // is applied via font-size override before draw.
        ctx.font = `${Math.round(drawSize)}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        ctx.fillText(emoji, 0, 0);
      }
      ctx.restore();
    }
    row++;
  }
}
