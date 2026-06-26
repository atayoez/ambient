// Update checker.
//
// Wraps tauri-plugin-updater's check() for version DETECTION only — it
// reads endpoints + pubkey from tauri.conf.json, fetches latest.json, and
// reports whether a newer version exists for this platform. We keep the 6h
// throttle + per-version dismiss UX on top.
//
// check() reports on the platforms present in latest.json's `platforms`
// block — macOS, Windows, and Linux (the AppImage). Whether we offer an
// in-app install or just link to the website depends on the platform:
//
//   Linux AppImage — installs IN-APP. tauri-plugin-updater replaces the
//     running $APPIMAGE on disk and we relaunch via plugin-process. No OS
//     installer, no code-sign gate — the cleanest self-update we have.
//   macOS / Windows — link to the website. Those bundles aren't OS-code-
//     signed, so a download-and-install would trip Gatekeeper/SmartScreen
//     mid-update; better to send the user to the page and let them handle
//     the one OS prompt deliberately.
//
// `canSelfUpdate()` asks the Rust side which case we're in (it checks
// $APPIMAGE), so the UI picks "Install & restart" vs "Download".

import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

/** True only when running as the Linux AppImage, which tauri-plugin-updater
 *  can replace in place. Cached after the first call (it never changes for
 *  the life of the process). Falls back to false if the command is missing
 *  (e.g. a dev build of the web UI without the Rust backend). */
let _selfUpdate: boolean | null = null;
export async function canSelfUpdate(): Promise<boolean> {
  if (_selfUpdate === null) {
    try {
      _selfUpdate = await invoke<boolean>('running_as_appimage');
    } catch {
      _selfUpdate = false;
    }
  }
  return _selfUpdate;
}

export type InstallProgress =
  | { phase: 'downloading'; downloaded: number; total: number | null }
  | { phase: 'installing' }
  | { phase: 'relaunching' };

/** Download + install the available update in place, then relaunch. Only
 *  valid where canSelfUpdate() is true (the AppImage). Throws on any
 *  failure — no update available, network error, signature mismatch — so
 *  the caller can show an error and fall back to the download page. Does
 *  not return on success (the process is replaced by relaunch()). */
export async function installUpdate(
  onProgress?: (p: InstallProgress) => void,
): Promise<void> {
  const update = await check();
  if (!update?.available) throw new Error('No update available');

  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? null;
        onProgress?.({ phase: 'downloading', downloaded: 0, total });
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        onProgress?.({ phase: 'downloading', downloaded, total });
        break;
      case 'Finished':
        onProgress?.({ phase: 'installing' });
        break;
    }
  });

  onProgress?.({ phase: 'relaunching' });
  await relaunch();
}

// Don't hit the manifest more than once every 6h. The check is cheap
// but pointless to repeat — releases happen at most weekly.
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'updater.lastChecked';
const DISMISSED_KEY = 'updater.dismissedVersion';

export interface UpdateInfo {
  version: string;
  current?: string;
  notes?: string;
}

/** Returns the new UpdateInfo if a newer version is available AND the
 *  user hasn't dismissed it. Returns null otherwise. */
export async function checkForUpdate(
  _currentVersion: string,
): Promise<UpdateInfo | null> {
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) || '0');
  if (Number.isFinite(last) && Date.now() - last < CHECK_THROTTLE_MS) {
    return null;
  }

  try {
    const update = await check();
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    if (!update?.available) return null;

    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed === update.version) return null;

    return {
      version: update.version,
      current: update.currentVersion,
      notes: update.body ?? '',
    };
  } catch {
    // Network down / endpoint unreachable / signature mismatch /
    // pre-plugin latest.json shape. All non-fatal — the user can
    // re-open the app later and try again.
    return null;
  }
}

export function dismissUpdate(version: string): void {
  localStorage.setItem(DISMISSED_KEY, version);
}

// Result of a user-initiated check (the About panel's "Check for
// updates" button), as opposed to the background banner check above.
export type ManualUpdateResult =
  | { status: 'available'; version: string; notes: string }
  | { status: 'uptodate' }
  | { status: 'error' };

/** Explicit, user-triggered update check. Unlike `checkForUpdate`, this
 *  bypasses the 6h throttle and the per-version dismiss — when someone
 *  clicks "Check for updates" they want an answer now, including the
 *  "you're up to date" case the background path stays silent about. */
export async function checkForUpdateManual(): Promise<ManualUpdateResult> {
  try {
    const update = await check();
    // Still stamp the timestamp so the background check doesn't
    // immediately re-hit the manifest right after a manual one.
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    if (update?.available) {
      return { status: 'available', version: update.version, notes: update.body ?? '' };
    }
    return { status: 'uptodate' };
  } catch {
    return { status: 'error' };
  }
}
