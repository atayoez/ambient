import { fetchRandomFromSource } from './sources';
import { loadLibrary, loadSettings, mutateLibrary } from './store';
import type { Settings, SourceKind, Wallpaper } from './types';
import { downloadAndSave, setWallpaper } from './wallpaper';

interface SourcePreviewCache {
  source: SourceKind;
  date: string;
  localPath: string;
  title?: string;
}

function readSourcePreviewCache(): SourcePreviewCache | null {
  try {
    const raw = localStorage.getItem(SOURCE_PREVIEW_CACHE_KEY);
    return raw ? (JSON.parse(raw) as SourcePreviewCache) : null;
  } catch {
    return null;
  }
}

// Sources.tsx caches its last-shown preview in localStorage so the tab
// doesn't re-fetch on every mount. Keep the key in sync here; when
// rotation fires from outside Sources we overwrite that cache so the
// freshly-applied wallpaper is what the user sees when they next open
// the tab — not the previous fetch.
const SOURCE_PREVIEW_CACHE_KEY = 'ambient-source-preview-cache';

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readLastApplied(): string | null {
  // setWallpaper (lib/wallpaper.ts) writes LAST_APPLIED_KEY on every
  // apply path now, so any wallpaper change from anywhere updates the
  // value rotation.ts reads here.
  try {
    return localStorage.getItem('ambient-last-applied');
  } catch {
    return null;
  }
}

// Dispatch entry-point. Both the auto-rotate timer in App.tsx and the
// tray "Next wallpaper" menu item end up here. Branch on rotationSource:
//   'library'  → shuffleLibrary (no network, cycles existing entries)
//   'sources'  → fetchFromSource (current configured Source)
//   'off'      → fetchFromSource anyway. The 'off' case is for manual
//                tray clicks where the user explicitly asked for a new
//                wallpaper — treating that as "fetch from Sources" is
//                the more useful default than refusing to act.
export async function rotateNow(): Promise<Wallpaper> {
  const settings = await loadSettings();
  if (settings.rotationSource === 'library') {
    return shuffleLibrary();
  }
  return fetchFromSource(settings);
}

async function fetchFromSource(settings: Settings): Promise<Wallpaper> {
  // NASA APOD publishes once a day. If we've already fetched today's
  // image, re-apply the cached file instead of round-tripping through
  // the API. This lets the rotation timer tick freely without burning
  // through DEMO_KEY's 30/hr global cap, and matches the user-visible
  // promise of "refresh every day" rather than "refresh every N minutes
  // and pretend it changed."
  if (settings.source === 'nasa-apod') {
    const cached = readSourcePreviewCache();
    if (cached && cached.source === 'nasa-apod' && cached.date === todayKey()) {
      await setWallpaper(cached.localPath);
      const lib = await loadLibrary();
      const existing = lib.find((w) => w.path === cached.localPath);
      return (
        existing ?? {
          path: cached.localPath,
          source: 'nasa-apod',
          addedAt: Date.now(),
          title: cached.title,
        }
      );
    }
  }

  const fetched = await fetchRandomFromSource(settings);
  const localPath = await downloadAndSave(fetched.url, fetched.filename);
  const entry: Wallpaper = {
    path: localPath,
    source: fetched.source,
    addedAt: Date.now(),
    title: fetched.title,
  };
  await mutateLibrary((lib) => [entry, ...lib]);
  await setWallpaper(localPath);

  try {
    localStorage.setItem(
      SOURCE_PREVIEW_CACHE_KEY,
      JSON.stringify({
        source: fetched.source,
        date: todayKey(),
        localPath,
        title: fetched.title,
      }),
    );
  } catch {
    // localStorage might be full — non-fatal; Sources will re-fetch on
    // its next mount.
  }

  return entry;
}

async function shuffleLibrary(): Promise<Wallpaper> {
  const lib = await loadLibrary();
  if (lib.length === 0) {
    throw new Error('Library is empty — nothing to shuffle from.');
  }
  // Filter the most-recently-applied entry out of the pool so we don't
  // pick the same image two ticks in a row. With a one-item library,
  // filtering empties the pool — fall back to the unfiltered list so the
  // user still sees the rotation tick produce *something*.
  const lastApplied = readLastApplied();
  let pool = lastApplied ? lib.filter((w) => w.path !== lastApplied) : lib;
  if (pool.length === 0) pool = lib;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  await setWallpaper(pick.path);
  return pick;
}
