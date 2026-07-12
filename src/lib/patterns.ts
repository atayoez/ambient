// Pattern configuration types + UI-facing constants. The renderer
// itself moved to Rust in Phase 5 (src-tauri/core/src/renderer.rs); this
// file is now configuration data plus a single invoke wrapper for
// the Rust render_preview command. The deleted JS renderer used to
// be ~450 LOC of Canvas drawing code.

import { invoke } from '@tauri-apps/api/core';
import colorPresetsJson from './colorPresets.json';
import patternManifestJson from './patternManifest.json';
import { FRAG_SHADERS } from './shaders';

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
  | 'bokeh'
  | 'matrix'
  | 'crt';

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

  // Matrix: digital rain. density = column count; trail length and fall
  // speed are 0-1 knobs. matrixText: optional custom text (≤15 chars from
  // MATRIX_CHARSET, uppercased) that rains down the columns in sequence;
  // empty = random glyphs from the whole charset.
  matrixTrail?: number;
  matrixSpeed?: number;
  matrixText?: string;

  // CRT test pattern: SMPTE bars with analogue artifacts. All 0-1 knobs:
  // scanline strength, tube curvature, noise amount. Uses the broadcast
  // standard bar colours, not the palette.
  crtScanlines?: number;
  crtCurvature?: number;
  crtNoise?: number;
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

// Curated themed palettes — data lives in colorPresets.json, the single
// source of truth shared with Rust (core includes the same file via
// include_str! for the tray "Random wallpaper" preset roll). Each ships
// a light and dark variant plus a paired emoji set so picking a theme
// auto-swaps the Emoji pattern's glyphs to match. Cosmic first (brand
// default), Mono last (neutral ender).
export const COLOR_PRESETS: ColorPreset[] = colorPresetsJson as ColorPreset[];

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

// ---------------------------------------------------------------------
// Pattern-type manifest
// ---------------------------------------------------------------------

// The whole per-type knob contract — UI order + labels, slider ranges,
// defaults, randomizer ranges, and the p1/p2/p3 shader-uniform packing —
// lives in patternManifest.json, the single source of truth shared with
// Rust (core/build.rs compiles the same file into knob-default consts
// used by the renderer and the live-spec stamping) and with the
// generated shaders' doc comments (scripts/gen-shaders.ts). Everything
// below is derived from it; nothing per-type is hand-listed here.

export interface KnobChoice {
  id: string;
  label: string;
}

export interface KnobSpec {
  key: string;
  label: string;
  /** Which shader uniform this knob feeds. The global `size` rides its
   * own u_size/gSize uniform, and some knobs (emoji field) never reach
   * a shader — both omit the tag. */
  uniform?: 'p1' | 'p2' | 'p3';
  min?: number;
  max?: number;
  default?: number | string;
  /** Integer knob: sliders step whole values and Randomize rounds. */
  int?: boolean;
  /** Display multiplier — 0-1 knobs render as 0-100 "%" sliders. */
  scale?: number;
  /** Display suffix only (°, %); does not affect the stored value. */
  unit?: string;
  /** 'text' renders a free-text input and is excluded from Randomize. */
  kind?: 'text';
  placeholder?: string;
  maxLength?: number;
  /** Enum knob: the index in this list IS the numeric wire code the
   * WebGL/QML shaders decode — never reorder or insert, only append. */
  choices?: KnobChoice[];
}

export interface PatternTypeSpec {
  id: PatternType;
  label: string;
  knobs: KnobSpec[];
}

const MANIFEST = patternManifestJson as unknown as {
  maxColors: number;
  minColors: number;
  matrixCharset: string;
  matrixTextMax: number;
  types: PatternTypeSpec[];
};

export const PATTERN_MANIFEST = MANIFEST;

/** Per-type knob specs, keyed by pattern type. Drives the knob UI in
 * Patterns.tsx and the uniform packing in liveShader.ts. */
