// Polar license validation moved to Rust in Phase 2. This file is the
// thin shim the frontend uses to:
//
//   1. Read the gate decision (Valid / Invalid / None) at app launch
//      — already resolved in Rust setup() so first render doesn't flash.
//   2. Activate a newly-pasted key.
//   3. Clear the stored license (no UI bound today; used in dev/debug).
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
}

export type StartupLicense =
  | { status: 'valid'; info: LicenseInfo }
  | { status: 'invalid'; message: string }
  | { status: 'none' };

export async function getStartupLicense(): Promise<StartupLicense> {
  return invoke<StartupLicense>('get_startup_license');
}

export async function activateLicense(key: string): Promise<LicenseInfo> {
  return invoke<LicenseInfo>('activate_license', { key });
}

export async function clearLicense(): Promise<void> {
  return invoke('clear_license');
}
