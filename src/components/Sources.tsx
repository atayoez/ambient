import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { dispatch, listen } from '../lib/events';
import { useDebouncedCallback, useKeydown } from '../lib/hooks';
import { useSecret } from '../lib/secrets';
import { fetchSourceWallpaper } from '../lib/sources';
import { loadLibrary, loadSettings, patchSettings } from '../lib/store';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type SourceKind,
  type Wallpaper,
} from '../lib/types';
import { setWallpaper } from '../lib/wallpaper';
import { CheckIcon, RefreshIcon } from './Icons';
import {
  InspectorSection,
  PreviewFrame,
  Select,
  StatusInline,
  TabLayout,
} from './layout';
import RotationControl from './RotationControl';

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

// Most-recent Library entry matching the current source. The Library is
// Rust-owned (settings.lastApplied + the prepend-on-fetch pipeline) so
// "have we already pulled an image for this source?" is just a list
// scan — no separate localStorage cache needed.
//
// NASA APOD freshness: the wire entry's addedAt timestamp is checked
// against the current local-day boundary. If the most-recent APOD entry
// is from a previous day, the caller treats it as stale and triggers a
// fresh fetch (APOD changes daily). For Unsplash / Pexels we always
// reuse the most recent — search results don't expire.
async function mostRecentFromSource(source: SourceKind): Promise<Wallpaper | null> {
  const lib = await loadLibrary();
  const match = lib.find((w) => w.source === source);
  if (!match) return null;
  if (source === 'nasa-apod' && !isFromToday(match.addedAt)) return null;
  return match;
}

