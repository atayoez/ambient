import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { deleteWallpaper, setWallpaper } from '../lib/wallpaper';
import { loadLibrary, saveLibrary } from '../lib/store';
import type { Wallpaper } from '../lib/types';

export default function Library() {
  const [library, setLibrary] = useState<Wallpaper[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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
          {status && <span className="status">{status}</span>}
          {error && <span className="error">{error}</span>}
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
          <div key={w.path} className="card">
            <img src={convertFileSrc(w.path)} alt={w.title ?? ''} loading="lazy" />
            <div className="card-actions">
              <button onClick={() => applyExisting(w)} disabled={busy}>
                Apply
              </button>
              <button onClick={() => removeFromLibrary(w)} className="danger">
                Delete
              </button>
            </div>
            <div className="card-meta">
              {w.source}
              {w.title ? ` · ${w.title.slice(0, 40)}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
