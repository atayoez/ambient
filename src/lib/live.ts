import { invoke } from '@tauri-apps/api/core';

// Re-apply the active live wallpaper (if any) so a changed global — speed,
// render quality, the clock — reaches the desktop immediately instead of on
// the next apply. Rust re-stamps the spec from Settings and pushes it: the
// desktop-layer windows glide to the new values over an event, and the KDE
// plugin re-reads its config (no plasmashell restart — install_plugin only
// reloads the shell when the bundled plugin files actually changed).
export async function reapplyLiveWallpaper(): Promise<void> {
  try {
    const cfg = await invoke<unknown>('get_live_wallpaper');
    if (cfg) await invoke('apply_live_pattern', { config: cfg });
  } catch {
    // Nothing live, or not on a supported desktop — leave it.
  }
}

/** Range of the animation-speed slider (× the shipped pace). */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 3;
export const SPEED_STEP = 0.05;

/** "1×", "0.75×", "2.5×" — trims float noise from the slider's step math. */
export function formatSpeed(v: number): string {
  return `${Number(v.toFixed(2))}×`;
}
