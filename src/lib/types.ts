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
  unsplashKey: string;
  pexelsKey: string;
  unsplashQuery: string;
  pexelsQuery: string;
  genProvider: GenProvider;
  pollinationsModel: PollinationsModel;
  genResolution: GenResolution;
  openaiKey: string;
  openaiModel: string;
  rotationSource: RotationSource;
  rotationIntervalMinutes: number;
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
  unsplashKey: '',
  pexelsKey: '',
  unsplashQuery: '',
  pexelsQuery: '',
  genProvider: 'pollinations',
  pollinationsModel: 'flux',
  genResolution: 'auto',
  openaiKey: '',
  openaiModel: 'dall-e-3',
  rotationSource: 'off',
  rotationIntervalMinutes: 60,
};
