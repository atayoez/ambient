import type { CustomPreset } from './patterns';
import type { ThemeMode } from './theme';

export type SourceKind =
  | 'nasa-apod'
  | 'bing'
  | 'unsplash'
  | 'pexels'
  | 'wallhaven'
  | 'picsum';
export type GenProvider = 'pollinations' | 'openai';
// Live-wallpaper render quality — caps the KDE plugin shader's internal
// resolution + fps (resolved in Rust: LiveQuality::resolve). Higher is
// sharper but heavier on the GPU; 'native' renders at full resolution.
export type LiveQuality = 'performance' | 'balanced' | 'high' | 'native';
// 'off' = no auto-rotation. 'sources' = fetch a new image from the
// configured Source on each tick. 'library' = pick a random previously-
// saved wallpaper. Mutually exclusive: enabling rotation in Sources tab
// flips this to 'sources', enabling in Library flips to 'library'.
export type RotationSource = 'off' | 'sources' | 'library';
// Per-wallpaper light/dark eligibility. 'both' (default) shows in either
// theme; 'light'/'dark' restrict it. The rotation / "Next" pools are
// derived from these tags.
export type WallpaperMode = 'both' | 'light' | 'dark';
// Pollinations' model set is fetched live from its /models endpoint
// (see pollinations_models in aigen.rs) rather than hardcoded — the
// service trims the list over time, so a frozen union would lie. A
// plain string id, defaulting to 'flux'.
export type GenResolution =
  | 'auto'
  | '1920x1080'
  | '2560x1440'
  | '3440x1440'
  | '3840x2160'
  | '5120x2880';

export interface Settings {
  source: SourceKind;
  // unsplashKey / pexelsKey / openaiKey moved to the OS keyring in
  // Phase 3 (src/lib/secrets.ts). Use useSecret('unsplash_key') etc.
  unsplashQuery: string;
  pexelsQuery: string;
  wallhavenQuery: string;
  /** Wallhaven search options. `sorting` is the raw API value; `categories`
   * and `purity` are the API's 3-bit strings (general·anime·people /
   * sfw·sketchy·nsfw). */
  wallhavenSorting: string;
  wallhavenCategories: string;
  wallhavenPurity: string;
  genProvider: GenProvider;
  pollinationsModel: string;
  genResolution: GenResolution;
  openaiModel: string;
  rotationSource: RotationSource;
  rotationIntervalMinutes: number;
  /** Which pool the rotation / "Next" picks draw from, via the
   * Auto/Light/Dark control on the Library tab:
   *  - 'auto'  — follow system prefers-color-scheme (light pool when the
   *              system is light, dark pool when dark)
   *  - 'light' — always the light pool
   *  - 'dark'  — always the dark pool
   * The pools are derived from each wallpaper's `mode` tag (light/dark/
   * both), set per-entry in the Library. */
  themeMode: ThemeMode;
  /** User-saved palettes (colours + emojis), edited on the Patterns tab.
   * Moved here from the retired tauri-plugin-store draft KV so real data
   * has one Rust-owned source of truth. */
  customPresets: CustomPreset[];
  /** Also mirror the applied wallpaper onto the OS lock screen (KDE
   * Plasma; no-op on other DEs). */
  lockscreen: boolean;
  /** Live-wallpaper render quality — caps the KDE plugin shader's internal
   * resolution + fps. Higher = sharper but heavier on the GPU. */
  liveWallpaperQuality: LiveQuality;
  /** Saved-wallpaper cache cap in whole GB; 0 = unlimited. Rust evicts the
   * oldest saved files (plus their thumbs and library rows) after each save
   * until the total is back under the cap. */
  cacheLimitGb: number;
  /** Global speed multiplier for live/animated wallpapers. 1 = normal. */
  animationSpeed: number;
  // Path of the most-recently-applied wallpaper. Owned by Rust's
  // set_wallpaper command (stamped under the SettingsState write lock
  // on every apply), exposed here so the Library "currently applied"
  // indicator survives a webview destroy/rebuild. Optional because
  // pre-Phase-1 saved settings predate the field.
  lastApplied?: string | null;
  // The last committed static pattern's config. Owned by Rust
  // (renderer::apply_pattern stamps it) for the tray "Random wallpaper"
  // action; the webview never reads it.
  lastPattern?: unknown;
}

export interface Wallpaper {
  path: string;
  source: SourceKind | 'generated';
  addedAt: number;
  prompt?: string;
  title?: string;
  // Light/dark eligibility. Optional for migration; absent = 'both'.
  mode?: WallpaperMode;
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'nasa-apod',
  unsplashQuery: '',
  pexelsQuery: '',
  wallhavenQuery: '',
  wallhavenSorting: 'random',
  wallhavenCategories: '100',
  wallhavenPurity: '100',
  genProvider: 'pollinations',
  pollinationsModel: 'flux',
  genResolution: 'auto',
  openaiModel: 'dall-e-3',
  rotationSource: 'off',
  rotationIntervalMinutes: 60,
  themeMode: 'auto',
  customPresets: [],
  lockscreen: false,
  liveWallpaperQuality: 'balanced',
  cacheLimitGb: 2,
  animationSpeed: 1,
  lastApplied: null,
};
