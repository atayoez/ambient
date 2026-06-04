import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemAccentColor } from '../lib/appHooks';
import { useDraftState, useKeydown, usePersistedState } from '../lib/hooks';
import {
  accentPreset,
  COLOR_PRESETS,
  type ColorPreset,
  type CustomPreset,
  customToColorPreset,
  DEFAULT_CONFIG,
  getPreset,
  PATTERN_TYPES,
  type PatternConfig,
  type PatternType,
  randomizedModifiers,
  randomPalette,
  renderPreview,
  SLIDER_RANGES,
  SYSTEM_PRESET_ID,
  TYPE_DEFAULTS,
} from '../lib/patterns';
import { isDarkForMode, type ThemeMode, useSystemDark } from '../lib/theme';
import { CheckIcon, PaletteIcon, PlusIcon, ShuffleIcon, XIcon } from './Icons';
import { ControlRow, StatusInline } from './layout';
import OptionScroller from './OptionScroller';
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

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const SHAPE_OPTIONS = [
  { id: 'mix', label: 'Mix' },
  { id: 'circles', label: 'Circles' },
  { id: 'triangles', label: 'Triangles' },
  { id: 'squares', label: 'Squares' },
  { id: 'hexagons', label: 'Hexagons' },
  { id: 'stars', label: 'Stars' },
  { id: 'plus', label: 'Plus' },
];

