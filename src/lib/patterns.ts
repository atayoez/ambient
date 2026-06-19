// Pattern configuration types + UI-facing constants. The renderer
// itself moved to Rust in Phase 5 (src-tauri/src/renderer.rs); this
// file is now configuration data plus a single invoke wrapper for
// the Rust render_preview command. The deleted JS renderer used to
// be ~450 LOC of Canvas drawing code.

import { invoke } from '@tauri-apps/api/core';

export type PatternType =
  | 'mesh'
  | 'geometric'
  | 'dots'
  | 'stripes'
  | 'emoji'
  | 'flower'
  | 'flow'
  | 'waves'
  | 'aurora'
  | 'bokeh';

export type GeometricShape =
  | 'circles'
  | 'triangles'
  | 'squares'
  | 'hexagons'
  | 'stars'
  | 'plus'
  | 'mix';
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

  // Flower (Windows 11 "Bloom"-style): petal count + swirl amount (0–1 =
  // straight radial → strongly curled). Petal reach is the global `size`.
  flowerPetals?: number;
  flowerTwist?: number;

  // Flow: smooth wavy lines spanning the canvas. Line count, wave
  // amplitude (0–1 height), and wave frequency (0–1 cycles). Line
  // thickness is the global `size`.
  flowLines?: number;
  flowAmplitude?: number;
  flowFrequency?: number;

  // Waves: stacked translucent wavy bands (layered-silk). Layer count,
  // crest amplitude (0–1), wave frequency (0–1).
  wavesLayers?: number;
  wavesAmplitude?: number;
  wavesFrequency?: number;

  // Aurora: vertical northern-lights curtains. Band count, curtain
  // width/spread (0–1), horizontal sway amplitude (0–1).
  auroraBands?: number;
  auroraSpread?: number;
  auroraAmplitude?: number;

  // Bokeh: soft glowing orbs. Count = density, radius = size (the orbs'
  // radial alpha falloff is soft on its own — no blur knob).
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

// A user-saved palette: a single explicit set of colors + emojis (no
// light/dark pair — custom palettes are chosen, not theme-derived).
// Persisted in Rust-owned settings (`Settings.customPresets`); surfaced in
// the presets row alongside the curated set and the live system-accent
// preset.
export interface CustomPreset {
  id: string;
  name: string;
  colors: string[];
  emojis: string[];
}

// Adapt a CustomPreset to the ColorPreset shape the picker/apply path
// expects. light === dark so the theme-mode swap is a no-op for custom
// palettes — they keep whatever colors the user saved.
export function customToColorPreset(c: CustomPreset): ColorPreset {
  return { id: c.id, name: c.name, emojis: c.emojis, light: c.colors, dark: c.colors };
}

