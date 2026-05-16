// Apply-pattern flow: read monitor size → render at output resolution
// (with 2× SSAA where it pays off) → save PNG → add to library → set
// as wallpaper. Owns busy / status / error so the Patterns component
// stays declarative.

import { invoke } from '@tauri-apps/api/core';
import { primaryMonitor } from '@tauri-apps/api/window';
import { useCallback, useRef, useState } from 'react';
import {
  PATTERN_TYPES,
  type PatternConfig,
  preloadEmojis,
  renderPattern,
} from '../lib/patterns';
import { mutateLibrary } from '../lib/store';
import { setWallpaper } from '../lib/wallpaper';

// Fallback monitor size when neither the Tauri command nor the JS API
// can give us the real resolution. Matches the smallest mainstream
// desktop size — better to under-render than blow up to 8K of zero
// detail when something queries-broken.
const FALLBACK_WIDTH = 1920;
const FALLBACK_HEIGHT = 1080;

export interface UseApplyPattern {
  busy: boolean;
  status: string | null;
  error: string | null;
  apply: () => Promise<void>;
}

export function useApplyPattern(
  config: PatternConfig,
  saveConfig: () => Promise<void>,
): UseApplyPattern {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Mirror busy in a ref so the callback can guard re-entry without
  // needing busy in its dep list (which would re-bind on every click,
  // defeating any downstream memoization).
  const busyRef = useRef(false);

  const apply = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    // Apply is the commit gesture for draft config — persist before any
    // I/O so the user's tweaks survive even if the render or wallpaper
    // step downstream fails. Save errors are swallowed locally: a write
    // failure shouldn't block the more important wallpaper action.
    try {
      await saveConfig();
    } catch {}
    setStatus('Reading screen size…');
    try {
      let w = FALLBACK_WIDTH;
      let h = FALLBACK_HEIGHT;
      try {
        const info = await invoke<{
          width: number;
          height: number;
          scale: number;
          source: string;
        }>('get_primary_monitor_pixels');
        w = info.width;
        h = info.height;
      } catch {
        const monitor = await primaryMonitor();
        w = monitor?.size?.width ?? FALLBACK_WIDTH;
        h = monitor?.size?.height ?? FALLBACK_HEIGHT;
      }

      if (config.type === 'emoji') {
        setStatus('Loading emoji graphics…');
        await preloadEmojis(config.emojis);
      }

      // Emoji renders use raster assets, so super-sampling buys nothing
      // and just slows the export down; everything else benefits from
      // 2× SSAA before downscaling for crisper edges.
      const SS = config.type === 'emoji' ? 1 : 2;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get 2D context');

      if (SS > 1) {
        setStatus(`Rendering ${w}×${h} at ${SS}× for sharpness…`);
        const renderCanvas = document.createElement('canvas');
        renderCanvas.width = w * SS;
        renderCanvas.height = h * SS;
        const renderCtx = renderCanvas.getContext('2d');
        if (!renderCtx) throw new Error('Could not get 2D context');
        renderPattern(renderCtx, w * SS, h * SS, config);

        setStatus('Downscaling…');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(renderCanvas, 0, 0, w, h);
      } else {
        setStatus(`Rendering ${w}×${h}…`);
        renderPattern(ctx, w, h, config);
      }

      setStatus('Encoding (lossless PNG)…');
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
          'image/png',
        );
      });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      setStatus('Saving…');
      const localPath = await invoke<string>('save_image_bytes', {
        bytes: Array.from(bytes),
        filename: `pattern-${config.type}-${config.seed}.png`,
      });

      const info = PATTERN_TYPES.find((p) => p.id === config.type);
      await mutateLibrary((lib) => [
        {
          path: localPath,
          source: 'generated',
          title: `${info?.name ?? config.type} (${config.colors.length} colors)`,
          addedAt: Date.now(),
        },
        ...lib,
      ]);

      setStatus('Applying wallpaper…');
      await setWallpaper(localPath);
      setStatus('Applied');
      setTimeout(() => setStatus(null), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [config, saveConfig]);

  return { busy, status, error, apply };
}
