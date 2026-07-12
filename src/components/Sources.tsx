import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../lib/appHooks';
import { listen } from '../lib/events';
import {
  useDebouncedCallback,
  useDebouncedSettingsPatch,
  useKeydown,
} from '../lib/hooks';
import { useSecret } from '../lib/secrets';
import { fetchSourceWallpaper } from '../lib/sources';
import { loadLibrary } from '../lib/store';
import type { Settings, SourceKind, Wallpaper } from '../lib/types';
import { setWallpaper } from '../lib/wallpaper';
import { Field, IconButton, OptionScroller, StatusInline, toast } from '../ui';
import { CheckIcon, RefreshIcon } from './Icons';

// One row of metadata per source drives the whole tab: the picker label,
// whether it has a search query (and which Settings field backs it), and
// whether it hard-requires an API key. NASA/Bing/Picsum need nothing;
// Unsplash/Pexels require a key; Wallhaven's key is optional.
interface SourceMeta {
  id: SourceKind;
  name: string;
  /** Settings field backing the search box, if the source is searchable. */
  queryField?: 'unsplashQuery' | 'pexelsQuery' | 'wallhavenQuery';
  queryPlaceholder?: string;
  /** Keyring secret that MUST be set before this source can fetch. */
  requiresKey?: 'unsplash_key' | 'pexels_key';
  /** Display name used in the "add your key" hint. */
  keyLabel?: string;
}

const SOURCES: SourceMeta[] = [
  { id: 'nasa-apod', name: 'NASA Picture of the Day' },
  { id: 'bing', name: 'Bing Photo of the Day' },
  { id: 'picsum', name: 'Lorem Picsum (random)' },
  {
    id: 'unsplash',
    name: 'Unsplash',
    queryField: 'unsplashQuery',
    queryPlaceholder: 'nature',
    requiresKey: 'unsplash_key',
    keyLabel: 'Unsplash',
  },
  {
    id: 'pexels',
    name: 'Pexels',
    queryField: 'pexelsQuery',
    queryPlaceholder: 'mountains',
    requiresKey: 'pexels_key',
    keyLabel: 'Pexels',
  },
  {
    id: 'wallhaven',
    name: 'Wallhaven',
    queryField: 'wallhavenQuery',
    queryPlaceholder: 'landscape',
  },
];

const sourceMeta = (id: SourceKind): SourceMeta =>
  SOURCES.find((s) => s.id === id) ?? SOURCES[0];

// Wallhaven advanced options. Values are the raw API params; labels are
// friendly. (categories/purity are the API's 3-bit strings.)
const WH_SORT = [
  { id: 'random', label: 'Random' },
  { id: 'toplist', label: 'Top this month' },
  { id: 'date_added', label: 'Latest' },
  { id: 'views', label: 'Most viewed' },
];
const WH_CATEGORIES = [
  { id: '100', label: 'General' },
  { id: '110', label: 'General + Anime' },
  { id: '111', label: 'Everything' },
];
const WH_PURITY = [
  { id: '100', label: 'SFW' },
  { id: '110', label: 'SFW + Sketchy' },
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
  // Always reuse the most recent cached image for this source — including
  // NASA APOD. The previous code dropped a NASA preview that wasn't from
  // "today", which forced a redundant network re-fetch every launch even
  // though a perfectly good image was already on disk. Freshness is the
  // job of the opt-in daily auto-rotate, not of silently discarding the
  // cache; this keeps the last image instantly on screen and never drops
  // it on a tab switch or relaunch.
  return lib.find((w) => w.source === source) ?? null;
}

