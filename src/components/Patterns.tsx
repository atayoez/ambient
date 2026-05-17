import { useEffect, useRef, useState } from 'react';
import { useDraftState, useKeydown, usePersistedState } from '../lib/hooks';
import {
  COLOR_PRESETS,
  DEFAULT_CONFIG,
  getPreset,
  PATTERN_TYPES,
  type PatternConfig,
  type PatternType,
  renderPreview,
  SLIDER_RANGES,
  TYPE_DEFAULTS,
} from '../lib/patterns';
import { isDarkForMode, type ThemeMode, useSystemDark } from '../lib/theme';
import { AutoThemeIcon, CheckIcon, MoonIcon, ShuffleIcon, SunIcon } from './Icons';
import {
  ControlRow,
  InspectorSection,
  Segmented,
  Select,
  StatusInline,
  TabLayout,
} from './layout';
import PaletteEditor from './PaletteEditor';
import { useApplyPattern } from './useApplyPattern';

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
  { id: 'auto' as const, label: 'Auto', icon: <AutoThemeIcon size={16} /> },
  { id: 'light' as const, label: 'Light', icon: <SunIcon size={16} /> },
  { id: 'dark' as const, label: 'Dark', icon: <MoonIcon size={16} /> },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export default function Patterns() {
  const systemDark = useSystemDark();
  const [themeMode, setThemeMode] = usePersistedState<ThemeMode>(
    'patterns.themeMode',
    'auto',
  );
  // patterns.config is draft state: tweaks live in memory only until
  // the user clicks Apply, which calls saveConfig() to commit. Slider
  // drags don't thrash the disk; tab switch without applying drops
  // any unapplied tweaks.
  const [config, setConfig, saveConfig] = useDraftState<PatternConfig>(
    'patterns.config',
    pickInitialConfig(isDarkForMode('auto', systemDark)),
  );

  // Apply pipeline (busy/status/error + the render-save-set flow).
  const { busy, status, error, apply } = useApplyPattern(config, saveConfig);

  // Preview wrapper element + measured pixel size. We pass the live
  // CSS size × devicePixelRatio to the Rust renderer so the image
  // arrives at exactly the displayed pixel grid — no browser scaling
  // (which used to make dots look mushy + made geometric shape counts
  // unreadable in preview vs apply).
  const previewWrapRef = useRef<HTMLDivElement>(null);
  // Default to 1280×720 (16:9 at 1.5K) so the render attempts on first
  // mount even before the ResizeObserver has reported a real size —
  // otherwise on slow HMR or weird layout timing we'd sit with a blank
  // preview waiting for measurement that never comes.
  const [previewSize, setPreviewSize] = useState({ w: 1280, h: 720 });

  useEffect(() => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setPreviewSize((prev) => {
        const next = {
          w: Math.round(rect.width * dpr),
          h: Math.round(rect.height * dpr),
        };
        if (prev.w === next.w && prev.h === next.h) return prev;
        return next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Preview pipeline. Rust renders at monitor resolution and downscales
  // to the wrapper size, then ships back a data:image/jpeg;base64,…
  // URL that binds straight to <img src>.
  //
  // Single-worker pattern: only one Rust render runs at a time. If the
  // user keeps changing config mid-render, the latest version is stashed
  // in pendingRef and consumed when the current render finishes. This
  // gives O(1) renders per "drag burst" rather than one per slider tick,
  // which kept the tokio blocking pool from piling up while still
  // feeling responsive — the last frame the user sees is always current.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef<{
    config: PatternConfig;
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    if (previewSize.w === 0 || previewSize.h === 0) return;
    pendingRef.current = { config, w: previewSize.w, h: previewSize.h };
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    void (async () => {
      while (pendingRef.current) {
        const job = pendingRef.current;
        pendingRef.current = null;
        try {
          const dataUrl = await renderPreview(job.config, job.w, job.h);
          setPreviewUrl(dataUrl);
        } catch (e) {
          console.warn('[Patterns] preview render failed:', e);
        }
      }
      inFlightRef.current = false;
    })();
  }, [config, previewSize.w, previewSize.h]);

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

  function addEmoji(emoji: string) {
    patch({ emojis: [...config.emojis, emoji] });
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
        preview={
          // Inlined .preview-wrap so we can put a ref on the element
          // and measure it for the renderPreview call. Other tabs
          // (Sources, Generate) still use the PreviewFrame helper.
          <div className="preview-wrap" ref={previewWrapRef}>
            {previewUrl ? <img src={previewUrl} alt="" /> : null}
          </div>
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
              <PaletteEditor
                type={config.type}
                colors={config.colors}
                emojis={config.emojis}
                onColorChange={setColor}
                onAddColor={addColor}
                onRemoveColor={removeColor}
                onAddEmoji={addEmoji}
                onRemoveEmoji={removeEmoji}
              />
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
                        { id: 'hexagons', label: 'Hexagons' },
                        { id: 'stars', label: 'Stars' },
                        { id: 'plus', label: 'Plus' },
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
            <StatusInline status={status} error={error} />
          </>
        }
      />
    </div>
  );
}
