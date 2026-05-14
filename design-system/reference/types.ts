export type SourceKind = 'nasa-apod' | 'unsplash' | 'pexels';
export type GenProvider = 'pollinations' | 'openai';
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
  nasaApiKey: string;
  unsplashKey: string;
  pexelsKey: string;
  unsplashTopic: string;
  pexelsQuery: string;
  genProvider: GenProvider;
  pollinationsModel: PollinationsModel;
  genResolution: GenResolution;
  openaiKey: string;
  openaiModel: string;
  rotationEnabled: boolean;
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
  nasaApiKey: '',
  unsplashKey: '',
  pexelsKey: '',
  unsplashTopic: 'nature',
  pexelsQuery: 'mountains',
  genProvider: 'pollinations',
  pollinationsModel: 'flux',
  genResolution: 'auto',
  openaiKey: '',
  openaiModel: 'dall-e-3',
  rotationEnabled: false,
  rotationIntervalMinutes: 60,
};