const FILL_OPTIONS = [
  { id: 'solid', label: 'Solid' },
  { id: 'outline', label: 'Outline' },
  { id: 'mix', label: 'Mix' },
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

  // OS accent → a live "System" palette prepended to the picker. Only
  // present when the platform exposes an accent (macOS/Windows always;
  // KDE/GNOME when configured) — otherwise the row is just the user's
  // custom palettes plus the seven curated themes.
  const accentHex = useSystemAccentColor();
  const systemPreset = useMemo<ColorPreset | null>(
    () => (accentHex ? accentPreset(accentHex) : null),
    [accentHex],
  );

  // User-saved palettes (colors + emojis), persisted under their own
  // store key so they outlive the draft config. Created via "Save
  // palette"; each is deletable from the picker.
  const [customPresets, setCustomPresets] = usePersistedState<CustomPreset[]>(
    'patterns.customPresets',
    [],
  );

  // Resolve a colorPresetId across all three sources: the live accent
  // preset, the user's custom palettes, then the curated built-ins.
  // Returns undefined when the id maps to nothing anymore (accent gone,
  // custom deleted) — callers treat that as "demote to a free palette".
  const resolvePreset = useCallback(
    (id: string | undefined): ColorPreset | undefined => {
      if (!id) return undefined;
      if (id === SYSTEM_PRESET_ID) return systemPreset ?? undefined;
      const custom = customPresets.find((p) => p.id === id);
      if (custom) return customToColorPreset(custom);
      return getPreset(id);
    },
    [systemPreset, customPresets],
  );

  // Picker order: system accent (when present) → custom palettes
  // (deletable) → curated set. `removable` drives the delete affordance.
  const displayPresets = useMemo(
    () => [
      ...(systemPreset ? [{ preset: systemPreset, removable: false }] : []),
      ...customPresets.map((c) => ({
        preset: customToColorPreset(c),
        removable: true,
      })),
      ...COLOR_PRESETS.map((p) => ({ preset: p, removable: false })),
    ],
    [systemPreset, customPresets],
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
  // Monotonic counter: every config/size change fires a fresh render and
  // claims a generation. Only the latest generation's result is allowed
  // to paint — stale renders are dropped here, and the Rust side
  // (PREVIEW_GEN) abandons superseded renders before encoding, so rapid
  // edits don't pile up work or show out-of-order frames.
  const previewGenRef = useRef(0);

  useEffect(() => {
    if (previewSize.w === 0 || previewSize.h === 0) return;
    // Debounce: a slider drag fires dozens of config changes; we only
    // want one render after motion settles. The timer resets on every
    // change, so we render ~90ms after the last edit. The gen guard +
    // Rust-side PREVIEW_GEN cancellation handle any that still overlap.
    const t = setTimeout(() => {
      const myGen = ++previewGenRef.current;
      void renderPreview(config, previewSize.w, previewSize.h)
        .then((dataUrl) => {
          if (myGen === previewGenRef.current) setPreviewUrl(dataUrl);
        })
        .catch(() => {
          // "preview superseded" or a transient failure — ignore; the
          // newest request will paint.
        });
    }, 90);
    return () => clearTimeout(t);
  }, [config, previewSize.w, previewSize.h]);

  // Re-apply the active preset's variant when the resolved theme flips.
  // Custom palettes (where the user manually edited a chip and
  // colorPresetId got cleared) survive the swap unchanged.
  const effectiveDark = isDarkForMode(themeMode, systemDark);
  useEffect(() => {
    setConfig((c) => {
      if (!c.colorPresetId) return c;
      const preset = resolvePreset(c.colorPresetId);
      // Active preset vanished (accent removed between launches, or a
      // custom palette deleted) → keep the current colors but drop the
      // dangling id, so it becomes a free palette instead of snapping
      // to a curated default on the next theme flip.
      if (!preset) return { ...c, colorPresetId: undefined };
      return { ...c, colors: [...(effectiveDark ? preset.dark : preset.light)] };
    });
  }, [effectiveDark, resolvePreset, setConfig]);

  function patch(p: Partial<PatternConfig>) {
    setConfig((c) => ({ ...c, ...p }));
  }

  function setType(id: PatternType) {
    patch({ type: id, ...TYPE_DEFAULTS[id] });
  }

  // Randomize re-rolls EVERY modifier the current generator exposes
  // (counts, sizes, knobs, shape/fill, swirl, …) plus the seed — not
  // just the seed. The set of randomized variables is kept in lockstep
  // with the exposed sliders via randomizedModifiers() in patterns.ts.
  function reroll() {
    patch({ ...randomizedModifiers(config.type), seed: randomSeed() });
  }

  // Randomize just the colours — a fresh random palette tuned for the
  // current theme. Clears colorPresetId so it's treated as custom.
  function rerollColors() {
    patch({ colors: randomPalette(effectiveDark), colorPresetId: undefined });
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

  // Emoji edits mark the palette custom too (matching the color-edit
  // handlers), so the theme swap leaves it alone and "Save palette"
  // lights up — a glyph tweak is as much a customization as a hue tweak.
  function removeEmoji(i: number) {
    if (config.emojis.length <= 1) return;
    patch({
      emojis: config.emojis.filter((_, idx) => idx !== i),
      colorPresetId: undefined,
    });
  }

  function addEmoji(emoji: string) {
    patch({ emojis: [...config.emojis, emoji], colorPresetId: undefined });
  }

  function replaceEmoji(i: number, emoji: string) {
    patch({
      emojis: config.emojis.map((x, idx) => (idx === i ? emoji : x)),
      colorPresetId: undefined,
    });
  }

  // Capture the current colors + emojis as a named, reusable palette.
  // Auto-named "Custom N" with N skipping any in-use number so deletes
  // don't produce duplicate labels. The new palette becomes active.
  function savePalette() {
    const used = new Set(customPresets.map((p) => p.name));
    let n = customPresets.length + 1;
    while (used.has(`Custom ${n}`)) n++;
    const preset: CustomPreset = {
      id: `custom-${crypto.randomUUID()}`,
      name: `Custom ${n}`,
      colors: [...config.colors],
      emojis: [...config.emojis],
    };
    setCustomPresets((list) => [...list, preset]);
    patch({ colorPresetId: preset.id });
  }

  function deleteCustomPreset(id: string) {
    setCustomPresets((list) => list.filter((p) => p.id !== id));
    // If the deleted palette was active, drop the dangling id but keep
    // its colors on screen (now a free palette).
    setConfig((c) => (c.colorPresetId === id ? { ...c, colorPresetId: undefined } : c));
  }

  function renameCustomPreset(id: string, name: string) {
    setCustomPresets((list) => list.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  // Selecting a preset sets BOTH the colors (light or dark variant for
  // the current theme) AND the emojis. The Emoji pattern type picks up
  // the new emojis on the next render; users who've customized the
  // emoji string after picking a preset will see those overwritten —
  // explicit re-pick = explicit reset.
  function applyPreset(id: string) {
    const preset = resolvePreset(id);
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

  const paletteOptions = displayPresets.map(({ preset }) => ({
    id: preset.id,
    label: preset.name,
    emoji: preset.emojis[0],
  }));
  const activeRemovable = displayPresets.some(
    (d) => d.removable && d.preset.id === config.colorPresetId,
  );
  // The custom palette currently selected (if any) — drives the rename
  // field below the palette scroller.
  const activeCustom = customPresets.find((p) => p.id === config.colorPresetId);

  return (
    <div className="patterns">
      {/* Full-bleed live preview is the backdrop; the floating glass
          panels refract it (real liquid glass), and the option pickers
          are arrow scrollers — the same shape as the marketing site. */}
      <div className="gen-stage" ref={previewWrapRef}>
        {previewUrl ? (
          <img className="gen-bg" src={previewUrl} alt="" />
        ) : (
          <div className="gen-bg gen-bg-empty" aria-hidden="true" />
        )}

        <div className="gen-panel pat-top">
          <OptionScroller
            label="Pattern"
            options={PATTERN_TYPES.map((t) => ({
              id: t.id,
              label: t.name,
              emoji: t.emoji,
            }))}
            value={config.type}
            onChange={setType}
            ariaLabel="Pattern type"
          />
          <OptionScroller
            label="Theme"
            options={THEME_OPTIONS}
            value={themeMode}
            onChange={setThemeMode}
            ariaLabel="Theme mode"
          />
        </div>

        <div className="gen-panel pat-side" inert={busy || undefined}>
          <div className="pat-palette-row">
            <OptionScroller
              label="Palette"
              options={paletteOptions}
              value={config.colorPresetId ?? ''}
              onChange={applyPreset}
              ariaLabel="Palette"
            />
            {activeRemovable && config.colorPresetId && (
              <button
                type="button"
                className="pat-del"
                onClick={() => deleteCustomPreset(config.colorPresetId as string)}
                aria-label="Delete palette"
                title="Delete palette"
              >
                <XIcon size={12} />
              </button>
            )}
          </div>

          {activeCustom && (
            <input
              className="palette-rename"
              type="text"
              value={activeCustom.name}
              onChange={(e) => renameCustomPreset(activeCustom.id, e.target.value)}
              aria-label="Rename palette"
              placeholder="Palette name"
            />
          )}

          {/* Colour roles: colors[0] is the background fill, colors[1..]
              the foreground (shapes / dots / stripes / mesh blobs), and
              for the Emoji type the foreground is the glyph set. Splitting
              them makes the relationship explicit instead of a flat list
              where "the first one is secretly the background". */}
          <div className="role-bg">
            <span className="role-label">Background</span>
            <div className="color-chip role-bg-chip">
              <input
                type="color"
                value={config.colors[0] ?? '#000000'}
                onChange={(e) => setColor(0, e.target.value)}
                aria-label="Background color"
              />
            </div>
          </div>

          <span className="role-label">
            {config.type === 'emoji' ? 'Emoji' : 'Foreground'}
          </span>
          <PaletteEditor
            type={config.type}
            colors={config.colors.slice(1)}
            emojis={config.emojis}
            onColorChange={(i, c) => setColor(i + 1, c)}
            onAddColor={addColor}
            onRemoveColor={(i) => removeColor(i + 1)}
            onAddEmoji={addEmoji}
            onReplaceEmoji={replaceEmoji}
            onRemoveEmoji={removeEmoji}
          />

          <button
            type="button"
            className="save-palette"
            onClick={savePalette}
            disabled={config.colorPresetId !== undefined}
            title={
              config.colorPresetId !== undefined
                ? 'Edit the colors or emojis to save them as a custom palette'
                : 'Save the current colors + emojis as a reusable palette'
            }
          >
            <PlusIcon size={12} />
            <span>Save palette</span>
          </button>

          <div className="pat-sliders">
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
                <OptionScroller
                  label="Shape"
                  options={SHAPE_OPTIONS}
                  value={(config.geometricShape ?? 'mix') as string}
                  onChange={(v) =>
                    patch({ geometricShape: v as PatternConfig['geometricShape'] })
                  }
                  ariaLabel="Shape"
                />
                <OptionScroller
                  label="Fill"
                  options={FILL_OPTIONS}
                  value={(config.geometricFill ?? 'solid') as string}
                  onChange={(v) =>
                    patch({ geometricFill: v as PatternConfig['geometricFill'] })
                  }
                  ariaLabel="Fill"
                />
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
            {config.type === 'flower' && (
              <>
                <ControlRow
                  label="Petals"
                  value={config.flowerPetals ?? 12}
                  min={5}
                  max={40}
                  onChange={(v) => patch({ flowerPetals: v })}
                />
                <ControlRow
                  label="Swirl"
                  value={Math.round((config.flowerTwist ?? 0.5) * 100)}
                  suffix="%"
                  min={0}
                  max={100}
                  onChange={(v) => patch({ flowerTwist: v / 100 })}
                />
              </>
            )}
            {config.type === 'flow' && (
              <>
                <ControlRow
                  label="Lines"
                  value={config.flowLines ?? 28}
                  min={6}
                  max={120}
                  onChange={(v) => patch({ flowLines: v })}
                />
                <ControlRow
                  label="Amplitude"
                  value={Math.round((config.flowAmplitude ?? 0.5) * 100)}
                  suffix="%"
                  min={0}
                  max={100}
                  onChange={(v) => patch({ flowAmplitude: v / 100 })}
                />
                <ControlRow
                  label="Frequency"
                  value={Math.round((config.flowFrequency ?? 0.4) * 100)}
                  suffix="%"
                  min={0}
                  max={100}
                  onChange={(v) => patch({ flowFrequency: v / 100 })}
                />
              </>
            )}
            {config.type === 'waves' && (
              <>
                <ControlRow
                  label="Layers"
                  value={config.wavesLayers ?? 7}
                  min={3}
                  max={20}
                  onChange={(v) => patch({ wavesLayers: v })}
                />
                <ControlRow
                  label="Amplitude"
                  value={Math.round((config.wavesAmplitude ?? 0.5) * 100)}
                  suffix="%"
                  min={0}
                  max={100}
                  onChange={(v) => patch({ wavesAmplitude: v / 100 })}
                />
                <ControlRow
                  label="Frequency"
                  value={Math.round((config.wavesFrequency ?? 0.4) * 100)}
                  suffix="%"
                  min={0}
                  max={100}
                  onChange={(v) => patch({ wavesFrequency: v / 100 })}
                />
              </>
            )}
            {config.type === 'aurora' && (
              <>
                <ControlRow
                  label="Bands"
                  value={config.auroraBands ?? 5}
                  min={3}
                  max={14}
                  onChange={(v) => patch({ auroraBands: v })}
                />
                <ControlRow
                  label="Spread"
                  value={Math.round((config.auroraSpread ?? 0.5) * 100)}
                  suffix="%"
                  min={0}
                  max={100}
                  onChange={(v) => patch({ auroraSpread: v / 100 })}
                />
                <ControlRow
                  label="Sway"
                  value={Math.round((config.auroraAmplitude ?? 0.5) * 100)}
                  suffix="%"
                  min={0}
                  max={100}
                  onChange={(v) => patch({ auroraAmplitude: v / 100 })}
                />
              </>
            )}

            {/* Randomizers live in the control pane — both are
                per-pattern now (the modifiers + the palette), not global
                actions, so they sit with the knobs they re-roll. */}
            <div className="pat-randomize">
              <button
                type="button"
                onClick={reroll}
                disabled={busy}
                className="randomize-btn"
                title="Randomize pattern (⌘⇧R)"
              >
                <ShuffleIcon />
                <span>Shuffle</span>
              </button>
              <button
                type="button"
                onClick={rerollColors}
                disabled={busy}
                className="randomize-btn"
                title="Randomize colors"
              >
                <PaletteIcon />
                <span>Colors</span>
              </button>
            </div>
          </div>
        </div>

        <div className="pat-actions">
          <StatusInline status={status} error={error} />
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
        </div>
      </div>
    </div>
  );
}
