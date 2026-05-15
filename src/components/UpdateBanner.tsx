// Compact notification bar surfaced at the top of the content area
// when checkForUpdate() reports a newer version is available. Users
// can dismiss for this version (saved to localStorage), or click
// "Download" to open the website's downloads section.
import { openUrl } from '@tauri-apps/plugin-opener';
import { dismissUpdate, type UpdateInfo } from '../lib/updater';

interface Props {
  info: UpdateInfo;
  onDismiss: () => void;
}

const DOWNLOAD_URL = 'https://ambient.oezcan.me/#download';

export default function UpdateBanner({ info, onDismiss }: Props) {
  function download() {
    void openUrl(DOWNLOAD_URL);
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
      <button type="button" className="update-banner-link" onClick={download}>
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
