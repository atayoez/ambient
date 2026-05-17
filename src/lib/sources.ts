// Source fetching moved into Rust in Phase 3 — the previous two-step
// flow (TS calls source API for a URL → TS calls Rust download command)
// collapsed into a single command that reads the user's keys from the
// OS keyring, hits the API, downloads, prepends to library, and returns
// the Wallpaper entry. No TS-side HTTP path remains here.

import { invoke } from '@tauri-apps/api/core';
import type { Wallpaper } from './types';

export async function fetchSourceWallpaper(): Promise<Wallpaper> {
  return invoke<Wallpaper>('fetch_source_wallpaper');
}
