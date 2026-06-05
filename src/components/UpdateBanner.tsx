// Compact notification bar surfaced at the top of the content area when
// checkForUpdate() reports a newer version. It links to the website
// download page rather than installing in-app: builds aren't code-signed,
// Linux installs are native packages that update via the package manager,
// and "open the download page" is the one path that works everywhere.

import { openUrl } from '@tauri-apps/plugin-opener';
import { dismissUpdate, type UpdateInfo } from '../lib/updater';

interface Props {
  info: UpdateInfo;
  onDismiss: () => void;
}

const DOWNLOAD_URL = 'https://ambient.oezcan.me/#download';

export default function UpdateBanner({ info, onDismiss }: Props) {
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
        onClick={() => void openUrl(DOWNLOAD_URL)}
      >
        Download
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
