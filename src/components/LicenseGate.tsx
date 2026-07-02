// Full-tab sign-in modal. Shown when the app starts without a stored
// license, or when revalidation returns explicit revocation.
// Buy-flow and tab-switching are unavailable until sign-in succeeds —
// titlebar window controls remain interactive so the user can close
// or minimise the window normally.
//
// Email-only flow: enter the purchase email → Polar mails a one-time
// code → entering it fetches + activates the license key behind the
// scenes. No key is ever shown or pasted.
import { useState } from 'react';
import { type LicenseInfo, loginWithCode, requestLoginCode } from '../lib/license';

interface Props {
  /** Pre-filled banner if we're showing the gate because a previously
   *  activated license was revoked. */
  revokedMessage?: string;
  onActivated: (info: LicenseInfo) => void;
}

function errorText(err: unknown, fallback: string): string {
  // Tauri commands returning Result<_, String> reject with a plain
  // string — surface it instead of swallowing the actual reason.
  return typeof err === 'string' ? err : err instanceof Error ? err.message : fallback;
}

export default function LicenseGate({ revokedMessage, onActivated }: Props) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await requestLoginCode(email);
      setCodeSent(true);
    } catch (err) {
      setError(errorText(err, 'Could not send the code'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const info = await loginWithCode(code);
      onActivated(info);
    } catch (err) {
      setError(errorText(err, 'Sign-in failed'));
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
        <p className="license-sub">
          {codeSent
            ? `If ${email.trim()} has an Ambient license, a sign-in code is on its way. Enter it below.`
            : 'Sign in with the email you used to buy Ambient.'}
        </p>

        {revokedMessage && <div className="license-banner">{revokedMessage}</div>}

        {codeSent ? (
          <form className="license-form" onSubmit={verifyCode}>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code from the email"
              autoComplete="one-time-code"
              spellCheck={false}
              // biome-ignore lint/a11y/noAutofocus: the code field is the next required action on the gate; focusing it is the intended UX
              autoFocus
              disabled={busy}
              aria-label="One-time code"
            />
            <button type="submit" className="primary" disabled={busy || !code.trim()}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setCodeSent(false);
                setCode('');
                setError(null);
              }}
            >
              Go back
            </button>
          </form>
        ) : (
          <form className="license-form" onSubmit={sendCode}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              spellCheck={false}
              // biome-ignore lint/a11y/noAutofocus: this input is the only interactive element on the gate; focusing it is the intended UX
              autoFocus
              disabled={busy}
              aria-label="Email address"
            />
            <button type="submit" className="primary" disabled={busy || !email.trim()}>
              {busy ? 'Sending code…' : 'Send code'}
            </button>
          </form>
        )}

        {error && <p className="license-error">{error}</p>}

        {codeSent ? (
          <p className="license-footer">
            No code after a minute? Check spam, or go back and make sure you used your
            purchase email.
          </p>
        ) : (
          <p className="license-footer">
            New here?{' '}
            <a
              href="https://ambient.oezcan.me/#trial"
              target="_blank"
              rel="noopener noreferrer"
            >
              Try free for 7 days
            </a>{' '}
            or{' '}
            <a
              href="https://ambient.oezcan.me/#pricing"
              target="_blank"
              rel="noopener noreferrer"
            >
              buy Ambient
            </a>{' '}
            — then sign in with the same email.
          </p>
        )}
      </div>
    </div>
  );
}
