// Full-tab license activation modal. Shown when the app starts without
// a stored license, or when revalidation returns explicit revocation.
// Buy-flow and tab-switching are unavailable until activation succeeds —
// titlebar window controls remain interactive so the user can close
// or minimise the window normally.
import { useState } from 'react';
import { activateLicense, type LicenseInfo } from '../lib/license';

interface Props {
  /** Pre-filled banner if we're showing the gate because a previously
   *  activated license was revoked. */
  revokedMessage?: string;
  onActivated: (info: LicenseInfo) => void;
}

export default function LicenseGate({ revokedMessage, onActivated }: Props) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const info = await activateLicense(key);
      onActivated(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="license-gate">
      <div className="license-card">
        <div className="license-card-aurora" aria-hidden="true" />

        <img className="license-icon" src="/icon.svg" alt="" />
        <h1 className="license-title">Welcome to Ambient</h1>
        <p className="license-sub">Enter your license key to activate this machine.</p>

        {revokedMessage && <div className="license-banner">{revokedMessage}</div>}

        <form className="license-form" onSubmit={submit}>
          <input
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
            autoComplete="off"
            spellCheck={false}
            // biome-ignore lint/a11y/noAutofocus: this input is the only interactive element on the gate; focusing it is the intended UX
            autoFocus
            disabled={busy}
            aria-label="License key"
          />
          <button type="submit" className="primary" disabled={busy || !key.trim()}>
            {busy ? 'Activating…' : 'Activate'}
          </button>
        </form>

        {error && <p className="license-error">{error}</p>}

        <p className="license-footer">
          Don't have a key yet?{' '}
          <a href="https://ambient.oezcan.me" target="_blank" rel="noopener noreferrer">
            Buy a license for $15
          </a>{' '}
          — delivered instantly by email.
        </p>
      </div>
    </div>
  );
}