export const TYPE_SPECS: Record<PatternType, PatternTypeSpec> = Object.fromEntries(
  MANIFEST.types.map((t) => [t.id, t]),
) as Record<PatternType, PatternTypeSpec>;

// Palette size limits, counting the background: colors[0] is the
// background, colors[1..] the foreground, so 6 total = bg + 5 foreground
// chips and the minimum is bg + 1. Shared by Patterns.tsx (whole-palette
// add/remove guards), PaletteEditor.tsx (foreground-only view), and the
// shader palette arrays on every delivery target (WebGL / Qt / wgpu all
// cap at the same manifest value).
export const MAX_COLORS = MANIFEST.maxColors;
export const MIN_COLORS = MANIFEST.minColors;

// Copies (not aliases) of the preset arrays: config.colors / config.emojis
// get mutated per-config downstream, and sharing the array with
// COLOR_PRESETS[0] would let an in-place edit corrupt the preset itself.
export const DEFAULT_CONFIG: PatternConfig = {
  type: 'mesh',
  colors: [...COLOR_PRESETS[0].dark],
  density: 40,
  size: 80,
  emojis: [...DEFAULT_EMOJIS],
  seed: Math.floor(Math.random() * 1_000_000),
  colorPresetId: COLOR_PRESETS[0].id,
};

// Pattern types with a live fragment shader — the live-wallpaper subset.
// Derived from FRAG_SHADERS in lib/shaders.ts (the single source of truth:
// a type is animatable iff it ships a shader). Every pattern animates as a
// shader except Emoji, which animates via its own glyph field.
export const ANIMATABLE: PatternType[] = Object.keys(FRAG_SHADERS) as PatternType[];

// User-facing metadata for each pattern type — manifest order is the
// type-picker order.
export const PATTERN_TYPES: { id: PatternType; name: string }[] = MANIFEST.types.map(
  (t) => ({ id: t.id, name: t.label }),
);

// When the user switches pattern types we seed every knob the type
// exposes (including the global density/size where present) to its
// manifest default, so the user always lands on a good starting point
// even if they never touch the controls.
export const TYPE_DEFAULTS: Record<
  PatternType,
  Partial<PatternConfig>
> = Object.fromEntries(
  MANIFEST.types.map((t) => [
    t.id,
    Object.fromEntries(
      t.knobs
        .filter((k) => k.kind !== 'text' && k.default !== undefined)
        .map((k) => [k.key, k.default]),
    ),
  ]),
) as unknown as Record<PatternType, Partial<PatternConfig>>;

// Ordered geometric shape list — the manifest's choices for the
// geometricShape knob. ORDER IS A WIRE CONTRACT: each shape's index is
// the numeric code the WebGL/QML shaders decode ('mix' = 0, 'circles' =
// 1, … 'plus' = 6) — never reorder or insert, only append.
export const GEOMETRIC_SHAPES: KnobChoice[] =
  TYPE_SPECS.geometric.knobs.find((k) => k.key === 'geometricShape')?.choices ?? [];

// Roll a fresh value for every modifier the given pattern type exposes —
// numeric knobs across their full manifest range, enum knobs from their
// choice set; free-text knobs are left alone. The Randomize button
// spreads this over the current config (plus a new seed), so a re-roll
// changes every variable the renderer reads, not just the seed — and
// because the same manifest drives the sliders, Randomize and the UI
// can't desync.
export function randomizedModifiers(type: PatternType): Partial<PatternConfig> {
  const out: Record<string, number | string> = {};
  for (const k of TYPE_SPECS[type]?.knobs ?? []) {
    if (k.kind === 'text') continue;
    if (k.choices) {
      out[k.key] = k.choices[Math.floor(Math.random() * k.choices.length)].id;
    } else if (k.min !== undefined && k.max !== undefined) {
      const v = k.min + Math.random() * (k.max - k.min);
      out[k.key] = k.int ? Math.round(v) : v;
    }
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
