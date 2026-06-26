// Compact notification bar surfaced at the top of the content area when
// checkForUpdate() reports a newer version.
//
// On the Linux AppImage it installs in-app: "Install & restart" downloads
// the new AppImage, replaces this one on disk, and relaunches. Everywhere
// else (macOS / Windows — bundles aren't OS-code-signed) it links to the
// download page so the user handles the single OS prompt deliberately.
// See ../lib/updater for why the split.

import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from 'react';
import {
  canSelfUpdate,
  dismissUpdate,
  type InstallProgress,
  installUpdate,
  type UpdateInfo,
} from '../lib/updater';

interface Props {
  info: UpdateInfo;
  onDismiss: () => void;
}

const DOWNLOAD_URL = 'https://ambient.oezcan.me/#download';

export default function UpdateBanner({ info, onDismiss }: Props) {
  const [selfUpdate, setSelfUpdate] = useState(false);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void canSelfUpdate().then(setSelfUpdate);
  }, []);

  function handleDismiss() {
    dismissUpdate(info.version);
    onDismiss();
  }

  async function handleInstall() {
    if (progress) return; // already running
    setFailed(false);
    setProgress({ phase: 'downloading', downloaded: 0, total: null });
    try {
      await installUpdate(setProgress);
      // installUpdate relaunches on success, so we never get here.
    } catch {
      // Install failed (network, signature, …) — fall back to the page.
      setProgress(null);
      setFailed(true);
    }
  }

  const installing = progress !== null;
  const label = (() => {
    if (!progress) return failed ? 'Open download page' : 'Install & restart';
    if (progress.phase === 'downloading') {
      if (progress.total) {
        const pct = Math.round((progress.downloaded / progress.total) * 100);
        return `Downloading… ${pct}%`;
      }
      return 'Downloading…';
    }
    if (progress.phase === 'installing') return 'Installing…';
    return 'Restarting…';
  })();

  // After a failed in-app install, the action button opens the page.
  const onAction =
    selfUpdate && !failed ? handleInstall : () => void openUrl(DOWNLOAD_URL);
  const actionLabel =
    selfUpdate && !failed ? label : failed ? 'Open download page' : 'Download';

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner-icon" aria-hidden="true">
        ↑
      </span>
      <span className="update-banner-message">
        {failed
          ? `Couldn't install ${info.version} — open the download page.`
          : `Ambient ${info.version} is available.`}
      </span>
      <button
        type="button"
        className="update-banner-link"
        onClick={() => void onAction()}
        disabled={installing}
      >
        {actionLabel}
      </button>
      <button
        type="button"
        className="update-banner-dismiss"
        onClick={handleDismiss}
        disabled={installing}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
