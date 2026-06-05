// AI image generation moved into Rust in Phase 3. Pollinations is GET-only
// (URL construction) and OpenAI POSTs the prompt with the BYO key — both
// now live in src-tauri/src/aigen.rs. The OpenAI key is pulled from the
// OS keyring via secrets.rs rather than from plain-JSON settings.

import { invoke } from '@tauri-apps/api/core';
import type { Wallpaper } from './types';

export async function generateWallpaper(prompt: string): Promise<Wallpaper> {
  return invoke<Wallpaper>('generate_wallpaper', { prompt });
}

// Live model list from Pollinations' /models endpoint (via Rust). The
// service trims its catalogue over time, so the UI asks the server
// rather than shipping a hardcoded list that drifts out of date.
export async function pollinationsModels(): Promise<string[]> {
  return invoke<string[]>('pollinations_models');
}
