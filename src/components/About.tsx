// About panel — app identity (icon, name, version, description) plus a
// user-triggered "Check for updates" affordance. Rendered as a modal
// overlay from the titlebar info button. Closes on Escape, on the close
// button, or on a click outside the card.
//
// The update flow mirrors UpdateBanner's: a manual check reports
// up-to-date / available / error, and when one is available the install
// button tries the signature-verified in-app download, falling back to
// the website if that path fails (unsigned manifest, locked binary, …).

import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { check } from '@tauri-apps/plugin-updater';
import { useEffect, useState } from 'react';
import { checkForUpdateManual } from '../lib/updater';
import { RefreshIcon, XIcon } from './Icons';

const HOMEPAGE = 'https://ambient.oezcan.me';
const DOWNLOAD_URL = 'https://ambient.oezcan.me/#download';

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'available'; version: string }
  | { kind: 'installing' }
  | { kind: 'error' };

export default function About({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' });
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [purgeData, setPurgeData] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallErr, setUninstallErr] = useState<string | null>(null);

  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function checkUpdates() {
    if (update.kind === 'checking' || update.kind === 'installing') return;
    setUpdate({ kind: 'checking' });
    const r = await checkForUpdateManual();
    if (r.status === 'available') setUpdate({ kind: 'available', version: r.version });
    else if (r.status === 'uptodate') setUpdate({ kind: 'uptodate' });
    else setUpdate({ kind: 'error' });
  }

  async function doUninstall() {
    if (uninstalling) return;
    setUninstalling(true);
    setUninstallErr(null);
    try {
      // On success the app removes its launcher entry/binary and exits,
      // so this invoke won't return.
      await invoke('uninstall_self', { purge: purgeData });
    } catch (e) {
      setUninstalling(false);
      setUninstallErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function install() {
    if (update.kind === 'installing') return;
    setUpdate({ kind: 'installing' });
    try {
      const u = await check();
      if (u?.available) {
        // Verifies the minisign signature, downloads the matching
        // artifact, and exits to relaunch — we won't return on success.
        await u.downloadAndInstall();
        return;
      }
      void openUrl(DOWNLOAD_URL);
    } catch {
      void openUrl(DOWNLOAD_URL);
    }
  }

  return (
    <div
      className="about-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="About Ambient"
      onMouseDown={onClose}
    >
      {/* stopPropagation so clicks inside the card don't dismiss it */}
      <div className="about-card" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="about-close"
          onClick={onClose}
          aria-label="Close"
        >
          <XIcon size={14} />
        </button>

        <img className="about-icon" src="/icon.svg" alt="" width={72} height={72} />
        <h2 className="about-name">Ambient</h2>
        <p className="about-version">{version ? `Version ${version}` : ' '}</p>
        <p className="about-desc">
          A wallpaper studio — dynamic patterns, emoji, curated sources, and AI
          generation, rendered natively at your screen's exact resolution.
        </p>

        <div className="about-update">
          <button
            type="button"
            className="about-update-btn"
            onClick={update.kind === 'available' ? install : checkUpdates}
            disabled={update.kind === 'checking' || update.kind === 'installing'}
          >
            {update.kind === 'available' ? (
              <span>Install {update.version}</span>
            ) : (
              <>
                <RefreshIcon size={13} />
                <span>
                  {update.kind === 'checking'
                    ? 'Checking…'
                    : update.kind === 'installing'
                      ? 'Updating…'
                      : 'Check for updates'}
                </span>
              </>
            )}
          </button>
          <span className="about-update-status" role="status" aria-live="polite">
            {update.kind === 'uptodate' && "You're up to date."}
            {update.kind === 'available' && 'A new version is available.'}
            {update.kind === 'error' && 'Check failed — try again later.'}
          </span>
        </div>

        <div className="about-uninstall">
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
        </div>

        <div className="about-footer">
          <button
            type="button"
            className="about-link"
            onClick={() => void openUrl(HOMEPAGE)}
          >
            ambient.oezcan.me
          </button>
          <span className="about-legal">© 2026 Atay Özcan</span>
        </div>
      </div>
    </div>
  );
}
