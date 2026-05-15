import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';
import { useKeydown } from '../lib/hooks';
import { fetchRandomFromSource } from '../lib/sources';
import { loadLibrary, loadSettings, saveLibrary, saveSettings } from '../lib/store';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SourceKind,
  type Wallpaper,
} from '../lib/types';
import { downloadAndSave, setWallpaper } from '../lib/wallpaper';
import { InspectorSection, PreviewFrame, StatusInline, TabLayout } from './layout';

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

const SOURCE_OPTIONS: { id: SourceKind; name: string; description: string }[] = [
  { id: 'nasa-apod', name: 'NASA APOD', description: 'Free · one image per day' },
  { id: 'unsplash', name: 'Unsplash', description: 'Free API key · search-driven' },
  { id: 'pexels', name: 'Pexels', description: 'Free API key · search-driven' },
];

const CACHE_KEY = 'ambient-source-preview-cache';

interface PreviewCacheEntry {
  source: SourceKind;
  date: string; // YYYY-MM-DD — used to expire NASA APOD daily
  localPath: string;
  title?: string;
}

function todayKey(): string {
  // Temporal gives the always-correct local date. WebKit on Linux may lag
  // behind on this proposal, so feature-detect and fall back to a manually
  // composed local YYYY-MM-DD — `toISOString().slice(0,10)` would silently
  // UTC-shift the value near midnight.
  const T = (
    globalThis as {
      Temporal?: { Now: { plainDateISO: () => { toString: () => string } } };
    }
  ).Temporal;
  if (T) return T.Now.plainDateISO().toString();
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
      // No cache for the new source. Clear the stale preview from the
      // previous source so the user isn't staring at a NASA image while
      // configuring Unsplash.
      if (!canFetch(settings)) {
        setPreviewPath(null);
        setPreviewMeta(null);
        return;
      }
      void fetchNew(false, settings);
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

  // Cmd/Ctrl+Enter applies the current preview as the wallpaper.
  // Cmd/Ctrl+Shift+R fetches a fresh image.
  useKeydown('Enter', () => void applyPreview(), { cmdOrCtrl: true });
  useKeydown('r', () => void fetchNew(false), { cmdOrCtrl: true, shift: true });

  const emptyMessage = canFetch(settings)
    ? 'Loading preview…'
    : 'Add an API key below to see a preview from this source.';

  return (
    <div className="sources">
      <TabLayout
        preview={
          <PreviewFrame empty={emptyMessage}>
            {previewPath ? (
              <img src={convertFileSrc(previewPath)} alt={previewMeta?.title ?? ''} />
            ) : null}
          </PreviewFrame>
        }
        inspector={
          <>
            <InspectorSection title="Source">
              <div className="type-list" role="radiogroup" aria-label="Source">
                {SOURCE_OPTIONS.map(({ id, name, description }) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={settings.source === id}
                    className={settings.source === id ? 'type-row active' : 'type-row'}
                    onClick={() => update({ source: id })}
                  >
                    <span className="type-text">
                      <span className="type-name">{name}</span>
                      <span className="type-desc">{description}</span>
                    </span>
                    {settings.source === id && (
                      <span className="type-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p className="muted small">
                NASA APOD caches one image per day. Unsplash and Pexels need a
                free API key for unlimited search-driven variety.
              </p>
            </InspectorSection>

            {settings.source === 'nasa-apod' && (
              <InspectorSection title="NASA (optional)">
                <label className="field">
                  <span>API key</span>
                  <input
                    type="password"
                    value={settings.nasaApiKey}
                    onChange={(e) => update({ nasaApiKey: e.target.value })}
                    placeholder="leave blank to use shared DEMO_KEY"
                  />
                </label>
                <p className="muted small">
                  Without one, Ambient uses NASA's shared <code>DEMO_KEY</code>
                  {' — '}rate-limited to 30/hr across the internet. Grab a free
                  personal key at <code>api.nasa.gov</code> for 1000/hr.
                </p>
              </InspectorSection>
            )}

            {settings.source === 'unsplash' && (
              <InspectorSection title="Unsplash">
                <label className="field">
                  <span>Access key</span>
                  <input
                    type="password"
                    value={settings.unsplashKey}
                    onChange={(e) => update({ unsplashKey: e.target.value })}
                    placeholder="get one at unsplash.com/developers"
                  />
                </label>
                <label className="field">
                  <span>Topic / search query</span>
                  <input
                    value={settings.unsplashTopic}
                    onChange={(e) => update({ unsplashTopic: e.target.value })}
                    placeholder="nature"
                  />
                </label>
              </InspectorSection>
            )}

            {settings.source === 'pexels' && (
              <InspectorSection title="Pexels">
                <label className="field">
                  <span>API key</span>
                  <input
                    type="password"
                    value={settings.pexelsKey}
                    onChange={(e) => update({ pexelsKey: e.target.value })}
                    placeholder="get one at pexels.com/api"
                  />
                </label>
                <label className="field">
                  <span>Search query</span>
                  <input
                    value={settings.pexelsQuery}
                    onChange={(e) => update({ pexelsQuery: e.target.value })}
                    placeholder="mountains"
                  />
                </label>
              </InspectorSection>
            )}
          </>
        }
        actions={
          <>
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
            <StatusInline status={status} error={error} />
          </>
        }
      />

      {savedFlash && <div className="save-toast">Saved</div>}
    </div>
  );
}
