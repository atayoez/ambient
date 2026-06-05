// Update checker.
//
// Wraps tauri-plugin-updater's check() for version DETECTION only — it
// reads endpoints + pubkey from tauri.conf.json, fetches latest.json, and
// reports whether a newer version exists for this platform. We keep the 6h
// throttle + per-version dismiss UX on top.
//
// We deliberately do NOT install in-app: the UpdateBanner + Settings both
// link to the website download page instead (builds aren't code-signed,
// and Linux installs are native packages that update via the package
// manager). Note check() only reports on platforms present in
// latest.json's `platforms` block — macOS + Windows. On Linux there's no
// platform entry, so no banner shows and "Check for updates" reports
// up-to-date; that's intended, the package manager owns Linux updates.

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
