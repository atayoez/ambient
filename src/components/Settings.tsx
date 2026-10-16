// Settings tab — consolidates what used to be scattered across tabs: API
// keys (were in Sources/Generate), auto-rotate (was a per-tab control),
// lock screen + start-on-login, About (version), and uninstall.
// One consistent row layout: a label on the left, a fixed-width control
// on the right.

import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { useSettings } from '../lib/appHooks';
import { reapplyLiveWallpaper } from '../lib/live';
import { useSecret } from '../lib/secrets';
import { patchSettings } from '../lib/store';
import { toast } from '../lib/toast';
import type { Settings as AppSettings, LiveQuality, RotationSource } from '../lib/types';
import { clearThumbnailCache, deleteLocalWallpapers } from '../lib/wallpaper';
import { OptionScroller } from '../ui';
import SpeedSlider from './SpeedSlider';

// Single-select uses the same OptionScroller as every other picker in the
// app — no native <select> island here.
const ROTATION_OPTIONS: { id: RotationSource; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'sources', label: 'Fetch from source' },
  { id: 'library', label: 'Shuffle library' },
];

// Live-wallpaper render quality. Resolution + fps caps are resolved in Rust
// (LiveQuality::resolve) and stamped into the spec the KDE plugin reads.
const LIVE_QUALITY_OPTIONS: { id: LiveQuality; label: string }[] = [
  { id: 'performance', label: 'Performance' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'high', label: 'High' },
  { id: 'native', label: 'Native' },
];

// Saved-wallpaper cache cap. Rust evicts oldest-first past the limit
// (library::enforce_cache_limit); 0 disables eviction.
const CACHE_LIMIT_OPTIONS: { id: string; label: string }[] = [
  { id: '1', label: '1 GB' },
  { id: '2', label: '2 GB' },
  { id: '5', label: '5 GB' },
  { id: '10', label: '10 GB' },
  { id: '0', label: 'Unlimited' },
];

