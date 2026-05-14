import { useEffect, useRef, useState } from 'react';
import { primaryMonitor } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { setWallpaper } from '../lib/wallpaper';
import { loadLibrary, saveLibrary } from '../lib/store';
import {
  DEFAULT_CONFIG,
  PRESET_PALETTES,
  preloadEmojis,
  renderPattern,
  type PatternConfig,
  type PatternType,
} from '../lib/patterns';

const PATTERN_INFO: { id: PatternType; emoji: string; name: string }[] = [
  { id: 'mesh', emoji: '🎨', name: 'Mesh gradient' },
  { id: 'geometric', emoji: '🔺', name: 'Geometric' },
  { id: 'dots', emoji: '🔘', name: 'Dots' },
  { id: 'stripes', emoji: '🦓', name: 'Stripes' },
  { id: 'emoji', emoji: '😀', name: 'Emoji' },
];

function pickInitialConfig(): PatternConfig {
  const dark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    ...DEFAULT_CONFIG,
    colors: dark ? PRESET_PALETTES.Cosmic : PRESET_PALETTES.Pastel,
    seed: Math.floor(Math.random() * 1_000_000),
  };
}

export default function Patterns() {
  const [config, setConfig] = useState<PatternConfig>(() => pickInitialConfig());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emojiVersion, setEmojiVersion] = useState(0);
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    renderPattern(ctx, canvas.width, canvas.height, config);
  }, [config, emojiVersion]);

  useEffect(() => {
    if (config.type !== 'emoji') return;
    let cancelled = false;
    preloadEmojis(config.emojis)
      .then(() => {
        if (!cancelled) setEmojiVersion((v) => v + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [config.emojis, config.type]);

  function patch(p: Partial<PatternConfig>) {
    setConfig((c) => ({ ...c, ...p }));
  }

  function reroll() {
    patch({ seed: Math.floor(Math.random() * 1_000_000) });
  }

  function setColor(i: number, color: string) {
    patch({ colors: config.colors.map((x, idx) => (idx === i ? color : x)) });
  }

  function addColor() {
    if (config.colors.length >= 6) return;
    patch({ colors: [...config.colors, '#ffffff'] });
  }

  function removeColor(i: number) {
    if (config.colors.length <= 2) return;
    patch({ colors: config.colors.filter((_, idx) => idx !== i) });
  }

  function applyPreset(name: string) {
    patch({ colors: [...PRESET_PALETTES[name]] });
  }

  function matchSystemTheme() {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    patch({ colors: dark ? PRESET_PALETTES.Cosmic : PRESET_PALETTES.Pastel });
  }

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus('Reading screen size…');
    try {
      let w = 1920;
      let h = 1080;
      try {
        const info = await invoke<{ width: number; height: number; scale: number; source: string }>(
          'get_primary_monitor_pixels',
        );
        w = info.width;
        h = info.height;
      } catch {
        const monitor = await primaryMonitor();
        w = monitor?.size?.width ?? 1920;
        h = monitor?.size?.height ?? 1080;
      }

      if (config.type === 'emoji') {
        setStatus('Loading emoji graphics…');
        await preloadEmojis(config.emojis);
      }

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

      const info = PATTERN_INFO.find((p) => p.id === config.type);
      const lib = await loadLibrary();
      await saveLibrary([
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
      setTimeout(() => setStatus(null), 1800);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  const activeIndex = PATTERN_INFO.findIndex((p) => p.id === config.type);

  return (
    <div className="patterns">
      <div className="preview-wrap">
        <canvas ref={previewRef} className="pattern-preview" />
        <div className="pattern-tabs-overlay">
          <div
            className="pattern-tabs"
            style={{ ['--active-index' as string]: String(activeIndex) } as React.CSSProperties}
          >
            <div className="pattern-tab-indicator" />
            {PATTERN_INFO.map(({ id, emoji, name }) => (
              <button
                key={id}
                className={config.type === id ? 'pattern-tab active' : 'pattern-tab'}
                onClick={() => patch({ type: id })}
                data-label={name}
                aria-label={name}
              >
                <span className="pattern-tab-emoji">{emoji}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pattern-controls">
        <div className="control-group">
          <label>Colors</label>
          <div className="colors-row">
            {config.colors.map((c, i) => (
              <div key={i} className="color-chip">
                <input
                  type="color"
                  value={c}
                  onChange={(e) => setColor(i, e.target.value)}
                  aria-label={`color ${i + 1}`}
                />
                {config.colors.length > 2 && (
                  <button
                    onClick={() => removeColor(i)}
                    className="chip-remove"
                    aria-label="remove color"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {config.colors.length < 6 && (
              <button onClick={addColor} className="add-color" aria-label="add color">
                +
              </button>
            )}
          </div>
          <div className="presets-row">
            {Object.keys(PRESET_PALETTES).map((name) => (
              <button
                key={name}
                onClick={() => applyPreset(name)}
                className="preset-btn"
              >
                {name}
              </button>
            ))}
            <button onClick={matchSystemTheme} className="preset-btn match">
              Match system
            </button>
          </div>
        </div>

        {config.type !== 'mesh' && (
          <div className="control-group">
            <label>
              {config.type === 'dots' ? 'Density (dots / longest side)' : 'Amount'}{' '}
              <span className="muted">{config.density}</span>
            </label>
            <input
              type="range"
              min={5}
              max={config.type === 'dots' ? 80 : 400}
              value={config.density}
              onChange={(e) => patch({ density: +e.target.value })}
            />
          </div>
        )}

        <div className="control-group">
          <label>
            Size <span className="muted">{config.size}px</span>
          </label>
          <input
            type="range"
            min={8}
            max={200}
            value={config.size}
            onChange={(e) => patch({ size: +e.target.value })}
          />
        </div>

        <div className="control-group">
          <label>
            Randomness <span className="muted">{Math.round(config.randomness * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(config.randomness * 100)}
            onChange={(e) => patch({ randomness: +e.target.value / 100 })}
          />
        </div>

        {config.type === 'emoji' && (
          <div className="control-group">
            <label>
              Emojis <span className="muted">(paste any string — Microsoft Fluent style)</span>
            </label>
            <input
              type="text"
              value={config.emojis.join('')}
              onChange={(e) =>
                patch({
                  emojis: Array.from(e.target.value).filter((c) => c.trim()),
                })
              }
              placeholder="✨🌙⭐💫🪐"
            />
          </div>
        )}
      </div>

      <div className="row">
        <button onClick={reroll} disabled={busy}>
          ↻ Re-roll
        </button>
        <button onClick={apply} disabled={busy} className="primary">
          {busy ? 'Working…' : 'Apply as wallpaper'}
        </button>
        {status && <span className="status">{status}</span>}
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
