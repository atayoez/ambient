import { convertFileSrc } from '@tauri-apps/api/core';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { dispatch, listen } from '../lib/events';
import {
  loadLibrary,
  loadSettings,
  patchSettings,
  removeFromLibrary,
  removeLibraryOrphans,
} from '../lib/store';
import type { ThemeMode } from '../lib/theme';
import { DEFAULT_SETTINGS, type Settings, type Wallpaper } from '../lib/types';
import {
  deleteWallpaper,
  getThumbnail,
  listLocalWallpapers,
  setWallpaper,
} from '../lib/wallpaper';
import { AutoThemeIcon, CheckIcon, MoonIcon, SunIcon, TrashIcon, XIcon } from './Icons';
import { InspectorSection, Segmented, StatusInline } from './layout';
import RotationControl from './RotationControl';

const THEME_MODE_OPTIONS = [
  { id: 'auto' as const, label: 'Auto', icon: <AutoThemeIcon size={16} /> },
  { id: 'light' as const, label: 'Light', icon: <SunIcon size={16} /> },
  { id: 'dark' as const, label: 'Dark', icon: <MoonIcon size={16} /> },
];

interface LibraryCardProps {
  wallpaper: Wallpaper;
  thumbSrc: string;
  isCurrent: boolean;
  isLightSlot: boolean;
  isDarkSlot: boolean;
  isConfirming: boolean;
  busy: boolean;
  onApply: (w: Wallpaper) => void;
  onRequestDelete: (path: string) => void;
  onConfirmDelete: (w: Wallpaper) => void;
  onCancelDelete: () => void;
}

