import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { useKeydown } from '../lib/hooks';
import { fetchRandomFromSource } from '../lib/sources';
import { loadLibrary, loadSettings, mutateLibrary, saveSettings } from '../lib/store';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SourceKind,
  type Wallpaper,
} from '../lib/types';
import { downloadAndSave, setWallpaper } from '../lib/wallpaper';
import { CheckIcon, RefreshIcon } from './Icons';
import {
  InspectorSection,
  PreviewFrame,
  Select,
  StatusInline,
  TabLayout,
} from './layout';
import RotationControl from './RotationControl';

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
  {
    id: 'nasa-apod',
    name: 'NASA Picture of the Day',
    description: 'Free · refreshes once a day',
  },
  {
    id: 'unsplash',
    name: 'Unsplash',
    description: 'Free with API key · search-driven',
  },
  {
    id: 'pexels',
    name: 'Pexels',
    description: 'Free with API key · search-driven',
  },
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
  // Debounces the disk save + "Saved" toast so typing into a text input
  // doesn't flash the notification on every keystroke. The in-memory
  // setSettings happens immediately; only the persistence is delayed.
  const saveDebounceRef = useRef<number | null>(null);
  // Drafts for the search query inputs. Queries are commit-on-Enter (or
  // blur), not commit-on-keystroke — a half-typed "mounta" shouldn't
  // race ahead and persist to disk. Mirrors the rotation interval input
  // pattern.
  const [unsplashQueryDraft, setUnsplashQueryDraft] = useState('');
  const [pexelsQueryDraft, setPexelsQueryDraft] = useState('');

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
    // When rotation fires from outside the Sources tab (auto-rotate timer
    // or tray "Next wallpaper"), App.tsx dispatches this with the new
    // Wallpaper entry. We mirror it into the preview so the user sees the
    // fresh image even though the rotation logic itself doesn't live here
    // anymore.
    function onRotated(e: Event) {
      const entry = (e as CustomEvent<Wallpaper>).detail;
      if (!entry) return;
      setPreviewPath(entry.path);
      setPreviewMeta(entry);
    }
    window.addEventListener('ambient-wallpaper-rotated', onRotated);
    return () => window.removeEventListener('ambient-wallpaper-rotated', onRotated);
  }, []);

  useEffect(() => {
    setUnsplashQueryDraft(settings.unsplashQuery);
  }, [settings.unsplashQuery]);

  useEffect(() => {
    setPexelsQueryDraft(settings.pexelsQuery);
  }, [settings.pexelsQuery]);

  function commitUnsplashQuery() {
    const trimmed = unsplashQueryDraft.trim();
    setUnsplashQueryDraft(trimmed);
    if (trimmed !== settings.unsplashQuery) {
      update({ unsplashQuery: trimmed });
    }
  }

  function commitPexelsQuery() {
    const trimmed = pexelsQueryDraft.trim();
    setPexelsQueryDraft(trimmed);
    if (trimmed !== settings.pexelsQuery) {
      update({ pexelsQuery: trimmed });
    }
  }

  function update(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    // 400 ms of quiet before we touch disk + flash "Saved". Without the
    // debounce, every keystroke into the Unsplash/Pexels query inputs
    // nagged the user with a fresh notification.
    if (saveDebounceRef.current !== null) {
      window.clearTimeout(saveDebounceRef.current);
    }
    saveDebounceRef.current = window.setTimeout(() => {
      void saveSettings(next).then(() => {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1200);
        // App.tsx + RotationControl mirrors listen for this so changes
        // to rotationSource / source-specific behavior propagate without
        // an app restart.
        window.dispatchEvent(new CustomEvent('ambient-settings-changed'));
      });
      saveDebounceRef.current = null;
    }, 400);
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
      await mutateLibrary((lib) => [entry, ...lib]);
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
      setTimeout(() => setStatus(null), 1500);
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
              <Select
                options={SOURCE_OPTIONS.map((s) => ({ id: s.id, label: s.name }))}
                value={settings.source}
                onChange={(v) => update({ source: v })}
                ariaLabel="Source"
              />
            </InspectorSection>

            {settings.source === 'unsplash' && (
              <InspectorSection title="Unsplash">
                <label className="field">
                  <span>API key</span>
                  <input
                    type="password"
                    value={settings.unsplashKey}
                    onChange={(e) => update({ unsplashKey: e.target.value })}
                    placeholder="get one at unsplash.com/developers"
                  />
                </label>
                <label className="field">
                  <span>Search query</span>
                  <input
                    type="text"
                    value={unsplashQueryDraft}
                    onChange={(e) => setUnsplashQueryDraft(e.target.value)}
                    onBlur={commitUnsplashQuery}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        commitUnsplashQuery();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
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
                    type="text"
                    value={pexelsQueryDraft}
                    onChange={(e) => setPexelsQueryDraft(e.target.value)}
                    onBlur={commitPexelsQuery}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        commitPexelsQuery();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="mountains"
                  />
                </label>
              </InspectorSection>
            )}

            <InspectorSection title="Auto-rotate">
              {settings.source === 'nasa-apod' ? (
                <div className="rotation-control">
                  <label className="row-toggle">
                    <input
                      type="checkbox"
                      checked={settings.rotationSource === 'sources'}
                      onChange={(e) =>
                        update({ rotationSource: e.target.checked ? 'sources' : 'off' })
                      }
                    />
                    <span>Refresh every day</span>
                  </label>
                  {settings.rotationSource === 'library' && (
                    <p className="muted small">
                      Library shuffle is on — this will replace it.
                    </p>
                  )}
                </div>
              ) : (
                <RotationControl
                  mode="sources"
                  label="Pull a new image from this source"
                  otherInUseHint="Library shuffle is on — this will replace it."
                />
              )}
            </InspectorSection>
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => fetchNew(false)}
              disabled={busy || !canFetch(settings)}
              className="icon-btn"
              aria-label="Re-fetch"
              title="Fetch a new image (⌘⇧R)"
            >
              <RefreshIcon />
            </button>
            <button
              type="button"
              onClick={applyPreview}
              disabled={busy || !previewPath}
              className="primary icon-btn"
              aria-label="Apply as wallpaper"
              title="Apply as wallpaper (⌘⏎)"
            >
              <CheckIcon />
            </button>
            <StatusInline status={status} error={error} />
          </>
        }
      />

      {savedFlash && <div className="save-toast">Saved</div>}
    </div>
  );
}