// Curated set of 15 themed palettes. Each ships with a light and dark
// variant chosen to read well against the corresponding bg-base, plus
// paired emoji set so picking a theme auto-swaps the Emoji pattern's
// glyphs to match. Cosmic is first because it's the brand default;
// Mono is kept last as the neutral ender.
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
    id: 'aurora',
    name: 'Aurora',
    emojis: ['🌌', '💚', '💜', '✨', '🏔️', '🌠', '❄️', '🌃'],
    dark: ['#03111a', '#0a3d3a', '#10b981', '#5eead4', '#a78bfa'],
    light: ['#ecfeff', '#a7f3d0', '#10b981', '#0891b2', '#7c3aed'],
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    emojis: ['⚡', '🌃', '🤖', '🔮', '💜', '🌆', '💎', '🎮'],
    dark: ['#0a0118', '#ff007a', '#00e5ff', '#fde047', '#a855f7'],
    light: ['#faf0ff', '#f0abfc', '#db2777', '#0891b2', '#7c3aed'],
  },
  {
    id: 'autumn',
    name: 'Autumn',
    emojis: ['🍂', '🍁', '🌰', '🍄', '🦊', '🌾', '🍎', '🐿️'],
    light: ['#fffbeb', '#fed7aa', '#ea580c', '#b45309', '#7c2d12'],
    dark: ['#1a0f08', '#5a2e0e', '#c2410c', '#ea9a3e', '#fcd9a8'],
  },
  {
    id: 'sakura',
    name: 'Sakura',
    emojis: ['🌸', '🌷', '🩷', '🦋', '🍃', '🌺', '🐦', '🎀'],
    light: ['#fff5f7', '#fecdd3', '#fb7185', '#f9a8d4', '#a78bfa'],
    dark: ['#2a1620', '#6b2848', '#f43f5e', '#fb7eb0', '#d8b4fe'],
  },
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    emojis: ['🌴', '🌊', '🌆', '💿', '🕶️', '🍹', '🐬', '⭐'],
    dark: ['#190a2e', '#ff5ca8', '#36e0d8', '#b16cff', '#fef08a'],
    light: ['#fdf2ff', '#fbcfe8', '#e879f9', '#22d3ee', '#818cf8'],
  },
  {
    id: 'forest',
    name: 'Forest',
    emojis: ['🌲', '🍄', '🦌', '🌿', '🦉', '🐻', '🍃', '🌰'],
    light: ['#f2fbf4', '#bbe7c6', '#4d9e63', '#2f6b3c', '#3b2a1a'],
    dark: ['#08130b', '#16301c', '#3f7d4f', '#86c08e', '#d8cba0'],
  },
  {
    id: 'citrus',
    name: 'Citrus',
    emojis: ['🍋', '🍊', '🍈', '🌿', '🍹', '🐝', '🌼', '🥝'],
    light: ['#fefce8', '#fef08a', '#facc15', '#65a30d', '#15803d'],
    dark: ['#161a05', '#3f4d0a', '#a3b817', '#facc15', '#fff6a8'],
  },
  {
    id: 'berry',
    name: 'Berry',
    emojis: ['🫐', '🍇', '🍓', '🍒', '🍷', '🌸', '🍰', '💜'],
    light: ['#fdf4ff', '#f5d0fe', '#c026d3', '#9333ea', '#581c87'],
    dark: ['#160a1f', '#3b0f52', '#a21caf', '#e056c7', '#f7c6f0'],
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

// ---------------------------------------------------------------------
// System-accent palette
// ---------------------------------------------------------------------

// Stable id for the accent-derived preset. Kept distinct from the curated
// COLOR_PRESETS ids so resolvePreset() can route it to the live accent
// builder instead of the static table.
export const SYSTEM_PRESET_ID = 'system';

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = Math.min(100, Math.max(0, s)) / 100;
  const ln = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = (
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x]
  ) as [number, number, number];
  const m = ln - c / 2;
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

// Generate a fresh random palette — a background plus four foreground
// colours anchored on one random base hue (with spread), tuned for the
// current theme (dark bg + bright accents when dark, light bg + deeper
// accents when light). Returns [background, ...foreground].
export function randomPalette(dark: boolean): string[] {
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const baseHue = Math.random() * 360;
  const bg = dark
    ? hslToHex(baseHue, rand(12, 32), rand(6, 12))
    : hslToHex(baseHue, rand(14, 38), rand(92, 97));
  const fg: string[] = [];
  for (let i = 0; i < 4; i++) {
    const h = (baseHue + rand(20, 70) * (i + 1)) % 360;
    const s = rand(55, 90);
    const l = dark ? rand(48, 76) : rand(38, 62);
    fg.push(hslToHex(h, s, l));
  }
  return [bg, ...fg];
}