// `active` — whether this is the visible tab; gates the window-level
// shortcuts below (tabs stay mounted after their first visit).
export default function Sources({ active = true }: { active?: boolean }) {
  // null until the Rust-owned settings load (a ~ms RAM read).
  const [settings, setSettings] = useSettings();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<Wallpaper | null>(null);
  // Flips true once the on-mount cache lookup resolves; auto-fetch waits
  // on it so a cache hit can't be raced by a redundant network fetch.
  const [cacheChecked, setCacheChecked] = useState(false);

  // BYO API keys — Phase 3 moved storage from Settings JSON to the OS
  // keyring. The hooks own their own draft state + debounced persist.
  // Keys are set in the Settings tab now; here we only read them (to
  // gate fetching + the "add a key" hint), so the setters are dropped.
  const [unsplashKey, , unsplashKeyLoaded] = useSecret('unsplash_key');
  const [pexelsKey, , pexelsKeyLoaded] = useSecret('pexels_key');
  const secretsLoaded = unsplashKeyLoaded && pexelsKeyLoaded;

  const prevSource = useRef<SourceKind | null>(null);
  // Drafts for the search query inputs. Queries are commit-on-Enter (or
  // blur), not commit-on-keystroke — a half-typed "mounta" shouldn't
  // race ahead and persist to disk. Mirrors the rotation interval input
  // pattern.
  // One search draft for whichever source is active (commit-on-Enter/blur).
  const [queryDraft, setQueryDraft] = useState('');

  function canFetch(s: Settings | null = settings): boolean {
    if (!s) return false; // settings not loaded yet
    const meta = sourceMeta(s.source);
    if (meta.requiresKey === 'unsplash_key') return unsplashKey.trim().length > 0;
    if (meta.requiresKey === 'pexels_key') return pexelsKey.trim().length > 0;
    return true; // NASA, Bing, Picsum, Wallhaven (key optional)
  }

  // Once the settings land (useSettings), do the one-time cache lookup
  // for the active source. The ref gate keeps this from re-running on
  // later optimistic settings updates.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!settings || initializedRef.current) return;
    initializedRef.current = true;
    prevSource.current = settings.source;
    let cancelled = false;
    (async () => {
      const recent = await mostRecentFromSource(settings.source);
      if (cancelled) return;
      if (recent) {
        setPreviewPath(recent.path);
        setPreviewMeta(recent);
      }
      // Signal that the cache lookup has definitively resolved (hit or
      // miss). Auto-fetch waits on this so it can't race ahead of a cache
      // hit and fire a redundant network request over an image that was
      // about to populate.
      setCacheChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // Auto-fetch on first mount once secrets have loaded (Unsplash/Pexels
  // need the key in local state to satisfy canFetch). Also gated on the
  // cache lookup having completed, so a cache hit wins over a fresh fetch.
  const autoFetchedRef = useRef(false);
  useEffect(() => {
    if (autoFetchedRef.current) return;
    if (!secretsLoaded || !cacheChecked) return;
    if (previewPath) return;
    if (!canFetch(settings)) return;
    autoFetchedRef.current = true;
    void fetchNew(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretsLoaded, cacheChecked, previewPath, settings?.source]);

  useEffect(() => {
    if (!settings || prevSource.current === null) return;
    if (prevSource.current === settings.source) return;
    const source = settings.source;
    prevSource.current = source;
    void (async () => {
      // Switching source shows that source's cached image instantly if we
      // have one; otherwise auto-fetch a fresh one (debounced, so flicking
      // through the scroller only fetches the source you settle on). This
      // is why landing on a fresh source like Wallhaven now loads a
      // preview instead of sitting empty.
      const recent = await mostRecentFromSource(source);
      setPreviewPath(recent?.path ?? null);
      setPreviewMeta(recent ?? null);
      if (!recent) scheduleAutoFetch();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.source]);

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

  // Mirror the active source's stored query into the draft whenever the
  // source (or any stored query) changes.
  useEffect(() => {
    if (!settings) return;
    const field = sourceMeta(settings.source).queryField;
    setQueryDraft(field ? settings[field] : '');
  }, [
    settings?.source,
    settings?.unsplashQuery,
    settings?.pexelsQuery,
    settings?.wallhavenQuery,
  ]);

  function commitQuery() {
    if (!settings) return;
    const field = sourceMeta(settings.source).queryField;
    if (!field) return;
    const trimmed = queryDraft.trim();
    setQueryDraft(trimmed);
    if (trimmed !== settings[field]) {
      update({ [field]: trimmed });
      // New search → pull a matching preview (after the settings flush).
      scheduleAutoFetch();
    }
  }

  // 400 ms of quiet before we touch disk + flash "Saved". Without the
  // debounce, every keystroke into the Unsplash/Pexels query inputs
  // nagged the user with a fresh notification. App.tsx + RotationControl
  // pick up the Rust-emitted settings-changed event via the typed bus.
  const queuePatch = useDebouncedSettingsPatch(() => toast.success('Saved'));

  function update(patch: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    queuePatch(patch);
  }

  // Auto-pull a fresh preview after a source switch or a search/options
  // change. Debounced at 600ms — longer than the 400ms settings flush, so
  // (a) flicking through the Source scroller fires one request for the
  // source you land on, not one per step, and (b) Rust already has the
  // updated source/query/options by the time we fetch.
  const scheduleAutoFetch = useDebouncedCallback(() => {
    if (!busy && canFetch()) void fetchNew(false);
  }, 600);

  async function fetchNew(apply: boolean) {
    if (busy) return;
    setBusy(true);
    setStatus('Fetching…');
    try {
      // Rust does the source-API call, download, and library prepend
      // in a single command — no JS-side two-step anymore, and no
      // separate localStorage cache: the library entry IS the cache,
      // surfaced via mostRecentFromSource() on next mount / source flip.
      const entry = await fetchSourceWallpaper();
      setPreviewPath(entry.path);
      setPreviewMeta(entry);

      if (apply) {
        setStatus('Applying…');
        await setWallpaper(entry.path);
        setStatus(null);
        toast.success('Applied');
      } else {
        setStatus(null);
        toast.success('Preview ready');
      }
    } catch (e: unknown) {
      toast.fromError(e);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function applyPreview() {
    if (!previewPath || busy) return;
    setBusy(true);
    setStatus('Applying…');
    try {
      await setWallpaper(previewPath);
      setStatus(null);
      toast.success('Applied');
    } catch (e: unknown) {
      toast.fromError(e);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  // Cmd/Ctrl+Enter applies the current preview as the wallpaper.
  // Cmd/Ctrl+Shift+R fetches a fresh image. Only live while this is the
  // visible tab.
  useKeydown('Enter', () => void applyPreview(), { cmdOrCtrl: true, enabled: active });
  useKeydown('r', () => void fetchNew(false), {
    cmdOrCtrl: true,
    shift: true,
    enabled: active,
  });

  // Settings haven't loaded yet (first frame) — all hooks are above, so
  // the early return is safe.
  if (!settings) return null;

  const meta = sourceMeta(settings.source);
  const emptyMessage = canFetch(settings)
    ? 'Loading preview…'
    : `Add your ${meta.keyLabel ?? 'API'} key in Settings to preview this source.`;

  return (
    <div className="sources">
      <div className="gen-stage">
        {previewPath ? (
          <img
            className="gen-bg"
            src={convertFileSrc(previewPath)}
            alt={previewMeta?.title ?? ''}
          />
        ) : (
          <div className="gen-bg gen-bg-empty" aria-hidden="true" />
        )}

        <div className="gen-panel pat-top">
          <OptionScroller
            label="Source"
            options={SOURCES.map((s) => ({ id: s.id, label: s.name }))}
            value={settings.source}
            onChange={(v) => update({ source: v })}
            ariaLabel="Source"
          />
        </div>

        {!previewPath && <p className="gen-empty-hint">{emptyMessage}</p>}

        {/* Side panel only for searchable sources (Unsplash/Pexels/
            Wallhaven). NASA / Bing / Picsum have nothing to configure. */}
        {meta.queryField && (
          <div className="gen-panel pat-side">
            <Field label="Search">
              <input
                type="text"
                value={queryDraft}
                onChange={(e) => setQueryDraft(e.target.value)}
                onBlur={commitQuery}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitQuery();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder={meta.queryPlaceholder}
                aria-label="Search query"
              />
            </Field>
            {settings.source === 'wallhaven' && (
              <>
                <OptionScroller
                  label="Sort"
                  options={WH_SORT}
                  value={settings.wallhavenSorting || 'random'}
                  onChange={(v) => {
                    update({ wallhavenSorting: v });
                    scheduleAutoFetch();
                  }}
                  ariaLabel="Wallhaven sort"
                />
                <OptionScroller
                  label="Categories"
                  options={WH_CATEGORIES}
                  value={settings.wallhavenCategories || '100'}
                  onChange={(v) => {
                    update({ wallhavenCategories: v });
                    scheduleAutoFetch();
                  }}
                  ariaLabel="Wallhaven categories"
                />
                <OptionScroller
                  label="Content"
                  options={WH_PURITY}
                  value={settings.wallhavenPurity || '100'}
                  onChange={(v) => {
                    update({ wallhavenPurity: v });
                    scheduleAutoFetch();
                  }}
                  ariaLabel="Wallhaven content rating"
                />
              </>
            )}
            {!canFetch(settings) && (
              <p className="muted small">
                Add your {meta.keyLabel} API key in Settings to preview this source.
              </p>
            )}
          </div>
        )}

        <div className="pat-actions">
          <StatusInline status={status} />
          <IconButton
            onClick={() => fetchNew(false)}
            disabled={busy || !canFetch(settings)}
            label="Re-fetch"
            title="Fetch a new image (⌘⇧R)"
          >
            <RefreshIcon />
          </IconButton>
          <IconButton
            variant="primary"
            onClick={applyPreview}
            disabled={busy || !previewPath}
            label="Apply as wallpaper"
            title="Apply as wallpaper (⌘⏎)"
          >
            <CheckIcon />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
