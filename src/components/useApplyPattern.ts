// Apply-pattern flow. Phase 5 collapsed the whole render-encode-save
// pipeline into a single Rust command (apply_pattern) that renders at
// the native monitor resolution with 2× SSAA + Lanczos downscale +
// PNG encode, all off the main thread. The JS side just dispatches
// the call and waits — no Canvas, no toBlob, no Array.from(bytes).

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useRef, useState } from 'react';
import type { PatternConfig } from '../lib/patterns';
import { toast } from '../lib/toast';
import type { Wallpaper } from '../lib/types';
import { setWallpaper } from '../lib/wallpaper';

export interface UseApplyPattern {
  busy: boolean;
  status: string | null;
  apply: () => Promise<void>;
  applyLive: () => Promise<void>;
}

export function useApplyPattern(
  config: PatternConfig,
  saveConfig: () => Promise<void>,
): UseApplyPattern {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Mirror busy in a ref so the callback can guard re-entry without
  // needing busy in its dep list (which would re-bind on every click,
  // defeating any downstream memoization).
  const busyRef = useRef(false);

  const apply = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    // Apply is the commit gesture for draft config — persist before
    // any I/O so the user's tweaks survive even if the render or
    // wallpaper step downstream fails.
    try {
      await saveConfig();
    } catch {}
    setStatus('Generating wallpaper…');
    try {
      const entry = await invoke<Wallpaper>('apply_pattern', { config });
      setStatus('Applying wallpaper…');
      await setWallpaper(entry.path);
      setStatus(null);
      toast.success('Applied');
    } catch (e: unknown) {
      toast.fromError(e);
      setStatus(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [config, saveConfig]);

  // Set the live (animated) wallpaper from the current config instead of
  // rendering a still. Same commit-the-draft-first + busy/status shape as
  // apply(); the platform setter (KDE plugin for now) lives in Rust.
  const applyLive = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await saveConfig();
    } catch {}
    setStatus('Setting live wallpaper…');
    try {
      await invoke('apply_live_pattern', { config });
      setStatus(null);
      toast.success('Live wallpaper set');
    } catch (e: unknown) {
      toast.fromError(e);
      setStatus(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [config, saveConfig]);

  return { busy, status, apply, applyLive };
}