function isFromToday(ms: number): boolean {
  const d = new Date(ms);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function Sources() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<Wallpaper | null>(null);

  // BYO API keys — Phase 3 moved storage from Settings JSON to the OS
  // keyring. The hooks own their own draft state + debounced persist.
  const [unsplashKey, setUnsplashKey, unsplashKeyLoaded] = useSecret('unsplash_key');
  const [pexelsKey, setPexelsKey, pexelsKeyLoaded] = useSecret('pexels_key');
  const secretsLoaded = unsplashKeyLoaded && pexelsKeyLoaded;

  const prevSource = useRef<SourceKind | null>(null);
  // Drafts for the search query inputs. Queries are commit-on-Enter (or
  // blur), not commit-on-keystroke — a half-typed "mounta" shouldn't
  // race ahead and persist to disk. Mirrors the rotation interval input
  // pattern.
  const [unsplashQueryDraft, setUnsplashQueryDraft] = useState('');
  const [pexelsQueryDraft, setPexelsQueryDraft] = useState('');

  function canFetch(s: Settings = settings): boolean {
    switch (s.source) {
      case 'nasa-apod':
        return true;
      case 'unsplash':
        return unsplashKey.trim().length > 0;
      case 'pexels':
        return pexelsKey.trim().length > 0;
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await loadSettings();
      if (cancelled) return;
      setSettings(s);
      prevSource.current = s.source;

      const recent = await mostRecentFromSource(s.source);
      if (cancelled) return;
      if (recent) {
        setPreviewPath(recent.path);
        setPreviewMeta(recent);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-fetch on first mount once secrets have loaded (Unsplash/Pexels
  // need the key in local state to satisfy canFetch). For NASA the
  // secrets load is irrelevant; we still gate on it so the effect runs
  // exactly once across all three sources. If a cache hit already
  // populated the preview, skip — the user didn't ask for a fresh fetch.
  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (autoFetchedRef.current) return;
    if (!secretsLoaded) return;
    if (previewPath) return;
    if (!canFetch(settings)) return;
    autoFetchedRef.current = true;
    void fetchNew(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretsLoaded, previewPath, settings.source]);

  useEffect(() => {
    if (prevSource.current === null) return;
    if (prevSource.current === settings.source) return;
    prevSource.current = settings.source;
    void (async () => {
      const recent = await mostRecentFromSource(settings.source);
      if (recent) {
        setPreviewPath(recent.path);
        setPreviewMeta(recent);
        return;
      }
      // No prior image for this source. Clear the stale preview from
      // the previous source so the user isn't staring at a NASA image
      // while configuring Unsplash.
      if (!canFetch(settings)) {
        setPreviewPath(null);
        setPreviewMeta(null);
        return;
      }
      void fetchNew(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.source]);

  useEffect(() => {
    // When rotation fires from outside the Sources tab (auto-rotate timer
    // or tray "Next wallpaper"), App.tsx dispatches this with the new
    // Wallpaper entry. We mirror it into the preview so the user sees the
    // fresh image even though the rotation logic itself doesn't live here
    // anymore.
    return listen('wallpaper-rotated', (entry) => {
      if (!entry) return;
      setPreviewPath(entry.path);
      setPreviewMeta(entry);
    });
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

  // 400 ms of quiet before we touch disk + flash "Saved". Without the
  // debounce, every keystroke into the Unsplash/Pexels query inputs
  // nagged the user with a fresh notification. App.tsx + RotationControl
  // pick up the Rust-emitted settings-changed event via the typed bus.
  const pendingPatchRef = useRef<Partial<Settings>>({});
  const debouncedFlush = useDebouncedCallback(() => {
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    void patchSettings(patch).then(() => {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1200);
      dispatch('settings-changed');
    });
  }, 400);

  function update(patch: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...patch }));
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    debouncedFlush();
  }

  async function fetchNew(apply: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus('Fetching from source…');
    try {
      // Rust does the source-API call, download, and library prepend
      // in a single command — no JS-side two-step anymore, and no
      // separate localStorage cache: the library entry IS the cache,
      // surfaced via mostRecentFromSource() on next mount / source flip.
      const entry = await fetchSourceWallpaper();
      setPreviewPath(entry.path);
      setPreviewMeta(entry);

      if (apply) {
        setStatus('Setting wallpaper…');
        await setWallpaper(entry.path);
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
              <InspectorSection title="Search">
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
                  aria-label="Unsplash search query"
                />
              </InspectorSection>
            )}

            {settings.source === 'pexels' && (
              <InspectorSection title="Search">
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
                  aria-label="Pexels search query"
                />
              </InspectorSection>
            )}

            <InspectorSection title="Auto-rotate">
              {settings.source === 'nasa-apod' ? (
                <div className="rotation-control">
                  <div
                    className="rotation-row"
                    data-enabled={settings.rotationSource === 'sources'}
                  >
                    <input
                      type="checkbox"
                      checked={settings.rotationSource === 'sources'}
                      aria-label="Refresh from NASA APOD daily"
                      onChange={(e) =>
                        update({ rotationSource: e.target.checked ? 'sources' : 'off' })
                      }
                    />
                    <span>daily</span>
                  </div>
                  {settings.rotationSource === 'library' && (
                    <p className="muted small">
                      Library shuffle is on — this will replace it.
                    </p>
                  )}
                </div>
              ) : (
                <RotationControl
                  mode="sources"
                  ariaLabel="Pull a new image from this source"
                  otherInUseHint="Library shuffle is on — this will replace it."
                />
              )}
            </InspectorSection>

            {settings.source === 'unsplash' && (
              <InspectorSection title="API key">
                <input
                  type="password"
                  value={unsplashKey}
                  onChange={(e) => setUnsplashKey(e.target.value)}
                  placeholder="get one at unsplash.com/developers"
                  aria-label="Unsplash API key"
                  disabled={!unsplashKeyLoaded}
                />
              </InspectorSection>
            )}

            {settings.source === 'pexels' && (
              <InspectorSection title="API key">
                <input
                  type="password"
                  value={pexelsKey}
                  onChange={(e) => setPexelsKey(e.target.value)}
                  placeholder="get one at pexels.com/api"
                  aria-label="Pexels API key"
                  disabled={!pexelsKeyLoaded}
                />
              </InspectorSection>
            )}
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
