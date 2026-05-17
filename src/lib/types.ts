import type { ThemeMode } from './theme';

export type SourceKind = 'nasa-apod' | 'unsplash' | 'pexels';
export type GenProvider = 'pollinations' | 'openai';
// 'off' = no auto-rotation. 'sources' = fetch a new image from the
// configured Source on each tick. 'library' = pick a random previously-
// saved wallpaper. Mutually exclusive: enabling rotation in Sources tab
// flips this to 'sources', enabling in Library flips to 'library'.
export type RotationSource = 'off' | 'sources' | 'library';
export type PollinationsModel =
  | 'flux'
  | 'flux-realism'
  | 'flux-anime'
  | 'flux-3d'
  | 'turbo'
  | 'sdxl';
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
  genProvider: GenProvider;
  pollinationsModel: PollinationsModel;
  genResolution: GenResolution;
  openaiModel: string;
  rotationSource: RotationSource;
  rotationIntervalMinutes: number;
  /** Theme mode for wallpaper switching, picked via the Auto/Light/Dark
   * segmented control on the Library tab. Mirrors the Patterns palette
   * mode for visual consistency.
   *  - 'auto'  — follow system prefers-color-scheme; apply lightPath
   *              when system is light, darkPath when system is dark
   *  - 'light' — locked to lightPath; system theme is ignored
   *  - 'dark'  — locked to darkPath
   * In all three modes, applying a wallpaper from the library captures
   * its path into the slot matching the current mode (so picking a
   * wallpaper while in Light mode populates lightPath). The two slots
   * persist independently. */
  themeMode: ThemeMode;
  themeFollowLightPath: string | null;
  themeFollowDarkPath: string | null;
  // Path of the most-recently-applied wallpaper. Owned by Rust's
  // set_wallpaper command (stamped under the SettingsState write lock
  // on every apply), exposed here so the Library "currently applied"
  // indicator survives a webview destroy/rebuild. Optional because
  // pre-Phase-1 saved settings predate the field.
  lastApplied?: string | null;
}

export interface Wallpaper {
  path: string;
  source: SourceKind | 'generated';
  addedAt: number;
  prompt?: string;
  title?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'nasa-apod',
  unsplashQuery: '',
  pexelsQuery: '',
  genProvider: 'pollinations',
  pollinationsModel: 'flux',
  genResolution: 'auto',
  openaiModel: 'dall-e-3',
  rotationSource: 'off',
  rotationIntervalMinutes: 60,
  themeMode: 'auto',
  themeFollowLightPath: null,
  themeFollowDarkPath: null,
  lastApplied: null,
};
