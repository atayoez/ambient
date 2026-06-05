// Settings tab — consolidates everything that used to be scattered across
// the other tabs: API keys (were in Sources/Generate), auto-rotate (was in
// Sources + Library), lock screen (was in Library), plus start-on-login and
// uninstall. Keys persist in the OS keyring via useSecret; the rest are
// Settings fields written through patchSettings, and autostart/uninstall are
// Rust commands.

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { dispatch } from '../lib/events';
import { useSecret } from '../lib/secrets';
import { loadSettings, patchSettings } from '../lib/store';
import {
  type Settings as AppSettings,
  DEFAULT_SETTINGS,
  type RotationSource,
} from '../lib/types';
import OptionScroller from './OptionScroller';

const ROTATION_OPTIONS: { id: RotationSource; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'sources', label: 'Fetch from source' },
  { id: 'library', label: 'Shuffle library' },
];

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [openaiKey, setOpenaiKey, openaiLoaded] = useSecret('openai_key');
  const [unsplashKey, setUnsplashKey, unsplashLoaded] = useSecret('unsplash_key');
  const [pexelsKey, setPexelsKey, pexelsLoaded] = useSecret('pexels_key');
  const [autostart, setAutostart] = useState(false);
  const [intervalDraft, setIntervalDraft] = useState(
    String(DEFAULT_SETTINGS.rotationIntervalMinutes),
  );

  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [purgeData, setPurgeData] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallErr, setUninstallErr] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setIntervalDraft(String(s.rotationIntervalMinutes));
    });
    void invoke<boolean>('get_autostart')
      .then(setAutostart)
      .catch(() => {});
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

  return (
    <div className="settings">
      <div className="settings-scroll">
        <div className="settings-panel">
          <section className="settings-group">
            <h3 className="settings-title">API keys</h3>
            <p className="settings-hint">
              Stored in your OS keyring, never in plain text. Sources and AI generation
              read them from here.
            </p>
            <label className="field">
              <span>OpenAI (DALL·E 3)</span>
              <input
                type="password"
                value={openaiKey}
                disabled={!openaiLoaded}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-…"
                aria-label="OpenAI API key"
              />
            </label>
            <label className="field">
              <span>Unsplash</span>
              <input
                type="password"
                value={unsplashKey}
                disabled={!unsplashLoaded}
                onChange={(e) => setUnsplashKey(e.target.value)}
                placeholder="access key"
                aria-label="Unsplash access key"
              />
            </label>
            <label className="field">
              <span>Pexels</span>
              <input
                type="password"
                value={pexelsKey}
                disabled={!pexelsLoaded}
                onChange={(e) => setPexelsKey(e.target.value)}
                placeholder="api key"
                aria-label="Pexels API key"
              />
            </label>
          </section>

          <section className="settings-group">
            <h3 className="settings-title">Auto-rotate</h3>
            <OptionScroller
              label="Mode"
              options={ROTATION_OPTIONS}
              value={settings.rotationSource}
              onChange={(v) => void patch({ rotationSource: v })}
              ariaLabel="Auto-rotate mode"
            />
            {settings.rotationSource !== 'off' && (
              <label className="field">
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
              </label>
            )}
          </section>

          <section className="settings-group">
            <h3 className="settings-title">Desktop</h3>
            <label className="field settings-toggle">
              <span>Also set the lock screen</span>
              <input
                type="checkbox"
                checked={settings.lockscreen}
                onChange={(e) => void patch({ lockscreen: e.target.checked })}
                aria-label="Also set the lock screen wallpaper"
              />
            </label>
            <label className="field settings-toggle">
              <span>Start on login</span>
              <input
                type="checkbox"
                checked={autostart}
                onChange={(e) => void toggleAutostart(e.target.checked)}
                aria-label="Start Ambient on login"
              />
            </label>
          </section>

          <section className="settings-group">
            <h3 className="settings-title">Uninstall</h3>
            {confirmingUninstall ? (
              <>
                <label className="about-uninstall-purge">
                  <input
                    type="checkbox"
                    checked={purgeData}
                    onChange={(e) => setPurgeData(e.target.checked)}
                  />
                  <span>Also delete my settings &amp; saved wallpapers</span>
                </label>
                <div className="about-uninstall-actions">
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
                    className="about-link"
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
              <button
                type="button"
                className="about-uninstall-btn"
                onClick={() => setConfirmingUninstall(true)}
              >
                Uninstall Ambient…
              </button>
            )}
            {uninstallErr && (
              <span className="about-uninstall-err" role="alert">
                {uninstallErr}
              </span>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
