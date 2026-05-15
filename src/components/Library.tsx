import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { loadLibrary, saveLibrary } from '../lib/store';
import type { Wallpaper } from '../lib/types';
import { deleteWallpaper, setWallpaper } from '../lib/wallpaper';
import { StatusInline } from './layout';

export default function Library() {
  const [library, setLibrary] = useState<Wallpaper[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Path of the wallpaper currently in the "are you sure?" delete state.
  // Two-step confirmation avoids the click-once-destroy-immediately UX
  // without pulling in a modal library.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    loadLibrary().then(setLibrary);
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
    setConfirmDelete(null);
    const next = library.filter((x) => x.path !== w.path);
    setLibrary(next);
    await saveLibrary(next);
    try {
      await deleteWallpaper(w.path);
    } catch {
      // ignore: file may already be gone
    }
  }

  return (
    <div className="library">
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
          return (
            <div key={w.path} className="card">
              <button
                type="button"
                className="card-thumb"
                onClick={() => applyExisting(w)}
                disabled={busy}
                aria-label={`Apply ${w.title ?? 'wallpaper'}`}
              >
                <img src={convertFileSrc(w.path)} alt={w.title ?? ''} loading="lazy" />
                <span className="card-thumb-hint">Apply</span>
              </button>
              <div className="card-actions">
                {isConfirming ? (
                  <>
                    <button
                      onClick={() => removeFromLibrary(w)}
                      className="danger"
                      // biome-ignore lint/a11y/noAutofocus: confirm flow benefits from immediate focus
                      autoFocus
                    >
                      Confirm delete
                    </button>
                    <button onClick={() => setConfirmDelete(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => applyExisting(w)} disabled={busy}>
                      Apply
                    </button>
                    <button
                      onClick={() => setConfirmDelete(w.path)}
                      className="danger-ghost"
                      aria-label="Delete"
                    >
                      Delete
                    </button>
                  </>
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
