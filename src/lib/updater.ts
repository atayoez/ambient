// Update checker.
//
// Wraps tauri-plugin-updater's check() so we keep the existing 6h
// throttle + per-version dismiss UX, but otherwise hand off to the
// plugin: it reads endpoints + pubkey from tauri.conf.json, fetches
// latest.json, verifies the minisign signature on the platform-matching
// artifact, and exposes a download_and_install() path on the returned
// handle when the user opts in.
//
// What this does NOT do (yet): trigger the actual install. The
// UpdateBanner UI still links to the website download. Flipping that to
// a one-click in-app update is a small wiring change once we trust the
// signed-artifact pipeline end-to-end.

import { check } from '@tauri-apps/plugin-updater';

// Don't hit the manifest more than once every 6h. The check is cheap
// but pointless to repeat — releases happen at most weekly.
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'updater.lastChecked';
const DISMISSED_KEY = 'updater.dismissedVersion';

export interface UpdateInfo {
  version: string;
  current?: string;
  notes?: string;
  downloads?: {
    macos?: string;
    windows?: string;
    linux?: string;
  };
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
      // Fallback download URLs — the alias resolves to whatever's in
      // latest.json's `downloads` block. The plugin's own
      // download_and_install() reads the signed `platforms` block
      // instead, so these are only used by the "open the website to
      // download manually" path in UpdateBanner.
      downloads: {
        macos: 'https://ambient.oezcan.me/downloads/latest/macos',
        windows: 'https://ambient.oezcan.me/downloads/latest/windows',
        linux: 'https://ambient.oezcan.me/downloads/latest/linux',
      },
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
