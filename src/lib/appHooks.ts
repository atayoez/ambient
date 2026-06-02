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
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useState } from 'react';
import { getStartupLicense, type LicenseInfo } from './license';
import { checkForUpdate, type UpdateInfo } from './updater';

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
// System accent color
// ---------------------------------------------------------------------

// Parses #rrggbb into a space-separated RGB triplet ("200 136 0"),
// which is the format the CSS `rgb(var(--shadow-tint) / α)` syntax
// expects. Returns null on malformed input so the caller knows to
// leave the default black triplet in place rather than half-apply.
function parseHexTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return `${(v >> 16) & 0xff} ${(v >> 8) & 0xff} ${v & 0xff}`;
}

// One IPC round-trip per session, shared by every accent consumer
// (useSystemAccent writes CSS vars; useSystemAccentColor hands the hex
// to feature code). The OS accent can only change between launches, so
// memoizing the in-flight promise is safe and makes good on accent.rs's
// "cached in the frontend for the session" — previously each hook
// invoked the command independently.
let systemAccentPromise: Promise<string | null> | null = null;
function fetchSystemAccent(): Promise<string | null> {
  if (!systemAccentPromise) {
    systemAccentPromise = invoke<string | null>('get_system_accent');
  }
  return systemAccentPromise;
}

// Pulls the OS accent (macOS AppleAccentColor / Windows DWM AccentColor /
// GNOME accent-color) once at app launch and writes it into TWO CSS
// custom properties on <html>:
//
//   --accent-os    — full color string ("#c88800"), used at sites that
//                    want the accent as a standalone color (focus
//                    border, slider track, selection ring).
//   --shadow-tint  — RGB triplet ("200 136 0"), composed via
//                    `rgb(var(--shadow-tint) / α)` everywhere a shadow,
//                    border, or fill used to be `rgba(0,0,0,α)`. This
//                    is the channel that flips the whole app's
//                    chromaticity from achromatic-black to accent-tinted
//                    when the OS exposes an accent. Defaults to `0 0 0`
//                    (black) in colors_and_type.css so the cascade stays
//                    visually unchanged for users without an accent.
//
// Also stamps the resolved value (or "none") into
// `<html data-system-accent="…">` so it's inspectable without the
// devtools console — handy for debugging "is the accent actually
// being applied" without enabling the full inspector.
export function useSystemAccent(): void {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const color = await fetchSystemAccent();
        if (cancelled) return;
        document.documentElement.dataset.systemAccent = color ?? 'none';
        if (color) {
          document.documentElement.style.setProperty('--accent-os', color);
          const triplet = parseHexTriplet(color);
          if (triplet) {
            document.documentElement.style.setProperty('--shadow-tint', triplet);
          }
        }
        console.info(
          '[Ambient] system accent:',
          color ?? 'none (using achromatic --accent)',
        );
      } catch (e) {
        if (!cancelled) {
          document.documentElement.dataset.systemAccent = 'error';
          console.warn('[Ambient] get_system_accent failed:', e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}

// Returns the OS accent as a hex string ("#8ed96c"), or null when the
// platform/DE exposes none. Unlike useSystemAccent (which writes CSS
// custom properties for the chrome), this hands the raw value back to
// React so feature code — e.g. the accent-derived "System" palette in
// Patterns — can compute from it. Resolves once on mount; the accent is
// read fresh from the OS each launch, which is when it can change.
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
