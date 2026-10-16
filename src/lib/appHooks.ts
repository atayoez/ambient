// App-level hooks. Each owns one of the cross-cutting concerns that
// used to live as a giant useEffect inside App.tsx: window maximize
// tracking, system accent, tray theme sync, and Cmd+N tab switching. Splitting these out shrinks App.tsx
// to mostly JSX and makes each concern testable in isolation.
//
// Auto-rotation + theme-follow moved to Rust tokio tasks in Phase 4
// so they survive webview destroy/rebuild (the pre-Phase-4 JS
// setInterval / matchMedia listener died when the user closed to tray).

import { invoke } from '@tauri-apps/api/core';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { listen } from './events';
import { useDebouncedSettingsPatch } from './hooks';
import { reapplyLiveWallpaper, SPEED_MAX, SPEED_MIN } from './live';
import { loadSettings } from './store';
import type { LiveClock, LiveWidgets, Settings } from './types';
import { DEFAULT_LIVE_WIDGETS, type ExtraWidgetId } from './widgets';

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
// Animation speed (Settings.animationSpeed) as a live slider value
// ---------------------------------------------------------------------

// [speed, setSpeed] for the speed slider. The value shown is the local
// draft while a drag is in flight and the persisted setting otherwise, so
// the preview and every mounted slider move instantly; the setting itself
// is written once the drag has been still for 300 ms, and the active live
// wallpaper is re-applied on that flush so the desktop follows. Subscribed
// to settings-changed, so a change made in one tab shows up in the other,
// and the draft is dropped as soon as the persisted value catches up.
export function useAnimationSpeed(): [number, (v: number) => void] {
  const [settings] = useSettings({ subscribe: true });
  const persisted = settings?.animationSpeed ?? 1;
  const [draft, setDraft] = useState<number | null>(null);
  const patch = useDebouncedSettingsPatch(() => void reapplyLiveWallpaper(), 300);

  // The flush above triggers settings-changed → `persisted` updates to what
  // we wrote → the draft has done its job. (Also clears it when another tab
  // changes the speed, so this slider follows.)
  useEffect(() => {
    setDraft(null);
  }, [persisted]);

  const setSpeed = useCallback(
    (v: number) => {
      const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
      setDraft(clamped);
      patch({ animationSpeed: clamped });
    },
    [patch],
  );

  return [draft ?? persisted, setSpeed];
}

// ---------------------------------------------------------------------
// Live clock widget (Settings.liveClock) as live-editable state
// ---------------------------------------------------------------------

/** Mirrors `impl Default for LiveClock` in types.rs — shown until settings load. */
export const DEFAULT_LIVE_CLOCK: LiveClock = {
  enabled: false,
  position: 'top-right',
  x: 96,
  y: 4,
  size: 9,
  hour12: false,
  showSeconds: false,
  showDate: true,
};

// [clock, patchClock] for the Widgets tab. Same shape as useAnimationSpeed:
// edits land in a local draft immediately (so the stage preview and the
// Patterns preview move with the sliders), are persisted as one whole
// LiveClock object 300 ms after the last edit (Rust deserializes the struct
// atomically, so never a partial), and the active live wallpaper is
// re-applied on that flush. The draft is dropped once the persisted clock
// actually changes (compared by value, so an unrelated settings write
// mid-drag doesn't snap the sliders back).
export function useLiveClock(): [LiveClock, (p: Partial<LiveClock>) => void] {
  const [settings] = useSettings({ subscribe: true });
  const persisted = settings?.liveClock ?? DEFAULT_LIVE_CLOCK;
  const [draft, setDraft] = useState<LiveClock | null>(null);
  const patch = useDebouncedSettingsPatch(() => void reapplyLiveWallpaper(), 300);

  const persistedKey = JSON.stringify(persisted);
  useEffect(() => {
    setDraft(null);
  }, [persistedKey]);

  const current = draft ?? persisted;
  const currentRef = useRef(current);
  currentRef.current = current;

  const patchClock = useCallback(
    (p: Partial<LiveClock>) => {
      const next = { ...currentRef.current, ...p };
      setDraft(next);
      patch({ liveClock: next });
    },
    [patch],
  );

  return [current, patchClock];
}

// ---------------------------------------------------------------------
// Weather / calendar / countdown / note widgets (Settings.liveWidgets)
// ---------------------------------------------------------------------

// [widgets, patchWidget, setStyle] — the same draft → debounced whole-object
// write → re-apply flow as useLiveClock, for the LiveWidgets block.
export function useLiveWidgets(): [
  LiveWidgets,
  <K extends ExtraWidgetId>(id: K, p: Partial<LiveWidgets[K]>) => void,
  (style: LiveWidgets['style']) => void,
] {
  const [settings] = useSettings({ subscribe: true });
  const persisted = settings?.liveWidgets ?? DEFAULT_LIVE_WIDGETS;
  const [draft, setDraft] = useState<LiveWidgets | null>(null);
  const patch = useDebouncedSettingsPatch(() => void reapplyLiveWallpaper(), 300);

  const persistedKey = JSON.stringify(persisted);
  useEffect(() => {
    setDraft(null);
  }, [persistedKey]);

  const current = draft ?? persisted;
  const currentRef = useRef(current);
  currentRef.current = current;

  const write = useCallback(
    (next: LiveWidgets) => {
      currentRef.current = next;
      setDraft(next);
      patch({ liveWidgets: next });
    },
    [patch],
  );
  const patchWidget = useCallback(
    <K extends ExtraWidgetId>(id: K, p: Partial<LiveWidgets[K]>) => {
      const cur = currentRef.current;
      write({ ...cur, [id]: { ...cur[id], ...p } });
    },
    [write],
  );
  const setStyle = useCallback(
    (style: LiveWidgets['style']) => write({ ...currentRef.current, style }),
    [write],
  );

  return [current, patchWidget, setStyle];
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
