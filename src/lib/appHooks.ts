// App-level hooks. Each owns one of the cross-cutting concerns that
// used to live as a giant useEffect inside App.tsx: license gating,
// update check, window maximize tracking, system accent, tray theme
// sync, and Cmd+N tab switching. Splitting these out shrinks App.tsx
// to mostly JSX and makes each concern testable in isolation.
//
// Auto-rotation + theme-follow moved to Rust tokio tasks in Phase 4
// so they survive webview destroy/rebuild (the pre-Phase-4 JS
// setInterval / matchMedia listener died when the user closed to tray).

import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen as listenTauri } from '@tauri-apps/api/event';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { listen } from './events';
import { getStartupLicense, type LicenseInfo } from './license';
import { loadSettings } from './store';
import type { Settings } from './types';
import { checkForUpdate, type UpdateInfo } from './updater';

// ---------------------------------------------------------------------
// Settings (Rust-owned): load + optional live subscription
// ---------------------------------------------------------------------

// One shared way to get the Rust-owned Settings into a component: null
// until the first get_settings resolves (a ~ms RAM read — render nothing
// or a skeleton for that frame), then the loaded value. This replaced the
// per-component copies that seeded useState with a hand-mirrored
// DEFAULT_SETTINGS object; Rust's serde defaults (types.rs) are the only
// source of default values now.
//
// Pass { subscribe: true } to also reload on the settings-changed bus
// event. Writers that keep optimistic local state + debounced patches
// should NOT subscribe — reloading on their own event echo could clobber
// a newer local value with the older persisted one mid-debounce.
export function useSettings(
  opts: { subscribe?: boolean } = {},
): [Settings | null, Dispatch<SetStateAction<Settings | null>>] {
  const { subscribe = false } = opts;
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void loadSettings().then((s) => {
        if (!cancelled) setSettings(s);
      });
    load();
    const unsub = subscribe ? listen('settings-changed', load) : null;
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [subscribe]);

  return [settings, setSettings];
}

// ---------------------------------------------------------------------
// License gate
// ---------------------------------------------------------------------

export interface UseLicenseGate {
  license: LicenseInfo | null;
  licenseLoaded: boolean;
  revokedMsg: string | undefined;
  onActivated: (info: LicenseInfo) => void;
}

export function useLicenseGate(): UseLicenseGate {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [licenseLoaded, setLicenseLoaded] = useState(false);
  const [revokedMsg, setRevokedMsg] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let unlistenRevoked: (() => void) | null = null;
    (async () => {
      // Rust resolved the gate decision in setup() before the webview
      // painted. The invoke is just a ~ms RAM read — no Polar call,
      // no loading flash. Background revalidation (if the cache was
      // stale) is already running; if it rejects, we'll get a
      // `license-revoked` Tauri event below.
      const startup = await getStartupLicense();
      if (cancelled) return;
      if (startup.status === 'valid') {
        setLicense(startup.info);
      } else if (startup.status === 'invalid') {
        setRevokedMsg(startup.message);
      }
      setLicenseLoaded(true);

      unlistenRevoked = await listenTauri<string>('license-revoked', (event) => {
        if (cancelled) return;
        setLicense(null);
        setRevokedMsg(event.payload ?? 'Your license is no longer valid.');
      });
    })();
    return () => {
      cancelled = true;
      unlistenRevoked?.();
    };
  }, []);

  const onActivated = useCallback((info: LicenseInfo) => {
    setLicense(info);
    setRevokedMsg(undefined);
  }, []);

  return { license, licenseLoaded, revokedMsg, onActivated };
}

// ---------------------------------------------------------------------
// Update banner
// ---------------------------------------------------------------------

export interface UseUpdateBanner {
  updateInfo: UpdateInfo | null;
  dismiss: () => void;
}

export function useUpdateBanner(license: LicenseInfo | null): UseUpdateBanner {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!license) return;
    let cancelled = false;
    (async () => {
      try {
        const current = await getVersion();
        const info = await checkForUpdate(current);
        if (!cancelled && info) setUpdateInfo(info);
      } catch {
        // Update check is best-effort. Don't surface failures.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [license]);

  const dismiss = useCallback(() => setUpdateInfo(null), []);

  return { updateInfo, dismiss };
}

// ---------------------------------------------------------------------
// System accent color
// ---------------------------------------------------------------------

// One IPC round-trip per session for the OS accent, memoized so the
// in-flight promise is shared. The accent can only change between
// launches, so caching for the session is safe (makes good on accent.rs's
// "cached in the frontend for the session"). The chrome no longer tints
// itself from the accent (the app is fully achromatic glass); the only
// consumer is useSystemAccentColor below, which hands the hex to the
// Patterns "System" palette — wallpaper content, not chrome.
let systemAccentPromise: Promise<string | null> | null = null;
function fetchSystemAccent(): Promise<string | null> {
  if (!systemAccentPromise) {
    systemAccentPromise = invoke<string | null>('get_system_accent');
  }
  return systemAccentPromise;
}

// Returns the OS accent as a hex string ("#8ed96c"), or null when the
// platform/DE exposes none. Hands the raw value back to React so feature
// code — e.g. the accent-derived "System" palette in Patterns — can
// compute from it. Resolves once on mount; the accent is read fresh from
// the OS each launch, which is when it can change.
export function useSystemAccentColor(): string | null {
  const [accent, setAccent] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const color = await fetchSystemAccent();
        if (!cancelled) setAccent(color);
      } catch {
        if (!cancelled) setAccent(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return accent;
}

// ---------------------------------------------------------------------
// Tray icon ↔ system theme sync
// ---------------------------------------------------------------------

// macOS template inversion handles tray-icon theming automatically;
// Windows and Linux tray hosts don't, so we detect prefers-color-scheme
// changes here and call the Rust side to swap the glyph. The matchMedia
// listener only fires while the webview is alive — when the user is in
// tray-only state, the icon stays at whatever it was last set to.
// Cold launches get the right initial icon via tray_icon::is_system_dark()
// in lib.rs setup(), so the only stale-icon case is "user changed theme
// while tray-only, then opened the window" — and matchMedia fires on
// next paint there, catching it within a frame.
export function useTrayThemeSync(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      void invoke('update_tray_theme', { isDark: mql.matches }).catch(() => {
        // Tray command can fail in dev (HMR mid-restart, no tray host on
        // headless CI). Swallow — next theme flip will retry.
      });
    };
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
}

// ---------------------------------------------------------------------
// Tab keybindings (Cmd/Ctrl + 1..N)
// ---------------------------------------------------------------------

export function useTabKeybindings<T>(
  tabIds: readonly T[],
  setTab: (id: T) => void,
): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > tabIds.length) return;
      e.preventDefault();
      setTab(tabIds[n - 1]);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabIds, setTab]);
}