export default function Settings() {
  // null until the Rust-owned settings load (a ~ms RAM read).
  const [settings, setSettings] = useSettings();
  const [openaiKey, setOpenaiKey, openaiLoaded] = useSecret('openai_key');
  const [pollinationsKey, setPollinationsKey, pollinationsLoaded] =
    useSecret('pollinations_key');
  const [unsplashKey, setUnsplashKey, unsplashLoaded] = useSecret('unsplash_key');
  const [pexelsKey, setPexelsKey, pexelsLoaded] = useSecret('pexels_key');
  const [wallhavenKey, setWallhavenKey, wallhavenLoaded] = useSecret('wallhaven_key');
  const [autostart, setAutostart] = useState(false);
  // Seeded from settings once they load (see the effect below).
  const [intervalDraft, setIntervalDraft] = useState('');
  const [version, setVersion] = useState('');

  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [purgeData, setPurgeData] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallErr, setUninstallErr] = useState<string | null>(null);

  const [clearingCache, setClearingCache] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    void invoke<boolean>('get_autostart')
      .then(setAutostart)
      .catch(() => {});
    void getVersion().then(setVersion);
  }, []);

  // Seed the rotation-interval draft from the loaded settings, once —
  // later settings updates must not clobber a mid-edit draft.
  const intervalSeeded = intervalDraft !== '';
  useEffect(() => {
    if (settings && !intervalSeeded) {
      setIntervalDraft(String(settings.rotationIntervalMinutes));
    }
  }, [settings, intervalSeeded]);

  // patchSettings → Rust emits `settings-changed`, which App.tsx forwards
  // onto the typed bus — other tabs refresh without a manual dispatch.
  async function patch(p: Partial<AppSettings>) {
    const next = await patchSettings(p);
    setSettings(next);
  }

  // Re-apply the active live wallpaper (if any) so a changed quality / clock
  // takes effect immediately rather than on the next apply. (The speed
  // slider handles its own debounced re-apply — see useAnimationSpeed.)
  const reapplyLive = reapplyLiveWallpaper;

  async function setLiveQuality(v: LiveQuality) {
    await patch({ liveWallpaperQuality: v });
    await reapplyLive();
  }

  async function toggleAutostart(enabled: boolean) {
    try {
      await invoke('set_autostart', { enabled });
      setAutostart(enabled);
    } catch (e) {
      // macOS (unsupported) / registry or fs failure — the toggle stays
      // where it was; tell the user why instead of failing silently.
      toast.fromError(e);
    }
  }

  function commitInterval() {
    if (!settings) return;
    const n = Number.parseInt(intervalDraft, 10);
    const clamped = Math.max(5, Number.isFinite(n) && n > 0 ? n : 60);
    setIntervalDraft(String(clamped));
    if (clamped !== settings.rotationIntervalMinutes) {
      void patch({ rotationIntervalMinutes: clamped });
    }
  }

  async function doUninstall() {
    if (uninstalling) return;
    setUninstalling(true);
    setUninstallErr(null);
    try {
      await invoke('uninstall_self', { purge: purgeData });
    } catch (e) {
      setUninstalling(false);
      setUninstallErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function clearCache() {
    if (clearingCache) return;
    setClearingCache(true);
    try {
      await clearThumbnailCache();
      toast.success('Cache cleared');
    } catch (e) {
      toast.fromError(e);
    } finally {
      setClearingCache(false);
    }
  }

  async function wipeWallpapers() {
    if (wiping) return;
    setWiping(true);
    try {
      const n = await deleteLocalWallpapers();
      toast.success(n === 1 ? 'Deleted 1 wallpaper' : `Deleted ${n} wallpapers`);
      setConfirmingWipe(false);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setWiping(false);
    }
  }

  // Settings haven't loaded yet (first frame) — all hooks are above, so
  // the early return is safe.
  if (!settings) return null;

  return (
    <div className="settings">
      <div className="settings-inner">
        <section className="set-group">
          <h3 className="set-title">API keys</h3>
          <div className="set-row">
            <span>Pollinations</span>
            <input
              type="password"
              value={pollinationsKey}
              disabled={!pollinationsLoaded}
              onChange={(e) => setPollinationsKey(e.target.value)}
              placeholder="token — optional, lifts limits"
              aria-label="Pollinations API token"
            />
          </div>
          <div className="set-row">
            <span>OpenAI</span>
            <input
              type="password"
              value={openaiKey}
              disabled={!openaiLoaded}
              onChange={(e) => setOpenaiKey(e.target.value)}
              placeholder="sk-…"
              aria-label="OpenAI API key"
            />
          </div>
          <div className="set-row">
            <span>Unsplash</span>
            <input
              type="password"
              value={unsplashKey}
              disabled={!unsplashLoaded}
              onChange={(e) => setUnsplashKey(e.target.value)}
              placeholder="access key"
              aria-label="Unsplash access key"
            />
          </div>
          <div className="set-row">
            <span>Pexels</span>
            <input
              type="password"
              value={pexelsKey}
              disabled={!pexelsLoaded}
              onChange={(e) => setPexelsKey(e.target.value)}
              placeholder="api key"
              aria-label="Pexels API key"
            />
          </div>
          <div className="set-row">
            <span>Wallhaven</span>
            <input
              type="password"
              value={wallhavenKey}
              disabled={!wallhavenLoaded}
              onChange={(e) => setWallhavenKey(e.target.value)}
              placeholder="api key — optional"
              aria-label="Wallhaven API key"
            />
          </div>
        </section>

        <section className="set-group">
          <h3 className="set-title">Auto-rotate</h3>
          <div className="set-row">
            <span>Mode</span>
            <OptionScroller
              options={ROTATION_OPTIONS}
              value={settings.rotationSource}
              onChange={(v) => void patch({ rotationSource: v })}
              ariaLabel="Auto-rotate mode"
            />
          </div>
          {settings.rotationSource !== 'off' && (
            <div className="set-row">
              <span>Every (minutes)</span>
              <input
                type="number"
                min={5}
                value={intervalDraft}
                onChange={(e) => setIntervalDraft(e.target.value)}
                onBlur={commitInterval}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitInterval();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                aria-label="Rotation interval in minutes"
              />
            </div>
          )}
        </section>

        <section className="set-group">
          <h3 className="set-title">Desktop</h3>
          <div className="set-row">
            <span>Also set the lock screen</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.lockscreen}
                onChange={(e) => void patch({ lockscreen: e.target.checked })}
                aria-label="Also set the lock screen wallpaper"
              />
              <span className="switch-track" />
            </label>
          </div>
          <div className="set-row">
            <span>Live wallpaper quality</span>
            <OptionScroller
              options={LIVE_QUALITY_OPTIONS}
              value={settings.liveWallpaperQuality}
              onChange={(v) => void setLiveQuality(v)}
              ariaLabel="Live wallpaper render quality"
            />
          </div>
          <div className="set-row set-row-slider">
            <span>Animation speed</span>
            <SpeedSlider label="Animation speed" />
          </div>
          <div className="set-row">
            <span>Wallpaper cache limit</span>
            <OptionScroller
              options={CACHE_LIMIT_OPTIONS}
              value={String(settings.cacheLimitGb)}
              onChange={(v) => void patch({ cacheLimitGb: Number(v) })}
              ariaLabel="Saved wallpaper cache limit"
            />
          </div>
          <div className="set-row">
            <span>Start on login</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={autostart}
                onChange={(e) => void toggleAutostart(e.target.checked)}
                aria-label="Start Ambient on login"
              />
              <span className="switch-track" />
            </label>
          </div>
        </section>

        <section className="set-group">
          <h3 className="set-title">About</h3>
          <div className="set-row">
            <span>Version</span>
            <span className="set-value">
              {version ? `Ambient ${version}` : 'Ambient'}
            </span>
          </div>
        </section>

        <section className="set-group set-danger">
          <h3 className="set-title">Danger zone</h3>

          <div className="set-row">
            <span>Clear thumbnail cache</span>
            <button
              type="button"
              className="set-btn"
              onClick={clearCache}
              disabled={clearingCache}
            >
              {clearingCache ? 'Clearing…' : 'Clear cache'}
            </button>
          </div>

          {confirmingWipe ? (
            <div className="set-actions">
              <button
                type="button"
                className="danger"
                onClick={wipeWallpapers}
                disabled={wiping}
              >
                {wiping ? 'Deleting…' : 'Delete all saved wallpapers'}
              </button>
              <button
                type="button"
                className="set-link"
                onClick={() => setConfirmingWipe(false)}
                disabled={wiping}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="set-row">
              <span>Delete all saved wallpapers</span>
              <button
                type="button"
                className="set-btn danger-ghost"
                onClick={() => setConfirmingWipe(true)}
              >
                Delete…
              </button>
            </div>
          )}

          {confirmingUninstall ? (
            <>
              <label className="set-check">
                <input
                  type="checkbox"
                  checked={purgeData}
                  onChange={(e) => setPurgeData(e.target.checked)}
                />
                <span>Also delete my settings &amp; saved wallpapers</span>
              </label>
              <div className="set-actions">
                <button
                  type="button"
                  className="danger"
                  onClick={doUninstall}
                  disabled={uninstalling}
                >
                  {uninstalling ? 'Removing…' : 'Confirm uninstall'}
                </button>
                <button
                  type="button"
                  className="set-link"
                  onClick={() => {
                    setConfirmingUninstall(false);
                    setUninstallErr(null);
                  }}
                  disabled={uninstalling}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="set-row">
              <span>Remove Ambient from this computer</span>
              <button
                type="button"
                className="set-btn danger-ghost"
                onClick={() => setConfirmingUninstall(true)}
              >
                Uninstall…
              </button>
            </div>
          )}
          {uninstallErr && (
            <span className="set-error" role="alert">
              {uninstallErr}
            </span>
          )}
        </section>
      </div>
    </div>
  );
}
