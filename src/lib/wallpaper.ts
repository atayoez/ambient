import { invoke } from '@tauri-apps/api/core';

// Apply a wallpaper. Phase 4 collapsed the full apply pipeline into
// the Rust side: invoking set_wallpaper runs the OS apply, stamps
// settings.lastApplied + the matching theme-follow slot, promotes
// the entry to the head of the library, fires a system notification
// when the window is hidden, and emits the `wallpaper-applied` Tauri
// event (which App.tsx forwards to the typed event bus).
//
// Consumers that need to react to apply events listen on the typed
// bus rather than relying on a sequence of awaits here.
export async function setWallpaper(localPath: string): Promise<void> {
  await invoke('set_wallpaper', { path: localPath });
}

export async function listLocalWallpapers(): Promise<string[]> {
  return await invoke<string[]>('list_wallpapers');
}

export async function deleteWallpaper(path: string): Promise<void> {
  await invoke('delete_wallpaper', { path });
}

// Drop the regenerable WebP thumbnail cache. Non-destructive — the grid
// re-creates thumbnails on next view.
export async function clearThumbnailCache(): Promise<void> {
  await invoke('clear_thumbnail_cache');
}

// Delete every wallpaper Ambient has saved (files + thumbnails) and empty
// the library index. Returns the number of image files removed. The live
// desktop wallpaper (the DE's own copy) is unaffected.
export async function deleteLocalWallpapers(): Promise<number> {
  return await invoke<number>('delete_local_wallpapers');
}

// Returns the path to a cached 480×300 WebP thumbnail of the wallpaper,
// generating one if necessary. The Rust side stores thumbs under a
// `thumbs/` sibling of the wallpaper file; cache hits are an mtime
// check, so steady-state cost is a stat() per card.
export async function getThumbnail(path: string): Promise<string> {
  return await invoke<string>('get_or_create_thumbnail', { path });
}
