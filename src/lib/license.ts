// Polar license validation moved to Rust in Phase 2. This file is the
// thin shim the frontend uses to:
//
//   1. Read the gate decision (Valid / Invalid / None) at app launch
//      — already resolved in Rust setup() so first render doesn't flash.
//   2. Sign in by email: Polar emails a one-time code, verifying it
//      fetches + activates the customer's license key behind the scenes.
//
// Background revalidation runs in Rust as a tokio task spawned from
// setup(); if Polar explicitly rejects, Rust emits a `license-revoked`
// Tauri event which useLicenseGate forwards to the typed event bus.

import { invoke } from '@tauri-apps/api/core';

export interface LicenseInfo {
  key: string;
  email?: string;
  activatedAt: number;
  lastValidated: number;
  /** Key expiry (ms since epoch) — present on 7-day trial keys, absent on
   *  purchased (perpetual) keys. */
  expiresAt?: number;
}

export type StartupLicense =
  | { status: 'valid'; info: LicenseInfo }
  | { status: 'invalid'; message: string }
  | { status: 'none' };

export async function getStartupLicense(): Promise<StartupLicense> {
  return invoke<StartupLicense>('get_startup_license');
}

/** Ask Polar to email a one-time login code. Always succeeds for
 *  well-formed emails (no account enumeration on Polar's side). */
export async function requestLoginCode(email: string): Promise<void> {
  return invoke<void>('request_login_code', { email });
}

/** Exchange the emailed code for the customer's license (validated and
 *  persisted in Rust). */
export async function loginWithCode(code: string): Promise<LicenseInfo> {
  return invoke<LicenseInfo>('login_with_code', { code });
}
