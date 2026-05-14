import { invoke } from '@tauri-apps/api/core';

export async function setWallpaper(localPath: string): Promise<void> {
  await invoke('set_wallpaper', { path: localPath });
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
