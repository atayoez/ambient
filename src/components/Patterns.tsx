import { invoke } from '@tauri-apps/api/core';
import { primaryMonitor } from '@tauri-apps/api/window';
import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useKeydown, usePersistedState } from '../lib/hooks';
import {
  COLOR_PRESETS,
  DEFAULT_CONFIG,
  getPreset,
  PATTERN_TYPES,
  type PatternConfig,
  type PatternType,
  preloadEmojis,
  renderPattern,
  SLIDER_RANGES,
  TYPE_DEFAULTS,
} from '../lib/patterns';
import { mutateLibrary } from '../lib/store';
import { isDarkForMode, type ThemeMode, useSystemDark } from '../lib/theme';
import { setWallpaper } from '../lib/wallpaper';
import { CheckIcon, PlusIcon, ShuffleIcon, XIcon } from './Icons';
import {
  ControlRow,
  InspectorSection,
  PreviewFrame,
  Segmented,
  Select,
  StatusInline,
  TabLayout,
} from './layout';
import ClickSpark from './reactbits/ClickSpark/ClickSpark';

// Fallback monitor size when neither the Tauri command nor the JS API can
// give us the real resolution. Matches the smallest mainstream desktop size.
const FALLBACK_WIDTH = 1920;
const FALLBACK_HEIGHT = 1080;

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

function paletteFor(dark: boolean, presetId: string): string[] {
  const preset = getPreset(presetId) ?? COLOR_PRESETS[0];
  return [...(dark ? preset.dark : preset.light)];
}

