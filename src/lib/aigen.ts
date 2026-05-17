// AI image generation moved into Rust in Phase 3. Pollinations is GET-only
// (URL construction) and OpenAI POSTs the prompt with the BYO key — both
// now live in src-tauri/src/aigen.rs. The OpenAI key is pulled from the
// OS keyring via secrets.rs rather than from plain-JSON settings.

import { invoke } from '@tauri-apps/api/core';
import type { Wallpaper } from './types';

export async function generateWallpaper(prompt: string): Promise<Wallpaper> {
  return invoke<Wallpaper>('generate_wallpaper', { prompt });
}
