// Compact notification bar surfaced at the top of the content area
// when checkForUpdate() reports a newer version is available. Clicking
// "Update" tries tauri-plugin-updater's in-app downloadAndInstall
// (signature-verified, restart-after); on failure (missing signature,
// network down, install error) it silently falls back to opening the
// website download page so the user has a manual escape hatch.

import { openUrl } from '@tauri-apps/plugin-opener';
import { check } from '@tauri-apps/plugin-updater';
import { useState } from 'react';
import { dismissUpdate, type UpdateInfo } from '../lib/updater';

interface Props {
  info: UpdateInfo;
  onDismiss: () => void;
}

const DOWNLOAD_URL = 'https://ambient.oezcan.me/#download';

export default function UpdateBanner({ info, onDismiss }: Props) {
  const [busy, setBusy] = useState(false);

  async function update() {
    if (busy) return;
    setBusy(true);
    try {
      // Re-check on click to grab a fresh Update handle — the one we
      // discovered earlier in App.tsx isn't exposed through the hook,
      // and check() is cheap (manifest fetch + version compare).
      const u = await check();
      if (u?.available) {
        // Plugin verifies the minisign signature against tauri.conf
        // pubkey, downloads the platform-matching artifact, writes
        // it in place, then exits the process so the new binary
        // launches. We won't reach the line below on success.
        await u.downloadAndInstall();
        return;
      }
      // Manifest changed under us (very rare). Fall through to manual.
      void openUrl(DOWNLOAD_URL);
    } catch {
      // Common failures: latest.json missing signatures (pre-signing
      // releases), pubkey mismatch, OS denies overwrite of running
      // binary. None of these are recoverable in-app, so just open
      // the download page — the user can grab the new installer.
      void openUrl(DOWNLOAD_URL);
    } finally {
      setBusy(false);
    }
  }

  function handleDismiss() {
    dismissUpdate(info.version);
    onDismiss();
  }

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner-icon" aria-hidden="true">
        ↑
      </span>
      <span className="update-banner-message">Ambient {info.version} is available.</span>
      <button
        type="button"
        className="update-banner-link"
        onClick={update}
        disabled={busy}
      >
        {busy ? 'Updating…' : 'Update'}
      </button>
      <button
        type="button"
        className="update-banner-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