// Memoized per-wallpaper card. Custom comparator ignores callback identity
// (callbacks are stable enough by inspection — see parent useCallback wrappers
// — and the meaningful props are wallpaper / thumbSrc / isCurrent / isLightSlot /
// isDarkSlot / isConfirming / busy). Without this, every status / error /
// confirmDelete toggle would re-render all 20+ cards.
const LibraryCard = memo(
  function LibraryCard({
    wallpaper: w,
    thumbSrc,
    isCurrent,
    isLightSlot,
    isDarkSlot,
    isConfirming,
    busy,
    onApply,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
  }: LibraryCardProps) {
    const hasIndicator = isCurrent || isLightSlot || isDarkSlot;
    const cardClass = [
      'card',
      isCurrent && 'current',
      isLightSlot && 'light-slot',
      isDarkSlot && 'dark-slot',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div className={cardClass}>
        <button
          type="button"
          className="card-thumb"
          onClick={() => onApply(w)}
          disabled={busy}
          aria-label={`Apply ${w.title ?? 'wallpaper'}`}
        >
          {/* thumbSrc is a 480×300 WebP if the cache has resolved, or
              the full-resolution original as a fallback until the
              backend generates one. decoding="async" lets WebKit decode
              off the main thread. */}
          <img
            src={thumbSrc}
            alt={w.title ?? ''}
            width={480}
            height={300}
            loading="lazy"
            decoding="async"
          />
          <span className="card-thumb-hint">{isCurrent ? 'Applied' : 'Apply'}</span>
        </button>
        <div className="card-actions">
          {hasIndicator && (
            <div className="card-indicators" aria-hidden="true">
              {isCurrent && (
                <span className="card-indicator" title="Currently applied">
                  <CheckIcon size={14} />
                </span>
              )}
              {isLightSlot && (
                <span className="card-indicator" title="Light-mode wallpaper">
                  <SunIcon size={14} />
                </span>
              )}
              {isDarkSlot && (
                <span className="card-indicator" title="Dark-mode wallpaper">
                  <MoonIcon size={14} />
                </span>
              )}
            </div>
          )}
          {isConfirming ? (
            <>
              {/* Destructive confirmation stays textual — icon-only
                  on a "really delete?" action invites mis-clicks. */}
              <button
                type="button"
                onClick={() => onConfirmDelete(w)}
                className="danger"
                // biome-ignore lint/a11y/noAutofocus: confirm flow benefits from immediate focus
                autoFocus
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={onCancelDelete}
                className="icon-btn"
                aria-label="Cancel"
                title="Cancel"
              >
                <XIcon />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onRequestDelete(w.path)}
              className="danger-ghost icon-btn"
              aria-label="Delete"
              title={isCurrent ? 'Currently applied — switch wallpaper first' : 'Delete'}
              disabled={isCurrent || busy}
            >
              <TrashIcon />
            </button>
          )}
        </div>
        <div className="card-meta">
          {w.source}
          {w.title ? ` · ${w.title.slice(0, 40)}` : ''}
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.wallpaper === next.wallpaper &&
    prev.thumbSrc === next.thumbSrc &&
    prev.isCurrent === next.isCurrent &&
    prev.isLightSlot === next.isLightSlot &&
    prev.isDarkSlot === next.isDarkSlot &&
    prev.isConfirming === next.isConfirming &&
    prev.busy === next.busy,
);

export default function Library() {
  const [library, setLibrary] = useState<Wallpaper[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Path of the wallpaper currently in the "are you sure?" delete state.
  // Two-step confirmation avoids the click-once-destroy-immediately UX
  // without pulling in a modal library.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // wallpaper.path → cached thumbnail path (resolved via Rust). Empty
  // until the first invoke round-trips; the card falls back to the
  // full-resolution original until the thumb URL is in here.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // Settings — drives the Auto/Light/Dark segmented control, per-card
  // light/dark slot indicators, AND the "currently applied" indicator
  // (via settings.lastApplied, owned by Rust). Stays in sync with the
  // rest of the app via the typed event bus (settings-changed).
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const currentPath = settings.lastApplied ?? null;

  useEffect(() => {
    // Two-stage load: render whatever is in the persisted library
    // immediately so the grid doesn't flash empty, then prune orphan
    // entries — rows whose underlying file no longer exists on disk.
    let cancelled = false;
    (async () => {
      const stored = await loadLibrary();
      if (cancelled) return;
      setLibrary(stored);
      try {
        const existing = new Set(await listLocalWallpapers());
        const orphanCount = stored.filter((w) => !existing.has(w.path)).length;
        if (orphanCount === 0) return;
        const cleaned = await removeLibraryOrphans([...existing]);
        if (cancelled) return;
        setLibrary(cleaned);
      } catch {
        // list_wallpapers can fail on fresh installs (no wallpapers
        // dir yet). Non-fatal — user sees the raw library.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const s = await loadSettings();
      if (cancelled) return;
      setSettings(s);
    }
    void reload();
    const unsub = listen('settings-changed', () => void reload());
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    // wallpaper-applied no longer drives state directly: applying a
    // wallpaper writes settings.lastApplied via Rust, which fires
    // settings-changed → the reload above picks it up. We still want
    // library-changed (prepend/remove/promote) so the grid refreshes
    // from other tabs without a manual reload.
    return listen('library-changed', (lib) => {
      if (lib) setLibrary(lib);
    });
  }, []);

  useEffect(() => {
    // Resolve a thumbnail path per library entry. Generation happens
    // once per file (Rust mtime-checks before re-encoding); subsequent
    // mounts are pure cache hits.
    if (library.length === 0) {
      setThumbs({});
      return;
    }
    let cancelled = false;
    for (const w of library) {
      getThumbnail(w.path)
        .then((thumbPath) => {
          if (cancelled) return;
          setThumbs((cur) =>
            cur[w.path] === thumbPath ? cur : { ...cur, [w.path]: thumbPath },
          );
        })
        .catch(() => {
          // Silent fallback — the card already shows the original.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [library]);

  // Sort the current wallpaper to the top so the user can see what's
  // applied without scrolling. Everything else stays in its original
  // (newest-first) order — only one card moves.
  const sortedLibrary = useMemo(() => {
    if (!currentPath) return library;
    const idx = library.findIndex((w) => w.path === currentPath);
    if (idx <= 0) return library;
    return [library[idx], ...library.slice(0, idx), ...library.slice(idx + 1)];
  }, [library, currentPath]);

  const applyExisting = useCallback(async (w: Wallpaper) => {
    let alreadyBusy = false;
    setBusy((b) => {
      if (b) alreadyBusy = true;
      return true;
    });
    if (alreadyBusy) return;
    setError(null);
    try {
      await setWallpaper(w.path);
      setStatus('Applied');
      setTimeout(() => setStatus(null), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const deleteEntry = useCallback(async (w: Wallpaper) => {
    let alreadyBusy = false;
    setBusy((b) => {
      if (b) alreadyBusy = true;
      return true;
    });
    if (alreadyBusy) return;
    setConfirmDelete(null);
    setError(null);
    try {
      try {
        await deleteWallpaper(w.path);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/no such file|not found|enoent/i.test(msg)) {
          throw e;
        }
      }
      const updated = await removeFromLibrary(w.path);
      setLibrary(updated);
      setStatus('Deleted');
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const onRequestDelete = useCallback((path: string) => setConfirmDelete(path), []);
  const onCancelDelete = useCallback(() => setConfirmDelete(null), []);

  // Mode switch: persist the new mode AND immediately apply the slot
  // that matches it, so the user gets visible feedback rather than
  // having to wait for a system theme flip (Auto) or fish for the
  // right wallpaper (Light/Dark). Uses patchSettings (serialized
  // read-modify-write) so a stale Sources / Generate local Settings
  // can't overwrite the new mode in their next debouncedSave.
  const onChangeThemeMode = useCallback(
    async (mode: ThemeMode) => {
      const next = await patchSettings({ themeMode: mode });
      setSettings(next);
      dispatch('settings-changed');

      let target: string | null = null;
      if (mode === 'auto') {
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        target = dark ? next.themeFollowDarkPath : next.themeFollowLightPath;
      } else if (mode === 'light') {
        target = next.themeFollowLightPath;
      } else {
        target = next.themeFollowDarkPath;
      }
      if (target && target !== currentPath) {
        try {
          await setWallpaper(target);
        } catch {
          // Apply failed (file deleted out from under us, OS refused) —
          // non-fatal, the mode is still saved.
        }
      }
    },
    [currentPath],
  );

  return (
    <div className="library">
      <div className="library-controls">
        <InspectorSection title="Shuffle">
          <RotationControl
            mode="library"
            ariaLabel="Shuffle saved wallpapers"
            otherInUseHint="Sources auto-rotate is on — this will replace it."
          />
        </InspectorSection>
      </div>
      <div className="library-controls">
        <InspectorSection title="System theme">
          <Segmented
            options={THEME_MODE_OPTIONS}
            value={settings.themeMode}
            onChange={onChangeThemeMode}
            ariaLabel="Theme mode"
          />
        </InspectorSection>
      </div>

      {(status || error) && (
        <div className="library-actions">
          <StatusInline status={status} error={error} />
        </div>
      )}

      <div className="library-grid">
        {sortedLibrary.length === 0 && (
          <div className="empty">
            Empty library. Generate one from <em>Patterns</em>, pull from a curated
            <em> Source</em>, or prompt an AI in <em>Generate</em> — anything you apply
            lands here for re-use.
          </div>
        )}
        {sortedLibrary.map((w) => (
          <LibraryCard
            key={w.path}
            wallpaper={w}
            thumbSrc={convertFileSrc(thumbs[w.path] ?? w.path)}
            isCurrent={currentPath === w.path}
            isLightSlot={settings.themeFollowLightPath === w.path}
            isDarkSlot={settings.themeFollowDarkPath === w.path}
            isConfirming={confirmDelete === w.path}
            busy={busy}
            onApply={applyExisting}
            onRequestDelete={onRequestDelete}
            onConfirmDelete={deleteEntry}
            onCancelDelete={onCancelDelete}
          />
        ))}
      </div>
    </div>
  );
}
