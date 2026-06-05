// Settings and Library are Rust-owned in Phase 1 — every read/write is
// a single Tauri command. Rust holds the authoritative in-memory state
// behind a RwLock and persists to ambient-settings.json /
// ambient-library.json (atomic temp-file + rename). Concurrent patches
// serialize through the lock, which structurally rules out the
// cross-tab clobber bug that the old mutateSettings/mutateLibrary
// closure chains were built to work around.
//
// Per-tab draft state (patterns.config, generate.prompt, app.tab,
// generate.lastResult, patterns.themeMode) is single-writer, webview-only
// UI scratch — it lives in localStorage via loadKey / saveKey below.
// (Real data — settings, library, saved palettes — is Rust-owned; secrets
// are in the OS keyring. The tauri-plugin-store layer that used to back
// these drafts was retired.)

import { invoke } from '@tauri-apps/api/core';
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
// Per-tab draft KV (webview localStorage)
// ---------------------------------------------------------------------
//
// These are UI drafts, not durable data — a current pattern mid-edit, the
// last prompt, the active tab. WebKit persists localStorage to disk
// (per-origin, under the app data dir) so it survives app restarts and the
// close-to-tray webview teardown, which is all these need. Keys are
// namespaced ("patterns.config", "generate.prompt", …) to stay clear of
// any other localStorage use. The async signatures are kept so the hooks
// (usePersistedState / useDraftState) are unchanged.

const KEY_PREFIX = 'ambient:';

export async function loadKey<T>(key: string): Promise<T | null> {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    // Unparseable / storage unavailable — treat as absent.
    return null;
  }
}

export async function saveKey<T>(key: string, value: T): Promise<void> {
  try {
    localStorage.setItem(KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage quota / disabled — drafts are best-effort, so swallow.
  }
}
