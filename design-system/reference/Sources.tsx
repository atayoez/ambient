import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { fetchRandomFromSource } from '../lib/sources';
import { downloadAndSave, setWallpaper } from '../lib/wallpaper';
import { loadLibrary, loadSettings, saveLibrary, saveSettings } from '../lib/store';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SourceKind,
  type Wallpaper,
} from '../lib/types';

function canFetch(s: Settings): boolean {
  switch (s.source) {
    case 'nasa-apod':
      return true;
    case 'unsplash':
      return Boolean(s.unsplashKey.trim());
    case 'pexels':
      return Boolean(s.pexelsKey.trim());
  }
}

const CACHE_KEY = 'ambient-source-preview-cache';

interface PreviewCacheEntry {
  source: SourceKind;
  date: string; // YYYY-MM-DD — used to expire NASA APOD daily
  localPath: string;
  title?: string;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadCache(): PreviewCacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCache(entry: PreviewCacheEntry) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage might be full — non-fatal, cache miss next time.
  }
}

// A cache entry is reusable if it matches the current source, the file is
// still in the library (i.e. user didn't delete it), and — for NASA APOD —
// it's from today (APOD is "one image per day", staleness matters).
async function reusableCache(
  entry: PreviewCacheEntry | null,
  source: SourceKind,
): Promise<PreviewCacheEntry | null> {
  if (!entry) return null;
  if (entry.source !== source) return null;
  if (source === 'nasa-apod' && entry.date !== todayKey()) return null;
  const lib = await loadLibrary();
  const stillThere = lib.some((w) => w.path === entry.localPath);
  return stillThere ? entry : null;
}

export default function Sources() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<Wallpaper | null>(null);

  const prevSource = useRef<SourceKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadSettings();
      if (cancelled) return;
      setSettings(s);
      prevSource.current = s.source;

      // Restore from cache if the entry is still valid (file in library +
      // NASA staleness rule).
      const cached = await reusableCache(loadCache(), s.source);
      if (cached) {
        setPreviewPath(cached.localPath);
        setPreviewMeta({
          path: cached.localPath,
          source: cached.source,
          title: cached.title,
          addedAt: 0,
        });
        return;
      }
      if (canFetch(s)) void fetchNew(false, s);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (prevSource.current === null) return;
    if (prevSource.current === settings.source) return;
    prevSource.current = settings.source;
    void (async () => {
      const cached = await reusableCache(loadCache(), settings.source);
      if (cached) {
        setPreviewPath(cached.localPath);
        setPreviewMeta({
          path: cached.localPath,
          source: cached.source,
          title: cached.title,
          addedAt: 0,
        });
        return;
      }
      if (canFetch(settings)) void fetchNew(false, settings);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.source]);

  useEffect(() => {
    const unsub = listen('rotate-now', () => {
      void fetchNew(true);
    });
    return () => {
      unsub.then((fn) => fn()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next).then(() => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
    });
  }

  async function fetchNew(apply: boolean, s?: Settings) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus('Fetching from source…');
    try {
      const current = s ?? settings;
      const fetched = await fetchRandomFromSource(current);
      setStatus('Downloading…');
      const localPath = await downloadAndSave(fetched.url, fetched.filename);
      const entry: Wallpaper = {
        path: localPath,
        source: fetched.source,
        addedAt: Date.now(),
        title: fetched.title,
      };
      const lib = await loadLibrary();
      await saveLibrary([entry, ...lib]);
      setPreviewPath(localPath);
      setPreviewMeta(entry);
      saveCache({
        source: fetched.source,
        date: todayKey(),
        localPath,
        title: fetched.title,
      });

      if (apply) {
        setStatus('Setting wallpaper…');
        await setWallpaper(localPath);
        setStatus('Applied — added to Library');
      } else {
        setStatus('Preview ready');
      }
      setTimeout(() => setStatus(null), 1800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function applyPreview() {
    if (!previewPath || busy) return;
    setBusy(true);
    setError(null);
    setStatus('Setting wallpaper…');
    try {
      await setWallpaper(previewPath);
      setStatus('Applied');
      setTimeout(() => setStatus(null), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings">
      {previewPath ? (
        <img
          src={convertFileSrc(previewPath)}
          alt={previewMeta?.title ?? ''}
          className="source-preview"
        />
      ) : (
        <div className="source-preview source-preview-empty">
          {canFetch(settings)
            ? 'Loading preview…'
            : 'Add an API key below to see a preview from this source.'}
        </div>
      )}

      <section>
        <h2>Source</h2>
        <select
          value={settings.source}
          onChange={(e) => update({ source: e.target.value as SourceKind })}
        >
          <option value="nasa-apod">NASA APOD (free, no key, one image per day)</option>
          <option value="unsplash">Unsplash</option>
          <option value="pexels">Pexels</option>
        </select>
        <p className="muted">
          NASA Astronomy Picture of the Day needs no key but only gives ~1 image / day —
          we cache it so the preview is instant after the first fetch.
          Unsplash and Pexels need a free API key in exchange for endless search-driven
          variety.
        </p>
      </section>

      {settings.source === 'nasa-apod' && (
        <section>
          <h2>NASA (optional)</h2>
          <label>
            API key
            <input
              type="password"
              value={settings.nasaApiKey}
              onChange={(e) => update({ nasaApiKey: e.target.value })}
              placeholder="leave blank to use shared DEMO_KEY"
            />
          </label>
          <p className="muted">
            Optional. Without one, Ambient falls back to NASA's shared{' '}
            <code>DEMO_KEY</code> — usually fine for normal use, but it's
            rate-limited to 30 requests/hour and 50/day across the whole
            internet. Grab a free personal key at <code>api.nasa.gov</code>{' '}
            (~30 seconds, just needs an email) for an unlimited 1000/hr limit.
          </p>
        </section>
      )}

      {settings.source === 'unsplash' && (
        <section>
          <h2>Unsplash</h2>
          <label>
            Access key
            <input
              type="password"
              value={settings.unsplashKey}
              onChange={(e) => update({ unsplashKey: e.target.value })}
              placeholder="get one at unsplash.com/developers"
            />
          </label>
          <label>
            Topic / search query
            <input
              value={settings.unsplashTopic}
              onChange={(e) => update({ unsplashTopic: e.target.value })}
              placeholder="nature"
            />
          </label>
        </section>
      )}

      {settings.source === 'pexels' && (
        <section>
          <h2>Pexels</h2>
          <label>
            API key
            <input
              type="password"
              value={settings.pexelsKey}
              onChange={(e) => update({ pexelsKey: e.target.value })}
              placeholder="get one at pexels.com/api"
            />
          </label>
          <label>
            Search query
            <input
              value={settings.pexelsQuery}
              onChange={(e) => update({ pexelsQuery: e.target.value })}
              placeholder="mountains"
            />
          </label>
        </section>
      )}

      <div className="row">
        <button onClick={() => fetchNew(false)} disabled={busy || !canFetch(settings)}>
          ↻ Re-fetch
        </button>
        <button
          onClick={applyPreview}
          disabled={busy || !previewPath}
          className="primary"
        >
          {busy ? 'Working…' : 'Apply as wallpaper'}
        </button>
        {status && <span className="status">{status}</span>}
        {error && <span className="error">{error}</span>}
      </div>

      {savedFlash && <div className="save-toast">Saved</div>}
    </div>
  );
}
