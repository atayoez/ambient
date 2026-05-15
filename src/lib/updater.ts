// Lightweight update checker.
//
// Polls a JSON manifest hosted at https://ambient.oezcan.me/downloads/
// latest.json. If the version field is greater than the running app's
// version, surfaces an UpdateInfo to the caller so the UI can prompt
// the user. No auto-download, no signature verification — buyers
// follow the link to the website to grab the new build.
//
// Cheap, no signing required. Trade-off vs. tauri-plugin-updater: that
// plugin does in-place updates with signature verification, but
// requires a tauri signer keypair, signed bundles in CI, and updater
// metadata generation on every release. v0 ships without that
// machinery; we can layer it on later if customers ask.

import { fetch } from '@tauri-apps/plugin-http';

const UPDATE_URL = 'https://ambient.oezcan.me/downloads/latest.json';
// Don't hit the manifest more than once every 6h. The check is cheap
// but pointless to repeat — a v0.1 → v0.2 release happens at most
// once a week.
const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;
const LAST_CHECK_KEY = 'updater.lastChecked';
const DISMISSED_KEY = 'updater.dismissedVersion';

export interface UpdateInfo {
  version: string;
  released?: string;
  notes?: string;
  downloads?: {
    macos?: string;
    windows?: string;
    linux?: string;
  };
}

/** Returns the new UpdateInfo if a newer version is available AND the
 *  user hasn't dismissed it. Returns null otherwise. */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) || '0');
  if (Number.isFinite(last) && Date.now() - last < CHECK_THROTTLE_MS) {
    return null;
  }

  try {
    const res = await fetch(UPDATE_URL, { method: 'GET' });
    if (!res.ok) return null;
    const data = (await res.json()) as UpdateInfo;
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

    if (!data?.version) return null;
    if (!versionGreater(data.version, currentVersion)) return null;

    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed === data.version) return null;

    return data;
  } catch {
    return null;
  }
}

export function dismissUpdate(version: string): void {
  localStorage.setItem(DISMISSED_KEY, version);
}

/** Pure semver-ish compare: a > b? Treats missing segments as 0, so
 *  "1.2" > "1.1.9" and "0.2.0" > "0.1.99". Ignores pre-release tags
 *  — fine for our two-digit versioning, revisit if we ever ship -rc
 *  builds. */
export function versionGreater(a: string, b: string): boolean {
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return true;
    if (da < db) return false;
  }
  return false;
}

function parts(v: string): number[] {
  return v
    .replace(/^v/, '')
    .split('.')
    .map((s) => Number.parseInt(s, 10) || 0);
}
