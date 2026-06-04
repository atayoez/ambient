// Settings and Library are Rust-owned in Phase 1 — every read/write is
// a single Tauri command. Rust holds the authoritative in-memory state
// behind a RwLock and persists to ambient-settings.json /
// ambient-library.json (atomic temp-file + rename). Concurrent patches
// serialize through the lock, which structurally rules out the
// cross-tab clobber bug that the old mutateSettings/mutateLibrary
// closure chains were built to work around.
//
// Per-tab draft state (patterns.config, generate.prompt, app.tab,
// generate.lastResult, patterns.themeMode) is single-writer and stays
// on the legacy tauri-plugin-store path via loadKey / saveKey below.

import { invoke } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
import type { Settings, Wallpaper, WallpaperMode } from './types';

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

export async function loadSettings(): Promise<Settings> {
  return invoke<Settings>('get_settings');
}

// Apply a partial settings update under the Rust RwLock. Returns the
// post-patch Settings so callers can update their local view without a
// follow-up load. The Rust side also emits a `settings-changed` Tauri
// event which a bridge in App.tsx forwards onto the typed event bus —
// callers that just want "refresh on any change" subscribe there.
export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  return invoke<Settings>('patch_settings', { patch });
}

// ---------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------

// Discrete mutations matching Rust's library_store::LibraryOp enum.
// Sending an op instead of an arbitrary closure keeps the wire format
// small (no full-list round-trip per mutation) and serializes naturally.
// Only `remove` + `removeOrphans` ship from JS today — `prepend` and
// `promoteToHead` are driven Rust-side from the apply/fetch/generate
// pipelines, so JS never constructs those variants.
type LibraryOp =
  | { op: 'remove'; data: { path: string } }
  | { op: 'setMode'; data: { path: string; mode: WallpaperMode } }
  | { op: 'removeOrphans'; data: { existing: string[] } };

export async function loadLibrary(): Promise<Wallpaper[]> {
  return invoke<Wallpaper[]>('get_library');
}

async function patchLibrary(op: LibraryOp): Promise<Wallpaper[]> {
  return invoke<Wallpaper[]>('patch_library', { op });
}

export async function removeFromLibrary(path: string): Promise<Wallpaper[]> {
  return patchLibrary({ op: 'remove', data: { path } });
}

export async function removeLibraryOrphans(existing: string[]): Promise<Wallpaper[]> {
  return patchLibrary({ op: 'removeOrphans', data: { existing } });
}

// Tag a library entry's light/dark eligibility. Drives the rotation /
// "Next" pools (a light-tagged wallpaper joins the light pool).
export async function setWallpaperMode(
  path: string,
  mode: WallpaperMode,
): Promise<Wallpaper[]> {
  return patchLibrary({ op: 'setMode', data: { path, mode } });
}

// ---------------------------------------------------------------------
// Per-tab draft KV (legacy tauri-plugin-store)
// ---------------------------------------------------------------------

let _store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!_store) {
    // autoSave OFF — the few callers (usePersistedState, useDraftState)
    // explicitly call save() on user gestures. High-frequency state
    // like Patterns slider drags lives in useDraftState and is flushed
    // only when the user clicks Apply.
    _store = await load('ambient.json', { defaults: {}, autoSave: false });
  }
  return _store;
}

export async function loadKey<T>(key: string): Promise<T | null> {
  const store = await getStore();
  return ((await store.get<T>(key)) as T | undefined) ?? null;
}

export async function saveKey<T>(key: string, value: T): Promise<void> {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}
