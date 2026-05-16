import { convertFileSrc } from '@tauri-apps/api/core';
import { memo, useCallback, useEffect, useState } from 'react';
import { loadLibrary, mutateLibrary } from '../lib/store';
import type { Wallpaper } from '../lib/types';
import {
  deleteWallpaper,
  getThumbnail,
  LAST_APPLIED_KEY,
  listLocalWallpapers,
  setWallpaper,
} from '../lib/wallpaper';
import { TrashIcon, XIcon } from './Icons';
import { InspectorSection, StatusInline } from './layout';
import RotationControl from './RotationControl';
import ThemeFollowControl from './ThemeFollowControl';

function readLastApplied(): string | null {
  try {
    return localStorage.getItem(LAST_APPLIED_KEY);
  } catch {
    return null;
  }
}

interface LibraryCardProps {
  wallpaper: Wallpaper;
  thumbSrc: string;
  isCurrent: boolean;
  isConfirming: boolean;
  busy: boolean;
  onApply: (w: Wallpaper) => void;
  onRequestDelete: (path: string) => void;
  onConfirmDelete: (w: Wallpaper) => void;
  onCancelDelete: () => void;
}

// Memoized per-wallpaper card. Custom comparator ignores callback identity
// (callbacks are stable enough by inspection — see parent useCallback wrappers
// — and the meaningful props are wallpaper / thumbSrc / isCurrent /
// isConfirming / busy). Without this, every status / error / confirmDelete
// toggle would re-render all 20+ cards.
const LibraryCard = memo(
  function LibraryCard({
    wallpaper: w,
    thumbSrc,
    isCurrent,
    isConfirming,
    busy,
    onApply,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
  }: LibraryCardProps) {
    return (
      <div className={isCurrent ? 'card current' : 'card'}>
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
              title={
                isCurrent ? 'Currently applied — switch wallpaper first' : 'Delete'
              }
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
  // Path of the desktop wallpaper that's currently applied. Refreshed
  // on mount, on rotation events, and whenever the user applies a
  // wallpaper from this tab. Used to disable the delete button on the
  // active card — deleting the file the OS is showing leaves a black
  // desktop, so we block it and let the user pick a different
  // wallpaper first.
  const [currentPath, setCurrentPath] = useState<string | null>(readLastApplied);
  // wallpaper.path → cached thumbnail path (resolved via Rust). Empty
  // until the first invoke round-trips; the card falls back to the
  // full-resolution original until the thumb URL is in here. 480×300
  // WebP thumbs cap WebKit's image cache footprint dramatically vs the
  // 2880×1800 originals.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    // Two-stage load: render whatever is in the persisted library
    // immediately so the grid doesn't flash empty, then prune orphan
    // entries — rows whose underlying file no longer exists on disk.
    // Without the prune those stick around as broken thumbs forever
    // (common after a data-dir wipe, reinstall, or external manual
    // delete).
    let cancelled = false;
    (async () => {
      const stored = await loadLibrary();
      if (cancelled) return;
      setLibrary(stored);
      try {
        const existing = new Set(await listLocalWallpapers());
        const orphanCount = stored.filter((w) => !existing.has(w.path)).length;
        if (orphanCount === 0) return;
        const cleaned = await mutateLibrary((cur) =>
          cur.filter((w) => existing.has(w.path)),
        );
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
    // Keep currentPath in sync with any apply / rotation happening
    // anywhere in the app. setWallpaper() dispatches this event with
    // the new path; rotation timer + tray + Library applyExisting all
    // route through setWallpaper, so this is a single funnel.
    function onApplied(e: Event) {
      const path = (e as CustomEvent<string>).detail;
      if (path) setCurrentPath(path);
    }
    window.addEventListener('ambient-wallpaper-applied', onApplied);
    return () => window.removeEventListener('ambient-wallpaper-applied', onApplied);
  }, []);

  useEffect(() => {
    // Resolve a thumbnail path per library entry. Generation happens
    // once per file (Rust mtime-checks before re-encoding); subsequent
    // mounts are pure cache hits. Errors fall through to the original
    // file path so the card still shows something. Cards render as
    // soon as their thumb resolves — no batch wait.
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

  const applyExisting = useCallback(async (w: Wallpaper) => {
    // Functional setBusy lets the callback be stable while still bailing
    // out on a re-entrant click — without this useCallback would have to
    // depend on `busy`, the closure would re-bind every render, and the
    // memoized LibraryCard's callback identity would be useless anyway.
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

  const removeFromLibrary = useCallback(async (w: Wallpaper) => {
    let alreadyBusy = false;
    setBusy((b) => {
      if (b) alreadyBusy = true;
      return true;
    });
    if (alreadyBusy) return;
    setConfirmDelete(null);
    setError(null);
    try {
      // Delete the file BEFORE the library mutation. If the OS refuses
      // (permission, file in use), we bail without touching the JSON, so
      // the entry stays and the user can retry. Previously a swallowed
      // catch on the file-delete left orphan files on disk while the
      // library JSON had already forgotten about them.
      try {
        await deleteWallpaper(w.path);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // ENOENT (file already gone) is fine — proceed with library
        // cleanup. Other errors (permission, etc.) bubble up.
        if (!/no such file|not found|enoent/i.test(msg)) {
          throw e;
        }
      }
      const updated = await mutateLibrary((cur) => cur.filter((x) => x.path !== w.path));
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

  return (
    <div className="library">
      <div className="library-controls">
        <InspectorSection title="Shuffle">
          <RotationControl
            mode="library"
            label="Shuffle saved wallpapers"
            otherInUseHint="Sources auto-rotate is on — this will replace it."
          />
        </InspectorSection>
      </div>
      <div className="library-controls">
        <InspectorSection title="System theme">
          <ThemeFollowControl />
        </InspectorSection>
      </div>

      {(status || error) && (
        <div className="library-actions">
          <StatusInline status={status} error={error} />
        </div>
      )}

      <div className="library-grid">
        {library.length === 0 && (
          <div className="empty">
            Empty library. Generate one from <em>Patterns</em>, pull from a curated
            <em> Source</em>, or prompt an AI in <em>Generate</em> — anything you apply
            lands here for re-use.
          </div>
        )}
        {library.map((w) => (
          <LibraryCard
            key={w.path}
            wallpaper={w}
            thumbSrc={convertFileSrc(thumbs[w.path] ?? w.path)}
            isCurrent={currentPath === w.path}
            isConfirming={confirmDelete === w.path}
            busy={busy}
            onApply={applyExisting}
            onRequestDelete={onRequestDelete}
            onConfirmDelete={removeFromLibrary}
            onCancelDelete={onCancelDelete}
          />
        ))}
      </div>
    </div>
  );
}
