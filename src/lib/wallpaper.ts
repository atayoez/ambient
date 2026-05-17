import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { mutateLibrary } from './store';

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
  // Promote the just-applied entry to the head of the library so the
  // grid is ordered by most-recently-applied. No-op when the path
  // isn't in the library (one-off apply from outside the app, or
  // mid-flight before Sources/Generate's prepend has committed). The
  // mutation dispatches `ambient-library-changed`, which the Library
  // tab listens for — so even applies from other tabs (Patterns Apply,
  // rotation tick, Sources fetch) re-sort the persisted order.
  try {
    await mutateLibrary((cur) => {
      const idx = cur.findIndex((w) => w.path === localPath);
      if (idx <= 0) return cur;
      return [cur[idx], ...cur.slice(0, idx), ...cur.slice(idx + 1)];
    });
  } catch {
    // Reorder failed (disk error) — non-fatal, the wallpaper is still
    // applied on-screen; the grid just stays in its old order.
  }
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
