import { invoke } from '@tauri-apps/api/core';

// localStorage key holding the path of the most-recently-applied
// wallpaper. Exported so the Library tab can read it directly (to
// disable delete on the currently-applied card). Centralized here so
// every apply path — Sources, Generate, Patterns, Library, rotation —
// updates it consistently via setWallpaper().
export const LAST_APPLIED_KEY = 'ambient-last-applied';

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