// Builds a 5-stop palette anchored on the OS accent hue — a monochromatic
// ramp from a near-base tone up through the accent to a near-edge tint, so
// generated wallpapers read as "tinted with the system color" rather than
// dumping one saturated swatch. Saturation is clamped so a hyper-saturated
// OS accent doesn't produce a garish ramp. Returns null on malformed hex.
export function accentPreset(hex: string): ColorPreset | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  const [h, s] = hsl;
  const sat = Math.min(s, 85);
  return {
    id: SYSTEM_PRESET_ID,
    name: 'System',
    // Neutral, non-themed glyph set — the accent palette isn't tied to a
    // motif the way Cosmic/Ocean/etc. are. Abstract geometric emoji read
    // as "system" rather than borrowing another preset's mood. All entries
    // are emoji-presentation (no bare dingbats, which render as flat text).
    emojis: ['🔷', '🔹', '💠', '🔵', '🟦', '🔘', '⬜', '⬛'],
    dark: [
      hslToHex(h, Math.min(sat, 35), 8),
      hslToHex(h, Math.min(sat, 55), 24),
      hslToHex(h, sat, 50),
      hslToHex(h, Math.min(sat, 70), 70),
      hslToHex(h, Math.min(sat, 40), 92),
    ],
    light: [
      hslToHex(h, Math.min(sat, 45), 96),
      hslToHex(h, Math.min(sat, 60), 82),
      hslToHex(h, sat, 52),
      hslToHex(h, Math.min(sat + 5, 90), 38),
      hslToHex(h, Math.min(sat, 55), 12),
    ],
  };
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

// Pattern types with a live fragment shader (mirrored by FRAG_SHADERS in
// lib/shaders.ts) — the live-wallpaper subset. Flow/Waves/Aurora drift their
// sin/cos phase fields; Dots/Bokeh/Geometric move per element; Stripes scroll;
// Flower counter-rotates its layers; Mesh drifts soft metaball blobs. Every
// pattern animates as a shader except Emoji, which animates via its own glyph
// field.
export const ANIMATABLE: PatternType[] = [
  'flow',
  'waves',
  'aurora',
  'dots',
  'bokeh',
  'stripes',
  'geometric',
  'flower',
  'mesh',
];

// User-facing metadata for each pattern type — single source of truth used
// by the type picker UI and by library entries.
export const PATTERN_TYPES: { id: PatternType; name: string }[] = [
  { id: 'mesh', name: 'Mesh' },
  { id: 'geometric', name: 'Geometric' },
  { id: 'dots', name: 'Dots' },
  { id: 'stripes', name: 'Stripes' },
  { id: 'emoji', name: 'Emoji' },
  { id: 'flower', name: 'Flower' },
  { id: 'flow', name: 'Flow' },
  { id: 'waves', name: 'Waves' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'bokeh', name: 'Bokeh' },
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
  flower: {
    size: 100,
    flowerPetals: 12,
    flowerTwist: 0.5,
  },
  flow: {
    size: 40,
    flowLines: 28,
    flowAmplitude: 0.5,
    flowFrequency: 0.4,
  },
  waves: {
    wavesLayers: 7,
    wavesAmplitude: 0.5,
    wavesFrequency: 0.4,
  },
  aurora: {
    auroraBands: 5,
    auroraSpread: 0.5,
    auroraAmplitude: 0.5,
  },
  bokeh: {
    density: 22,
    size: 60,
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
    // density min matches the Rust renderer's floor (`density.max(8.0)`)
    // — values below 8 are clamped, so exposing them in the slider was
    // a dead zone the user saw as a broken interval.
    density: { min: 8, max: 60, label: 'Density' },
    size: { min: 6, max: 80 },
  },
  stripes: { size: { min: 10, max: 140 } },
  emoji: { size: { min: 40, max: 140 } },
  flower: { size: { min: 40, max: 160 } },
  flow: { size: { min: 6, max: 120 } },
  bokeh: {
    density: { min: 8, max: 60, label: 'Count' },
    size: { min: 10, max: 120 },
  },
};

