// App-level hooks. Each owns one of the cross-cutting concerns that
// used to live as a giant useEffect inside App.tsx: license gating,
// update check, rotation timer, theme-follow listener, window
// maximize tracking, and Cmd+N tab switching. Splitting these out
// shrinks App.tsx to mostly JSX and makes each concern testable in
// isolation.

import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useState } from 'react';
import { type LicenseInfo, loadLicense, validateLicense } from './license';
import { rotateNow } from './rotation';
import { loadSettings, saveSettings } from './store';
import type { RotationSource } from './types';
import { checkForUpdate, type UpdateInfo } from './updater';
import { setWallpaper } from './wallpaper';

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
    (async () => {
      const stored = await loadLicense();
      if (cancelled) return;
      if (!stored) {
        setLicenseLoaded(true);
        return;
      }
      // Show the app immediately on the cached license; revalidate in
      // the background. If validation explicitly rejects, kick back to
      // the gate. Transient (network) failures are ignored — see
      // lib/license.ts for the policy.
      setLicense(stored);
      setLicenseLoaded(true);
      const result = await validateLicense(stored);
      if (cancelled) return;
      if (!result.valid && !result.transient) {
        setLicense(null);
        setRevokedMsg(result.message ?? 'Your license is no longer valid.');
      }
    })();
    return () => {
      cancelled = true;
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
// Auto-rotate timer
// ---------------------------------------------------------------------

async function rotateAndAnnounce(): Promise<void> {
  try {
    const entry = await rotateNow();
    window.dispatchEvent(new CustomEvent('ambient-wallpaper-rotated', { detail: entry }));
  } catch {
    // Common causes: source API rate-limited, network offline, BYOK
    // missing. Sources tab will surface a fresh error on its next
    // manual re-fetch; we don't toast here so the background timer
    // stays quiet.
  }
}

export function useAutoRotate(): void {
  const [cfg, setCfg] = useState<{
    source: RotationSource;
    intervalMinutes: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const s = await loadSettings();
      if (cancelled) return;
      setCfg({
        source: s.rotationSource,
        intervalMinutes: s.rotationIntervalMinutes,
      });
    }
    void reload();
    const onChange = () => void reload();
    window.addEventListener('ambient-settings-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('ambient-settings-changed', onChange);
    };
  }, []);

  useEffect(() => {
    // Auto-rotate timer. Silent — no tab switch, so we don't yank the
    // user around mid-task. Failures swallowed; the next tick retries.
    if (!cfg || cfg.source === 'off') return;
    const ms = Math.max(1, cfg.intervalMinutes) * 60 * 1000;
    const id = window.setInterval(() => {
      void rotateAndAnnounce();
    }, ms);
    return () => clearInterval(id);
  }, [cfg?.source, cfg?.intervalMinutes]);
}

// ---------------------------------------------------------------------
// Theme-follow background
// ---------------------------------------------------------------------

export function useThemeFollow(): void {
  const [cfg, setCfg] = useState<{
    enabled: boolean;
    lightPath: string | null;
    darkPath: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const s = await loadSettings();
      if (cancelled) return;
      setCfg({
        enabled: s.themeFollow,
        lightPath: s.themeFollowLightPath,
        darkPath: s.themeFollowDarkPath,
      });
    }
    void reload();
    const onChange = () => void reload();
    window.addEventListener('ambient-settings-changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('ambient-settings-changed', onChange);
    };
  }, []);

  useEffect(() => {
    // Reapply the matching slot whenever the system prefers-color-scheme
    // flips. Listener gated on the toggle so it doesn't do anything
    // when the feature is off. The check runs even if the app is
    // hidden to tray — Tauri keeps the WebView alive, so matchMedia
    // listeners still fire.
    if (!cfg?.enabled) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange() {
      const path = mql.matches ? cfg?.darkPath : cfg?.lightPath;
      if (path) void setWallpaper(path);
    }
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [cfg]);

  useEffect(() => {
    // Slot capture: every wallpaper apply (dispatched via the
    // 'ambient-wallpaper-applied' event from lib/wallpaper.ts) stamps
    // its path into the slot matching the current system theme.
    // Listener is gated so we don't churn settings writes when the
    // feature is off.
    if (!cfg?.enabled) return;
    function onApplied(e: Event) {
      const path = (e as CustomEvent<string>).detail;
      if (!path) return;
      const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      void (async () => {
        const s = await loadSettings();
        const next = { ...s };
        if (dark) next.themeFollowDarkPath = path;
        else next.themeFollowLightPath = path;
        await saveSettings(next);
        window.dispatchEvent(new CustomEvent('ambient-settings-changed'));
      })();
    }
    window.addEventListener('ambient-wallpaper-applied', onApplied);
    return () => window.removeEventListener('ambient-wallpaper-applied', onApplied);
  }, [cfg?.enabled]);
}

// ---------------------------------------------------------------------
// Window maximize state
// ---------------------------------------------------------------------

export function useWindowMaximized(): boolean {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    let unlistenResized: (() => void) | null = null;
    (async () => {
      try {
        const initial = await win.isMaximized();
        if (cancelled) return;
        setIsMaximized(initial);
        // onResized fires for both user drag-resizes and OS-driven
        // maximize/restore. We re-check isMaximized rather than diffing
        // sizes because some WMs (KDE Wayland especially) report
        // tiled-edge as "maximized" — the Tauri API gives the
        // canonical answer.
        unlistenResized = await win.onResized(async () => {
          try {
            const max = await win.isMaximized();
            if (cancelled) return;
            setIsMaximized(max);
          } catch {}
        });
      } catch {
        // No window API available (running outside Tauri, e.g. plain
        // vite dev in a browser tab). Stay in the windowed default.
      }
    })();
    return () => {
      cancelled = true;
      if (unlistenResized) unlistenResized();
    };
  }, []);

  return isMaximized;
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