function pickInitialConfig(dark: boolean): PatternConfig {
  const preset = COLOR_PRESETS[0];
  return {
    ...DEFAULT_CONFIG,
    colors: paletteFor(dark, preset.id),
    emojis: [...preset.emojis],
    seed: randomSeed(),
    colorPresetId: preset.id,
  };
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

  // Bleed source for the PreviewFrame halo — a downscaled JPEG data URL
  // derived from the rendered preview canvas. Updated at the end of each
  // useLayoutEffect render below. The scratch canvas is reused across
  // renders to avoid per-frame allocation pressure.
  const [bleedSrc, setBleedSrc] = useState<string | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);

  // Re-apply the active preset's variant when the resolved theme flips.
  // Custom palettes (where the user manually edited a chip and
  // colorPresetId got cleared) survive the swap unchanged.
  const effectiveDark = isDarkForMode(themeMode, systemDark);
  useEffect(() => {
    setConfig((c) => {
      if (!c.colorPresetId) return c;
      return { ...c, colors: paletteFor(effectiveDark, c.colorPresetId) };
    });
  }, [effectiveDark, setConfig]);

  // Pre-paint render: useLayoutEffect runs synchronously after the DOM is
  // ready but before the browser paints, so the canvas never flashes empty.
  // Renderer always gets randomness: 1 — matches the apply path so the
  // preview is what-you-see-is-what-you-get. Without this, old persisted
  // configs (saved before the randomness slider was removed) render the
  // preview with their stale value while apply uses full randomness, and
  // the wallpaper that lands on disk looks different from the preview.
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

      // Update the bleed thumbnail. drawImage downscales the main canvas
      // into a tiny scratch (128×72 — heavy CSS blur in ImageBleed means
      // pixel detail is invisible) and toDataURL serializes it as a JPEG
      // data URI. The scratch canvas is reused across renders. The whole
      // op runs in single-digit ms even on integrated graphics, and only
      // fires when deferredConfig changes (already debounced).
      if (!scratchRef.current) {
        scratchRef.current = document.createElement('canvas');
        scratchRef.current.width = 128;
        scratchRef.current.height = 72;
      }
      const scratch = scratchRef.current;
      const sctx = scratch.getContext('2d');
      if (sctx) {
        sctx.drawImage(canvas, 0, 0, scratch.width, scratch.height);
        setBleedSrc(scratch.toDataURL('image/jpeg', 0.5));
      }
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

  // Any direct palette edit (chip color change, add, remove) marks the
  // palette as custom by clearing colorPresetId — that way the theme-
  // swap effect leaves the user's customization alone.
  function setColor(i: number, color: string) {
    patch({
      colors: config.colors.map((x, idx) => (idx === i ? color : x)),
      colorPresetId: undefined,
    });
  }

  function addColor() {
    if (config.colors.length >= 6) return;
    patch({
      colors: [...config.colors, '#ffffff'],
      colorPresetId: undefined,
    });
  }

  function removeColor(i: number) {
    if (config.colors.length <= 2) return;
    patch({
      colors: config.colors.filter((_, idx) => idx !== i),
      colorPresetId: undefined,
    });
  }

  function removeEmoji(i: number) {
    if (config.emojis.length <= 1) return;
    patch({ emojis: config.emojis.filter((_, idx) => idx !== i) });
  }

  // Selecting a preset sets BOTH the colors (light or dark variant for
  // the current theme) AND the emojis. The Emoji pattern type picks up
  // the new emojis on the next render; users who've customized the
  // emoji string after picking a preset will see those overwritten —
  // explicit re-pick = explicit reset.
  function applyPreset(id: string) {
    const preset = getPreset(id);
    if (!preset) return;
    patch({
      colorPresetId: id,
      colors: [...(effectiveDark ? preset.dark : preset.light)],
      emojis: [...preset.emojis],
    });
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

  return (
    <div className="patterns">
      <TabLayout
        title="Patterns"
        preview={
          <PreviewFrame bleedSrc={bleedSrc}>
            <canvas ref={previewRef} />
          </PreviewFrame>
        }
        inspector={
          <>
            <InspectorSection title="Pattern">
              <Select
                options={PATTERN_TYPES.map((t) => ({
                  id: t.id,
                  label: t.name,
                  emoji: t.emoji,
                }))}
                value={config.type}
                onChange={setType}
                ariaLabel="Pattern type"
              />
            </InspectorSection>

            <InspectorSection title="Palette">
              <Segmented
                options={THEME_OPTIONS}
                value={themeMode}
                onChange={setThemeMode}
                ariaLabel="Theme mode"
              />
              <div className="presets-row">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    className={
                      config.colorPresetId === preset.id
                        ? 'preset-btn active'
                        : 'preset-btn'
                    }
                    title={`${preset.name} — ${preset.emojis.slice(0, 3).join(' ')}`}
                  >
                    <span className="preset-emoji" aria-hidden="true">
                      {preset.emojis[0]}
                    </span>
                    <span>{preset.name}</span>
                  </button>
                ))}
              </div>
              {config.type === 'emoji' ? (
                <>
                  <div className="emoji-row">
                    {config.emojis.map((emoji, i) => (
                      <div key={`${emoji}-${i}`} className="emoji-chip">
                        <span aria-hidden="true">{emoji}</span>
                        {config.emojis.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeEmoji(i)}
                            className="chip-remove"
                            aria-label={`Remove emoji ${emoji}`}
                            title="Remove"
                          >
                            <XIcon size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
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
                    Click × on a chip to remove, or paste a new emoji string above.
                    Rendered in Microsoft Fluent style.
                  </p>
                </>
              ) : (
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
                          title="Remove color"
                        >
                          <XIcon size={11} />
                        </button>
                      )}
                    </div>
                  ))}
                  {config.colors.length < 6 && (
                    <button
                      onClick={addColor}
                      className="add-color"
                      aria-label="Add color"
                      title="Add color"
                    >
                      <PlusIcon size={14} />
                    </button>
                  )}
                </div>
              )}
            </InspectorSection>

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
                  min={sizeRange.min}
                  max={sizeRange.max}
                  onChange={(v) => patch({ size: v })}
                />
              )}

              {config.type === 'mesh' && (
                <>
                  <ControlRow
                    label="Bubbles"
                    value={config.meshBubbles ?? 16}
                    min={6}
                    max={40}
                    onChange={(v) => patch({ meshBubbles: v })}
                  />
                  <ControlRow
                    label="Softness"
                    value={Math.round((config.meshSoftness ?? 0.5) * 100)}
                    suffix="%"
                    min={0}
                    max={100}
                    onChange={(v) => patch({ meshSoftness: v / 100 })}
                  />
                </>
              )}

              {config.type === 'geometric' && (
                <>
                  {/* Plain div (not label) — a Segmented renders a button
                      group, which can't be associated with a single label
                      target. The eyebrow span + aria-label on Segmented
                      cover the labelling story. */}
                  <div className="field">
                    <span>Shape</span>
                    <Segmented
                      options={[
                        { id: 'mix', label: 'Mix' },
                        { id: 'circles', label: 'Circles' },
                        { id: 'triangles', label: 'Triangles' },
                        { id: 'squares', label: 'Squares' },
                      ]}
                      value={config.geometricShape ?? 'mix'}
                      onChange={(v) => patch({ geometricShape: v })}
                      ariaLabel="Shape"
                    />
                  </div>
                  <div className="field">
                    <span>Fill</span>
                    <Segmented
                      options={[
                        { id: 'solid', label: 'Solid' },
                        { id: 'outline', label: 'Outline' },
                        { id: 'mix', label: 'Mix' },
                      ]}
                      value={config.geometricFill ?? 'solid'}
                      onChange={(v) => patch({ geometricFill: v })}
                      ariaLabel="Fill"
                    />
                  </div>
                </>
              )}

              {config.type === 'dots' && (
                <>
                  <ControlRow
                    label="Scatter"
                    value={Math.round((config.dotsJitter ?? 0.5) * 100)}
                    suffix="%"
                    min={0}
                    max={100}
                    onChange={(v) => patch({ dotsJitter: v / 100 })}
                  />
                  <ControlRow
                    label="Size var."
                    value={Math.round((config.dotsSizeVar ?? 0.7) * 100)}
                    suffix="%"
                    min={0}
                    max={100}
                    onChange={(v) => patch({ dotsSizeVar: v / 100 })}
                  />
                </>
              )}

              {config.type === 'stripes' && (
                <>
                  <ControlRow
                    label="Angle"
                    value={clamp(config.stripesAngle ?? 30, 0, 90)}
                    suffix="°"
                    min={0}
                    max={90}
                    onChange={(v) => patch({ stripesAngle: v })}
                  />
                  <ControlRow
                    label="Width var."
                    value={Math.round((config.stripesWidthVar ?? 0.5) * 100)}
                    suffix="%"
                    min={0}
                    max={100}
                    onChange={(v) => patch({ stripesWidthVar: v / 100 })}
                  />
                </>
              )}

              {config.type === 'emoji' && (
                <>
                  <ControlRow
                    label="Spacing"
                    value={clamp(config.emojiSpacing ?? 175, 50, 300)}
                    suffix="%"
                    min={50}
                    max={300}
                    onChange={(v) => patch({ emojiSpacing: v })}
                  />
                  <ControlRow
                    label="Rotation"
                    value={config.emojiRotationMax ?? 34}
                    suffix="°"
                    min={0}
                    max={90}
                    onChange={(v) => patch({ emojiRotationMax: v })}
                  />
                  <ControlRow
                    label="Size var."
                    value={Math.round((config.emojiSizeVar ?? 0.75) * 100)}
                    suffix="%"
                    min={0}
                    max={100}
                    onChange={(v) => patch({ emojiSizeVar: v / 100 })}
                  />
                </>
              )}
            </InspectorSection>
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={reroll}
              disabled={busy}
              className="icon-btn"
              aria-label="Re-roll"
              title="Re-roll (⌘⇧R)"
            >
              <ShuffleIcon />
            </button>
            <ClickSpark>
              <button
                type="button"
                onClick={apply}
                disabled={busy}
                className="primary icon-btn"
                aria-label="Apply as wallpaper"
                title="Apply as wallpaper (⌘⏎)"
              >
                <CheckIcon />
              </button>
            </ClickSpark>
            <StatusInline status={status} error={error} />
          </>
        }
      />
    </div>
  );
}