// Modifier ranges used by both the randomizer and (where applicable) the
// UI knobs, so "Randomize" and the sliders stay in lockstep — every
// modifier a generator exposes is also a variable Randomize re-rolls,
// and vice versa. Per-type maps of knob → [min, max] (continuous 0–1
// knobs are stored as 0..1; integer knobs round).
type Knob = { min: number; max: number; int?: boolean };
const MODIFIER_RANGES: Partial<Record<PatternType, Record<string, Knob>>> = {
  mesh: {
    meshBubbles: { min: 6, max: 40, int: true },
    meshSoftness: { min: 0, max: 1 },
  },
  geometric: {
    density: { min: 10, max: 200, int: true },
    size: { min: 12, max: 120, int: true },
  },
  dots: {
    density: { min: 8, max: 60, int: true },
    size: { min: 6, max: 80, int: true },
    dotsJitter: { min: 0, max: 1 },
    dotsSizeVar: { min: 0, max: 1 },
  },
  stripes: {
    size: { min: 10, max: 140, int: true },
    stripesAngle: { min: 0, max: 90, int: true },
    stripesWidthVar: { min: 0, max: 1 },
  },
  emoji: {
    size: { min: 40, max: 140, int: true },
    emojiSpacing: { min: 50, max: 300, int: true },
    emojiRotationMax: { min: 0, max: 90, int: true },
    emojiSizeVar: { min: 0, max: 1 },
  },
  flower: {
    size: { min: 40, max: 160, int: true },
    flowerPetals: { min: 5, max: 40, int: true },
    flowerTwist: { min: 0, max: 1 },
  },
  flow: {
    size: { min: 6, max: 120, int: true },
    flowLines: { min: 6, max: 120, int: true },
    flowAmplitude: { min: 0, max: 1 },
    flowFrequency: { min: 0, max: 1 },
  },
  waves: {
    wavesLayers: { min: 3, max: 20, int: true },
    wavesAmplitude: { min: 0, max: 1 },
    wavesFrequency: { min: 0, max: 1 },
  },
  aurora: {
    auroraBands: { min: 3, max: 14, int: true },
    auroraSpread: { min: 0, max: 1 },
    auroraAmplitude: { min: 0, max: 1 },
  },
  bokeh: {
    density: { min: 8, max: 60, int: true },
    size: { min: 10, max: 120, int: true },
  },
};

// Enum-valued modifiers that Randomize should also pick from.
const MODIFIER_CHOICES: Partial<Record<PatternType, Record<string, string[]>>> = {
  geometric: {
    geometricShape: [
      'mix',
      'circles',
      'triangles',
      'squares',
      'hexagons',
      'stars',
      'plus',
    ],
    geometricFill: ['solid', 'outline', 'mix'],
  },
};

// Roll a fresh value for every modifier the given pattern type exposes —
// numeric knobs across their full range, enum knobs from their choice
// set. The Randomize button spreads this over the current config (plus a
// new seed), so a re-roll changes every variable the renderer reads, not
// just the seed.
export function randomizedModifiers(type: PatternType): Partial<PatternConfig> {
  const out: Record<string, number | string> = {};
  const knobs = MODIFIER_RANGES[type] ?? {};
  for (const [key, k] of Object.entries(knobs)) {
    const v = k.min + Math.random() * (k.max - k.min);
    out[key] = k.int ? Math.round(v) : v;
  }
  const choices = MODIFIER_CHOICES[type] ?? {};
  for (const [key, opts] of Object.entries(choices)) {
    out[key] = opts[Math.floor(Math.random() * opts.length)];
  }
  return out as Partial<PatternConfig>;
}

// Request a fresh preview render from Rust at the given pixel size
// (caller passes `.preview-wrap` element size × devicePixelRatio).
// Returns a `data:image/jpeg;base64,…` URL that binds straight to
// <img src>. The ~33% base64 overhead is fine at preview sizes
// (~30-50KB JPEG → ~50-70KB string) and avoids the Tauri 2.x
// ipc::Response/ArrayBuffer round-trip which was rendering blank.
export async function renderPreview(
  config: PatternConfig,
  width: number,
  height: number,
): Promise<string> {
  return invoke<string>('render_preview', { config, width, height });
}
