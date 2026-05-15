import { invoke } from '@tauri-apps/api/core';
import { primaryMonitor } from '@tauri-apps/api/window';
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useKeydown, usePersistedState } from '../lib/hooks';
import {
  DEFAULT_CONFIG,
  PATTERN_TYPES,
  type PatternConfig,
  type PatternType,
  PRESET_PALETTES,
  preloadEmojis,
  renderPattern,
  SLIDER_RANGES,
  TYPE_DEFAULTS,
} from '../lib/patterns';
import { loadLibrary, saveLibrary } from '../lib/store';
import { isDarkForMode, type ThemeMode, useSystemDark } from '../lib/theme';
import { setWallpaper } from '../lib/wallpaper';
import {
  ControlRow,
  InspectorSection,
  PreviewFrame,
  Segmented,
  StatusInline,
  TabLayout,
} from './layout';

// Fallback monitor size when neither the Tauri command nor the JS API can
// give us the real resolution. Matches the smallest mainstream desktop size.
const FALLBACK_WIDTH = 1920;
const FALLBACK_HEIGHT = 1080;

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

function paletteFor(dark: boolean): string[] {
  return [...(dark ? PRESET_PALETTES.Cosmic : PRESET_PALETTES.Pastel)];
}

function pickInitialConfig(dark: boolean): PatternConfig {
  return { ...DEFAULT_CONFIG, colors: paletteFor(dark), seed: randomSeed() };
}

const THEME_OPTIONS = [
  { id: 'auto' as const, label: 'Auto', icon: '🌗' },
  { id: 'light' as const, label: 'Light', icon: '☀' },
  { id: 'dark' as const, label: 'Dark', icon: '🌙' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function Patterns() {
  const systemDark = useSystemDark();
  const [themeMode, setThemeMode] = usePersistedState<ThemeMode>(
    'patterns.themeMode',
    'auto',
  );
  const [config, setConfig] = usePersistedState<PatternConfig>(
    'patterns.config',
    pickInitialConfig(isDarkForMode('auto', systemDark)),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emojiVersion, setEmojiVersion] = useState(0);
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  // Defer the config used by the renderer so high-frequency slider input
  // doesn't trigger a render per pixel of drag — React schedules the
  // deferred update at lower priority, smoothing the slider thumb.
  const deferredConfig = useDeferredValue(config);

  // Hold the render closure in a ref so the ResizeObserver effect can be
  // set up once (mount) but always call the latest closure with the
  // current config.
  const renderRef = useRef<() => void>(() => {});

  // Sync the palette to the resolved theme. Manual color edits via chips
  // still apply, but flipping the theme mode or — in auto — the system
  // color-scheme always wins, so the user can lock to Light/Dark to opt
  // out of OS-driven changes.
  const effectiveDark = isDarkForMode(themeMode, systemDark);
  useEffect(() => {
    setConfig((c) => ({ ...c, colors: paletteFor(effectiveDark) }));
  }, [effectiveDark, setConfig]);

  // Pre-paint render: useLayoutEffect runs synchronously after the DOM is
  // ready but before the browser paints, so the canvas never flashes empty.
  useLayoutEffect(() => {
    renderRef.current = () => {
      const canvas = previewRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const wrap = canvas.parentElement;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      renderPattern(ctx, canvas.width, canvas.height, deferredConfig);
    };
    renderRef.current();
  }, [deferredConfig, emojiVersion]);

  // Re-render when the window resizes — the wrap's size changes but
  // config doesn't, so the existing layout-effect wouldn't pick it up.
  useEffect(() => {
    const canvas = previewRef.current;
    const wrap = canvas?.parentElement;
    if (!wrap) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => renderRef.current());
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

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

  function setType(id: PatternType) {
    patch({ type: id, ...TYPE_DEFAULTS[id] });
  }

  function reroll() {
    patch({ seed: randomSeed() });
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

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError(null);
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

  // Cmd/Ctrl+Enter applies, Cmd/Ctrl+Shift+R re-rolls. Apple desktop
  // staples — Cmd+R itself is avoided since some webviews still treat
  // it as a reload.
  useKeydown('Enter', () => void apply(), { cmdOrCtrl: true });
  useKeydown('r', () => reroll(), { cmdOrCtrl: true, shift: true });

  const ranges = SLIDER_RANGES[config.type] ?? {};
  const densityRange = ranges.density;
  const sizeRange = ranges.size;
  const hasFormSliders = densityRange || sizeRange || config.type === 'mesh';

  return (
    <div className="patterns">
      <TabLayout
        preview={
          <PreviewFrame>
            <canvas ref={previewRef} />
          </PreviewFrame>
        }
        inspector={
          <>
            <InspectorSection title="Pattern">
              <div className="type-list" role="radiogroup" aria-label="Pattern type">
                {PATTERN_TYPES.map(({ id, emoji, name }) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={config.type === id}
                    className={config.type === id ? 'type-row active' : 'type-row'}
                    onClick={() => setType(id)}
                  >
                    <span className="type-emoji" aria-hidden="true">
                      {emoji}
                    </span>
                    <span className="type-text">
                      <span className="type-name">{name}</span>
                    </span>
                    {config.type === id && (
                      <span className="type-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </InspectorSection>

            <InspectorSection title="Palette">
              <Segmented
                options={THEME_OPTIONS}
                value={themeMode}
                onChange={setThemeMode}
                ariaLabel="Theme mode"
              />
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
              </div>
            </InspectorSection>

            {hasFormSliders && (
              <InspectorSection title="Form">
                {densityRange && (
                  <ControlRow
                    label={densityRange.label}
                    value={clamp(config.density, densityRange.min, densityRange.max)}
                    min={densityRange.min}
                    max={densityRange.max}
                    onChange={(v) => patch({ density: v })}
                  />
                )}
                {sizeRange && (
                  <ControlRow
                    label="Size"
                    value={clamp(config.size, sizeRange.min, sizeRange.max)}
                    suffix="px"
                    min={sizeRange.min}
                    max={sizeRange.max}
                    onChange={(v) => patch({ size: v })}
                  />
                )}
                <ControlRow
                  label="Randomness"
                  value={Math.round(config.randomness * 100)}
                  suffix="%"
                  min={0}
                  max={100}
                  onChange={(v) => patch({ randomness: v / 100 })}
                />
              </InspectorSection>
            )}

            {config.type === 'emoji' && (
              <InspectorSection title="Emojis">
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
                <p className="muted small">
                  Paste any string — rendered in Microsoft Fluent style.
                </p>
              </InspectorSection>
            )}
          </>
        }
        actions={
          <>
            <button onClick={reroll} disabled={busy}>
              ↻ Re-roll
            </button>
            <button onClick={apply} disabled={busy} className="primary">
              {busy ? 'Working…' : 'Apply as wallpaper'}
            </button>
            <StatusInline status={status} error={error} />
          </>
        }
      />
    </div>
  );
}
