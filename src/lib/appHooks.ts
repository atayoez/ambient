// App-level hooks. Each owns one of the cross-cutting concerns that
// used to live as a giant useEffect inside App.tsx: license gating,
// update check, rotation timer, theme-follow listener, window
// maximize tracking, and Cmd+N tab switching. Splitting these out
// shrinks App.tsx to mostly JSX and makes each concern testable in
// isolation.

import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useState } from 'react';
import { type LicenseInfo, loadLicense, validateLicense } from './license';
import { rotateNow } from './rotation';
import { loadSettings, mutateSettings } from './store';
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
    mode: 'auto' | 'light' | 'dark';
    lightPath: string | null;
    darkPath: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const s = await loadSettings();
      if (cancelled) return;
      setCfg({
        mode: s.themeMode,
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
    // System prefers-color-scheme flip — only matters in 'auto' mode,
    // where the wallpaper follows the system. 'light' and 'dark' are
    // locked, so we don't react. matchMedia keeps firing while the
    // window is hidden to tray (Tauri keeps the WebView alive after
    // the destroy/rebuild cycle until the next close).
    if (cfg?.mode !== 'auto') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange() {
      const path = mql.matches ? cfg?.darkPath : cfg?.lightPath;
      if (path) void setWallpaper(path);
    }
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [cfg]);

  useEffect(() => {
    // Slot capture: every wallpaper apply stamps the path into the slot
    // matching the current mode. In 'auto' that's the system theme;
    // in 'light' / 'dark' it's locked to that slot regardless of system
    // theme. Reads themeMode fresh from disk via mutateSettings so the
    // closure can't capture a stale mode — the cfg useState lags the
    // disk write that just happened in onChangeThemeMode by one render
    // tick, and binding to it here would race the slot capture with
    // the React commit cycle.
    function onApplied(e: Event) {
      const path = (e as CustomEvent<string>).detail;
      if (!path) return;
      void mutateSettings((s) => {
        if (s.themeMode === 'auto') {
          const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          return dark
            ? { ...s, themeFollowDarkPath: path }
            : { ...s, themeFollowLightPath: path };
        }
        if (s.themeMode === 'light') {
          return { ...s, themeFollowLightPath: path };
        }
        return { ...s, themeFollowDarkPath: path };
      }).then(() => {
        window.dispatchEvent(new CustomEvent('ambient-settings-changed'));
      });
    }
    window.addEventListener('ambient-wallpaper-applied', onApplied);
    return () => window.removeEventListener('ambient-wallpaper-applied', onApplied);
  }, []);
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
        const color = await invoke<string | null>('get_system_accent');
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

// ---------------------------------------------------------------------
// Tray icon ↔ system theme sync
// ---------------------------------------------------------------------

// macOS template inversion handles tray-icon theming automatically;
// Windows and Linux tray hosts don't, so we detect prefers-color-scheme
// changes here and call the Rust side to swap the glyph. The matchMedia
// listener only fires while the webview is alive — when the user is
// in tray-only state, the icon stays at whatever it was last set to.
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
