// Pattern configuration types + UI-facing constants. The renderer
// itself moved to Rust in Phase 5 (src-tauri/src/renderer.rs); this
// file is now configuration data plus a single invoke wrapper for
// the Rust render_preview command. The deleted JS renderer used to
// be ~450 LOC of Canvas drawing code.

import { invoke } from '@tauri-apps/api/core';

export type PatternType = 'mesh' | 'geometric' | 'dots' | 'stripes' | 'emoji';

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
    // density min matches the Rust renderer's floor (`density.max(8.0)`)
    // — values below 8 are clamped, so exposing them in the slider was
    // a dead zone the user saw as a broken interval.
    density: { min: 8, max: 60, label: 'Density' },
    size: { min: 6, max: 80 },
  },
  stripes: { size: { min: 10, max: 140 } },
  emoji: { size: { min: 40, max: 140 } },
};

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
