// Settings tab — consolidates what used to be scattered across tabs: API
// keys (were in Sources/Generate), auto-rotate (was a per-tab control),
// lock screen + start-on-login, About (version/update), and uninstall.
// One consistent row layout: a label on the left, a fixed-width control
// on the right.

import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from 'react';
import { dispatch } from '../lib/events';
import { useSecret } from '../lib/secrets';
import { loadSettings, patchSettings } from '../lib/store';
import { toast } from '../lib/toast';
import {
  type Settings as AppSettings,
  DEFAULT_SETTINGS,
  type RotationSource,
} from '../lib/types';
import { checkForUpdateManual } from '../lib/updater';
import { clearThumbnailCache, deleteLocalWallpapers } from '../lib/wallpaper';
import { OptionScroller } from '../ui';
import { RefreshIcon } from './Icons';

const HOMEPAGE = 'https://ambient.oezcan.me';
const DOWNLOAD_URL = 'https://ambient.oezcan.me/#download';

// Single-select uses the same OptionScroller as every other picker in the
// app — no native <select> island here.
const ROTATION_OPTIONS: { id: RotationSource; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'sources', label: 'Fetch from source' },
  { id: 'library', label: 'Shuffle library' },
];

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'available'; version: string }
  | { kind: 'error' };

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [openaiKey, setOpenaiKey, openaiLoaded] = useSecret('openai_key');
  const [unsplashKey, setUnsplashKey, unsplashLoaded] = useSecret('unsplash_key');
  const [pexelsKey, setPexelsKey, pexelsLoaded] = useSecret('pexels_key');
  const [autostart, setAutostart] = useState(false);
  const [intervalDraft, setIntervalDraft] = useState(
    String(DEFAULT_SETTINGS.rotationIntervalMinutes),
  );
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' });

  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [purgeData, setPurgeData] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallErr, setUninstallErr] = useState<string | null>(null);

  const [clearingCache, setClearingCache] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiping, setWiping] = useState(false);

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setIntervalDraft(String(s.rotationIntervalMinutes));
    });
    void invoke<boolean>('get_autostart')
      .then(setAutostart)
      .catch(() => {});
    void getVersion().then(setVersion);
  }, []);

  async function patch(p: Partial<AppSettings>) {
    const next = await patchSettings(p);
    setSettings(next);
    dispatch('settings-changed');
  }

  async function toggleAutostart(enabled: boolean) {
    try {
      await invoke('set_autostart', { enabled });
      setAutostart(enabled);
    } catch {
      // Non-Linux / no $HOME — leave the toggle where it was.
    }
  }

  function commitInterval() {
    const n = Number.parseInt(intervalDraft, 10);
    const clamped = Math.max(5, Number.isFinite(n) && n > 0 ? n : 60);
    setIntervalDraft(String(clamped));
    if (clamped !== settings.rotationIntervalMinutes) {
      void patch({ rotationIntervalMinutes: clamped });
    }
  }

  async function checkUpdates() {
    if (update.kind === 'checking') return;
    setUpdate({ kind: 'checking' });
    const r = await checkForUpdateManual();
    if (r.status === 'available') setUpdate({ kind: 'available', version: r.version });
    else if (r.status === 'uptodate') setUpdate({ kind: 'uptodate' });
    else setUpdate({ kind: 'error' });
  }

  // We don't install in-app — open the download page so the user grabs
  // the new build / native package themselves (see UpdateBanner for why).
  function openDownload() {
    void openUrl(DOWNLOAD_URL);
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

  return (
    <div className="settings">
      <div className="settings-inner">
        <section className="set-group">
          <h3 className="set-title">API keys</h3>
          <p className="set-note">
            Stored in your OS keyring. Sources and AI generation read them from here.
          </p>
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
            <input
              type="checkbox"
              className="switch"
              checked={settings.lockscreen}
              onChange={(e) => void patch({ lockscreen: e.target.checked })}
              aria-label="Also set the lock screen wallpaper"
            />
          </div>
          <div className="set-row">
            <span>Start on login</span>
            <input
              type="checkbox"
              className="switch"
              checked={autostart}
              onChange={(e) => void toggleAutostart(e.target.checked)}
              aria-label="Start Ambient on login"
            />
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
          <div className="set-row">
            <span>Updates</span>
            <button
              type="button"
              className="set-btn"
              onClick={update.kind === 'available' ? openDownload : checkUpdates}
              disabled={update.kind === 'checking'}
            >
              {update.kind === 'available' ? (
                <span>Download {update.version}</span>
              ) : (
                <>
                  <RefreshIcon size={13} />
                  <span>
                    {update.kind === 'checking'
                      ? 'Checking…'
                      : update.kind === 'uptodate'
                        ? 'Up to date'
                        : update.kind === 'error'
                          ? 'Try again'
                          : 'Check for updates'}
                  </span>
                </>
              )}
            </button>
          </div>
          <div className="set-row">
            <span>Website</span>
            <button
              type="button"
              className="set-link"
              onClick={() => void openUrl(HOMEPAGE)}
            >
              ambient.oezcan.me
            </button>
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
