import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { loadLibrary, mutateLibrary } from '../lib/store';
import type { Wallpaper } from '../lib/types';
import {
  deleteWallpaper,
  LAST_APPLIED_KEY,
  listLocalWallpapers,
  setWallpaper,
} from '../lib/wallpaper';
import { TrashIcon, XIcon } from './Icons';
import { InspectorSection, StatusInline } from './layout';
import RotationControl from './RotationControl';

function readLastApplied(): string | null {
  try {
    return localStorage.getItem(LAST_APPLIED_KEY);
  } catch {
    return null;
  }
}

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

  async function applyExisting(w: Wallpaper) {
    if (busy) return;
    setBusy(true);
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
  }

  async function removeFromLibrary(w: Wallpaper) {
    if (busy) return;
    setConfirmDelete(null);
    setBusy(true);
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
  }

  return (
    <div className="library">
      <h1 className="page-title">Library</h1>
      <div className="library-controls">
        <InspectorSection title="Shuffle">
          <RotationControl
            mode="library"
            label="Shuffle saved wallpapers"
            otherInUseHint="Sources auto-rotate is on — this will replace it."
          />
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
        {library.map((w) => {
          const isConfirming = confirmDelete === w.path;
          const isCurrent = currentPath === w.path;
          return (
            <div
              key={w.path}
              className={isCurrent ? 'card current' : 'card'}
              data-current={isCurrent || undefined}
            >
              <button
                type="button"
                className="card-thumb"
                onClick={() => applyExisting(w)}
                disabled={busy}
                aria-label={`Apply ${w.title ?? 'wallpaper'}`}
              >
                <img src={convertFileSrc(w.path)} alt={w.title ?? ''} loading="lazy" />
                <span className="card-thumb-hint">{isCurrent ? 'Applied' : 'Apply'}</span>
              </button>
              <div className="card-actions">
                {isConfirming ? (
                  <>
                    {/* Destructive confirmation stays textual — icon-only
                        on a "really delete?" action invites mis-clicks. */}
                    <button
                      type="button"
                      onClick={() => removeFromLibrary(w)}
                      className="danger"
                      // biome-ignore lint/a11y/noAutofocus: confirm flow benefits from immediate focus
                      autoFocus
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="icon-btn"
                      aria-label="Cancel"
                      title="Cancel"
                    >
                      <XIcon />
                    </button>
                  </>
                ) : (
                  // Click the thumbnail to apply. The delete is disabled
                  // on the currently-applied wallpaper — removing the
                  // file the OS is rendering leaves a black desktop, so
                  // we force the user to swap to a different wallpaper
                  // before deleting this one.
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(w.path)}
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
        })}
      </div>
    </div>
  );
}
