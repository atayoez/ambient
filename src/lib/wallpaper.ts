import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';

// localStorage key holding the path of the most-recently-applied
// wallpaper. Exported so the Library tab can read it directly (to
// disable delete on the currently-applied card). Centralized here so
// every apply path — Sources, Generate, Patterns, Library, rotation —
// updates it consistently via setWallpaper().
export const LAST_APPLIED_KEY = 'ambient-last-applied';

// Notification permission is asked at most once; the answer is cached
// across calls to avoid the cost of an invoke round-trip + re-prompting
// if the user denied. 'unknown' is the pre-check state.
let _notifyPermission: 'granted' | 'denied' | 'unknown' = 'unknown';

async function maybeNotifyApplied(localPath: string): Promise<void> {
  try {
    // Only fire when the window is hidden (tray) — when the user is
    // looking at the app the existing status pill is enough feedback
    // and a second toast on top is just noise.
    const win = getCurrentWindow();
    if (await win.isVisible()) return;

    if (_notifyPermission === 'unknown') {
      const initial = await isPermissionGranted();
      if (initial) {
        _notifyPermission = 'granted';
      } else {
        const result = await requestPermission();
        _notifyPermission = result === 'granted' ? 'granted' : 'denied';
      }
    }
    if (_notifyPermission !== 'granted') return;

    const filename = localPath.split('/').pop() ?? 'wallpaper';
    sendNotification({
      title: 'Ambient',
      body: `Wallpaper changed — ${filename}`,
    });
  } catch {
    // Permission API not available, system notifier offline, etc. The
    // wallpaper still applied; the toast is best-effort decoration.
  }
}

export async function setWallpaper(localPath: string): Promise<void> {
  await invoke('set_wallpaper', { path: localPath });
  try {
    localStorage.setItem(LAST_APPLIED_KEY, localPath);
  } catch {
    // Quota or storage disabled — the deletion-guard in Library will
    // just be less precise. Non-fatal.
  }
  try {
    window.dispatchEvent(
      new CustomEvent('ambient-wallpaper-applied', { detail: localPath }),
    );
  } catch {}
  void maybeNotifyApplied(localPath);
}

export async function downloadAndSave(url: string, filename: string): Promise<string> {
  return await invoke<string>('fetch_and_save_wallpaper', { url, filename });
}

export async function listLocalWallpapers(): Promise<string[]> {
  return await invoke<string[]>('list_wallpapers');
}

export async function deleteWallpaper(path: string): Promise<void> {
  await invoke('delete_wallpaper', { path });
}

// Returns the path to a cached 480×300 WebP thumbnail of the wallpaper,
// generating one if necessary. The Rust side stores thumbs under a
// `thumbs/` sibling of the wallpaper file; cache hits are an mtime
// check, so steady-state cost is a stat() per card. Re-using the source
// path as the cache key (via file stem) means we never invalidate
// stale; immutable library paths make that safe.
export async function getThumbnail(path: string): Promise<string> {
  return await invoke<string>('get_or_create_thumbnail', { path });
}
