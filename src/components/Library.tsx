import { convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dispatch, listen } from '../lib/events';
import {
  loadLibrary,
  loadSettings,
  patchSettings,
  removeFromLibrary,
  removeLibraryOrphans,
  setWallpaperMode,
} from '../lib/store';
import type { ThemeMode } from '../lib/theme';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type Wallpaper,
  type WallpaperMode,
} from '../lib/types';
import { deleteWallpaper, listLocalWallpapers, setWallpaper } from '../lib/wallpaper';
import { CheckIcon, MoonIcon, SunIcon, TrashIcon, XIcon } from './Icons';
import { StatusInline } from './layout';
import OptionScroller from './OptionScroller';
import RotationControl from './RotationControl';

// Whether a wallpaper's tag makes it eligible for the given theme.
function modeMatches(mode: WallpaperMode | undefined, dark: boolean): boolean {
  const m = mode ?? 'both';
  return m === 'both' || (dark ? m === 'dark' : m === 'light');
}

const THEME_MODE_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export default function Library() {
  const [library, setLibrary] = useState<Wallpaper[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const currentPath = settings.lastApplied ?? null;
  // Which wallpaper the carousel is showing. Null until the library loads;
  // defaults to the applied one so you land on what's live.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
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
        // list_wallpapers can fail on fresh installs — non-fatal.
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
    return listen('library-changed', (lib) => {
      if (lib) setLibrary(lib);
    });
  }, []);

  // Applied wallpaper first, rest newest-first — same ordering the grid
  // used, so the carousel opens on what's live.
  const sortedLibrary = useMemo(() => {
    if (!currentPath) return library;
    const idx = library.findIndex((w) => w.path === currentPath);
    if (idx <= 0) return library;
    return [library[idx], ...library.slice(0, idx), ...library.slice(idx + 1)];
  }, [library, currentPath]);

  // Keep the selection valid: default to the applied wallpaper (or the
  // first), and recover if the selected one was deleted.
  useEffect(() => {
    if (sortedLibrary.length === 0) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath((cur) => {
      if (cur && sortedLibrary.some((w) => w.path === cur)) return cur;
      return currentPath ?? sortedLibrary[0].path;
    });
  }, [sortedLibrary, currentPath]);

  const selected = sortedLibrary.find((w) => w.path === selectedPath) ?? null;
  const selectedIsCurrent = !!selected && selected.path === currentPath;
  const selectedMode: WallpaperMode = selected?.mode ?? 'both';
  const selectedIsLight = selectedMode === 'light';
  const selectedIsDark = selectedMode === 'dark';

  // Tag the selected wallpaper's light/dark eligibility. Tapping the
  // active mode again clears it back to 'both'. Light and dark are
  // mutually exclusive.
  const tagMode = useCallback(
    async (mode: WallpaperMode) => {
      if (!selected) return;
      const next = selectedMode === mode ? 'both' : mode;
      try {
        const updated = await setWallpaperMode(selected.path, next);
        setLibrary(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [selected, selectedMode],
  );

  const applyExisting = useCallback(async (path: string) => {
    let alreadyBusy = false;
    setBusy((b) => {
      if (b) alreadyBusy = true;
      return true;
    });
    if (alreadyBusy) return;
    setError(null);
    try {
      await setWallpaper(path);
      setStatus('Applied');
      setTimeout(() => setStatus(null), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const deleteEntry = useCallback(async (path: string) => {
    let alreadyBusy = false;
    setBusy((b) => {
      if (b) alreadyBusy = true;
      return true;
    });
    if (alreadyBusy) return;
    setConfirmingDelete(false);
    setError(null);
    try {
      try {
        await deleteWallpaper(path);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/no such file|not found|enoent/i.test(msg)) throw e;
      }
      const updated = await removeFromLibrary(path);
      setLibrary(updated);
      setStatus('Deleted');
      setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  // Mode switch: persist, then — if the current wallpaper doesn't fit
  // the chosen theme's pool — apply one that does (the selected wallpaper
  // when eligible, else the first in the pool), for instant feedback.
  const onChangeThemeMode = useCallback(
    async (mode: ThemeMode) => {
      const next = await patchSettings({ themeMode: mode });
      setSettings(next);
      dispatch('settings-changed');

      const dark =
        mode === 'dark' ||
        (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const current = library.find((w) => w.path === currentPath);
      if (current && modeMatches(current.mode, dark)) return; // already fits

      const pool = library.filter((w) => modeMatches(w.mode, dark));
      const target = pool.find((w) => w.path === selectedPath) ?? pool[0] ?? null;
      if (target && target.path !== currentPath) {
        try {
          await setWallpaper(target.path);
        } catch {
          // non-fatal — the mode is still saved.
        }
      }
    },
    [library, currentPath, selectedPath],
  );

  // Reset the delete confirmation whenever the selection changes.
  useEffect(() => setConfirmingDelete(false), [selectedPath]);

  return (
    <div className="library">
      <div className="gen-stage">
        {selected ? (
          <img
            className="gen-bg"
            src={convertFileSrc(selected.path)}
            alt={selected.title ?? ''}
          />
        ) : (
          <div className="gen-bg gen-bg-empty" aria-hidden="true" />
        )}

        {sortedLibrary.length === 0 ? (
          <p className="gen-empty-hint">
            Empty library. Apply anything from Patterns, Sources, or Generate and it lands
            here for re-use.
          </p>
        ) : (
          <div className="gen-panel pat-top">
            <OptionScroller
              label={`Wallpaper ${
                Math.max(
                  0,
                  sortedLibrary.findIndex((w) => w.path === selectedPath),
                ) + 1
              } / ${sortedLibrary.length}`}
              options={sortedLibrary.map((w) => ({
                id: w.path,
                label: `${w.source}${w.title ? ` · ${w.title.slice(0, 32)}` : ''}`,
              }))}
              value={selectedPath ?? ''}
              onChange={setSelectedPath}
              ariaLabel="Browse library"
            />
            {selectedIsCurrent && (
              <div className="lib-badges" aria-hidden="true">
                <span className="lib-badge" title="Currently applied">
                  <CheckIcon size={13} />
                </span>
              </div>
            )}
          </div>
        )}

        <div className="gen-panel pat-side">
          <OptionScroller
            label="System theme"
            options={THEME_MODE_OPTIONS}
            value={settings.themeMode}
            onChange={onChangeThemeMode}
            ariaLabel="Theme mode"
          />
          <div className="field">
            <span>Shuffle</span>
            <RotationControl
              mode="library"
              ariaLabel="Shuffle saved wallpapers"
              otherInUseHint="Sources auto-rotate is on — this will replace it."
            />
          </div>
          <label className="field lib-lockscreen">
            <span>Lock screen</span>
            <input
              type="checkbox"
              checked={settings.lockscreen}
              onChange={async (e) => {
                const next = await patchSettings({ lockscreen: e.target.checked });
                setSettings(next);
                dispatch('settings-changed');
              }}
              aria-label="Also set the lock screen wallpaper"
            />
          </label>
        </div>

        {selected && (
          <div className="pat-actions">
            <StatusInline status={status} error={error} />
            <button
              type="button"
              onClick={() => tagMode('light')}
              className={selectedIsLight ? 'icon-btn primary' : 'icon-btn'}
              aria-pressed={selectedIsLight}
              aria-label="Show in Light mode only"
              title={
                selectedIsLight
                  ? 'Light-mode only — tap to clear'
                  : 'Show this only in Light mode'
              }
              disabled={busy}
            >
              <SunIcon />
            </button>
            <button
              type="button"
              onClick={() => tagMode('dark')}
              className={selectedIsDark ? 'icon-btn primary' : 'icon-btn'}
              aria-pressed={selectedIsDark}
              aria-label="Show in Dark mode only"
              title={
                selectedIsDark
                  ? 'Dark-mode only — tap to clear'
                  : 'Show this only in Dark mode'
              }
              disabled={busy}
            >
              <MoonIcon />
            </button>
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  onClick={() => deleteEntry(selected.path)}
                  className="danger"
                  // biome-ignore lint/a11y/noAutofocus: confirm flow benefits from immediate focus
                  autoFocus
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
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
                onClick={() => setConfirmingDelete(true)}
                className="danger-ghost icon-btn"
                aria-label="Delete"
                title={
                  selectedIsCurrent
                    ? 'Currently applied — switch wallpaper first'
                    : 'Delete'
                }
                disabled={selectedIsCurrent || busy}
              >
                <TrashIcon />
              </button>
            )}
            <button
              type="button"
              onClick={() => applyExisting(selected.path)}
              disabled={busy || selectedIsCurrent}
              className="primary icon-btn"
              aria-label="Apply as wallpaper"
              title={selectedIsCurrent ? 'Already applied' : 'Apply as wallpaper'}
            >
              <CheckIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
