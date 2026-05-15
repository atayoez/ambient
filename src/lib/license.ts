// Polar license-key activation and validation.
//
// Customers receive their key via the post-purchase email Polar sends.
// They paste it into the activation gate on first launch; the app calls
// Polar's customer-portal API to bind this machine to an activation
// slot, stores the result in the Tauri store, and validates on each
// launch (cached for 24h to avoid hammering Polar).
//
// The customer-portal endpoints are public — no API token required —
// so we can call them straight from the app with the key as bearer
// identity. We bundle only the organization id (it's not a secret).

import { fetch } from '@tauri-apps/plugin-http';
import { loadKey, saveKey } from './store';

const POLAR_BASE = 'https://api.polar.sh';
const POLAR_ORG_ID = 'ebe08965-e42c-47bc-8716-ca78b904204e';
const STORE_KEY = 'license.state';
// Revalidate at most once per 24h. Catches revocation within a day
// without spamming Polar every time the user opens the tray icon.
const REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface LicenseInfo {
  /** The polar_lk_... key the customer was issued. */
  key: string;
  /** The activation row Polar returned when we bound this machine. */
  activationId: string;
  /** Customer email if Polar returned it — for display, not auth. */
  email?: string;
  /** When this machine was first activated. */
  activatedAt: number;
  /** Most recent successful /validate response. Used for the 24h cache. */
  lastValidated: number;
}

export interface ValidateResult {
  valid: boolean;
  /** True when validation failed due to network/server issues rather
   *  than the license being explicitly rejected. Caller should NOT
   *  invalidate the local copy in that case. */
  transient: boolean;
  /** Message suitable to show to the user when valid === false. */
  message?: string;
}

export async function loadLicense(): Promise<LicenseInfo | null> {
  return await loadKey<LicenseInfo>(STORE_KEY);
}

export async function clearLicense(): Promise<void> {
  await saveKey<LicenseInfo | null>(STORE_KEY, null);
}

export async function activateLicense(rawKey: string): Promise<LicenseInfo> {
  const key = rawKey.trim();
  if (!key) throw new Error('License key is empty.');

  const label = machineLabel();
  const res = await fetch(`${POLAR_BASE}/v1/customer-portal/license-keys/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key,
      organization_id: POLAR_ORG_ID,
      label,
    }),
  });

  if (!res.ok) {
    const body = await safeJson(res);
    throw new Error(extractErrorMessage(body, res.status));
  }

  const data = await res.json();
  const info: LicenseInfo = {
    key,
    activationId: data.id,
    email: data.license_key?.customer?.email,
    activatedAt: Date.now(),
    lastValidated: Date.now(),
  };
  await saveKey(STORE_KEY, info);
  return info;
}

export async function deactivateLicense(info: LicenseInfo): Promise<void> {
  // Best-effort: even if the network call fails we clear local state,
  // so the user isn't stuck with a key they can't re-enter.
  try {
    await fetch(`${POLAR_BASE}/v1/customer-portal/license-keys/deactivate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: info.key,
        organization_id: POLAR_ORG_ID,
        activation_id: info.activationId,
      }),
    });
  } catch {
    // ignored — local clear below is the user-visible action
  }
  await clearLicense();
}

export async function validateLicense(
  info: LicenseInfo,
  { force = false }: { force?: boolean } = {},
): Promise<ValidateResult> {
  // Skip the network call entirely if we validated within the last 24h.
  if (!force && Date.now() - info.lastValidated < REVALIDATE_AFTER_MS) {
    return { valid: true, transient: false };
  }

  try {
    const res = await fetch(`${POLAR_BASE}/v1/customer-portal/license-keys/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: info.key,
        organization_id: POLAR_ORG_ID,
        activation_id: info.activationId,
      }),
    });
    if (res.ok) {
      info.lastValidated = Date.now();
      await saveKey(STORE_KEY, info);
      return { valid: true, transient: false };
    }
    // 401 / 403 / 404 are deliberate rejections from Polar — key
    // doesn't exist, activation was removed, or license was revoked.
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      const body = await safeJson(res);
      return {
        valid: false,
        transient: false,
        message: extractErrorMessage(body, res.status),
      };
    }
    // 5xx, 429, etc. — Polar's problem, not the customer's.
    return { valid: true, transient: true };
  } catch {
    // Network unreachable. Trust the local copy.
    return { valid: true, transient: true };
  }
}

// --- helpers -------------------------------------------------------

function machineLabel(): string {
  const platform = (navigator.platform || 'unknown').slice(0, 24);
  // Stable per-install random suffix so the same machine doesn't burn
  // multiple activation slots if Polar's heuristic ever cares.
  let id = localStorage.getItem('ambient.installId');
  if (!id) {
    id = crypto.randomUUID().slice(0, 8);
    localStorage.setItem('ambient.installId', id);
  }
  return `${platform} (${id})`;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const obj = body as { detail?: unknown; error?: unknown };
    if (typeof obj.detail === 'string') return obj.detail;
    if (Array.isArray(obj.detail) && obj.detail.length > 0) {
      const first = obj.detail[0] as { msg?: unknown };
      if (typeof first?.msg === 'string') return first.msg;
    }
    if (typeof obj.error === 'string') return obj.error;
  }
  if (status === 404) return 'License key not found.';
  if (status === 401 || status === 403) return 'License key is no longer valid.';
  return `Activation failed (HTTP ${status}).`;
}
