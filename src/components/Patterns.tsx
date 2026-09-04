import { useEffect, useMemo, useRef, useState } from 'react';
import { useAnimationSpeed, useSettings, useSystemAccentColor } from '../lib/appHooks';
import {
  useDebouncedValue,
  useDraftState,
  useKeydown,
  usePersistedState,
} from '../lib/hooks';
import {
  ANIMATABLE,
  accentPreset,
  COLOR_PRESETS,
  type ColorPreset,
  DEFAULT_CONFIG,
  getPreset,
  type KnobSpec,
  PATTERN_TYPES,
  type PatternConfig,
  type PatternType,
  randomizedModifiers,
  renderPreview,
  TYPE_DEFAULTS,
  TYPE_SPECS,
} from '../lib/patterns';
import { isDarkForMode, type ThemeMode, useSystemDark } from '../lib/theme';
import {
  ControlRow,
  IconButton,
  OptionScroller,
  SegmentedIcons,
  StatusInline,
} from '../ui';
import ClockOverlay from './ClockOverlay';
import EmojiField from './EmojiField';
import { CheckIcon, PaletteIcon, PlusIcon, ShuffleIcon, XIcon } from './Icons';
import LivePreview from './LivePreview';
import PaletteEditor from './PaletteEditor';
import SpeedSlider from './SpeedSlider';
import { THEME_MODE_OPTIONS } from './themeOptions';
import { useApplyPattern } from './useApplyPattern';
import { usePalette } from './usePalette';

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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// One manifest knob → its control. Enum knobs render an OptionScroller
// (choice order = shader wire code, from the manifest), free-text knobs
// a text input, numeric knobs a slider. `scale` maps 0-1 stored values
// onto 0-100 "%" sliders; `unit` is a display suffix only. Adding a knob
// to patternManifest.json is all it takes to get UI, Randomize coverage,
// and shader packing — nothing per-type lives here anymore.
function KnobControl({
  knob,
  config,
  patch,
}: {
  knob: KnobSpec;
  config: PatternConfig;
  patch: (p: Partial<PatternConfig>) => void;
}) {
  const raw = (config as unknown as Record<string, unknown>)[knob.key] ?? knob.default;
  if (knob.choices) {
    return (
      <OptionScroller
        label={knob.label}
        options={knob.choices}
        value={(raw ?? '') as string}
        onChange={(v) => patch({ [knob.key]: v } as Partial<PatternConfig>)}
        ariaLabel={knob.label}
      />
    );
  }
  if (knob.kind === 'text') {
    return (
      <input
        type="text"
        className="matrix-text"
        value={(raw as string | undefined) ?? ''}
        onChange={(e) => patch({ [knob.key]: e.target.value } as Partial<PatternConfig>)}
        placeholder={knob.placeholder}
        maxLength={knob.maxLength}
        spellCheck={false}
        aria-label={knob.label}
      />
    );
  }
  const scale = knob.scale ?? 1;
  const min = (knob.min ?? 0) * scale;
  const max = (knob.max ?? 1) * scale;
  const value = typeof raw === 'number' ? raw : 0;
  return (
    <ControlRow
      label={knob.label}
      value={clamp(Math.round(value * scale), min, max)}
      suffix={knob.unit}
      min={min}
      max={max}
      onChange={(v) => patch({ [knob.key]: v / scale } as Partial<PatternConfig>)}
    />
  );
}

// `active` — whether this is the visible tab. Tabs stay mounted after
// their first visit, so the window-level shortcuts below must only be
// live while this tab is the one on screen.
export default function Patterns({ active = true }: { active?: boolean }) {
  const systemDark = useSystemDark();
  const [themeMode, setThemeMode] = usePersistedState<ThemeMode>(
    'patterns.themeMode',
    'auto',
  );
  // When on, Apply sets a live (animated) wallpaper instead of a still —
  // generative types animate via their shader, the rest via a slow drift.
  const [animated, setAnimated] = usePersistedState<boolean>('patterns.animated', false);
  // Read-only here: the live-clock overlay mirrors Settings → Desktop so the
  // preview shows the clock where the desktop will draw it. Subscribed so a
  // change made on the Settings tab shows up without a remount.
  const [settings] = useSettings({ subscribe: true });
  // Global animation speed — the slider in the knob pane (below) writes it,
  // the live preview reads it, so the preview moves exactly like the desktop.
  const [speed] = useAnimationSpeed();
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

  // The theme that palette variants resolve against (auto follows the OS).
  const effectiveDark = isDarkForMode(themeMode, systemDark);

  // Apply pipeline (busy/status + the render-save-set flow). Terminal
  // outcomes surface as toasts; `status` is just in-progress text.
  const { busy, status, apply, applyLive } = useApplyPattern(config, saveConfig);

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
  // Debounced copy of the config for every expensive preview consumer
  // (static IPC render, WebGL live preview, emoji field): controls stay
  // bound to `config` for instant feedback, previews update once ~90ms
  // after the last edit instead of on every input event.
  const previewConfig = useDebouncedValue(config, 90);
  // Monotonic counter: every config/size change fires a fresh render and
  // claims a generation. Only the latest generation's result is allowed
  // to paint — stale renders are dropped here, and the Rust side
  // (PREVIEW_GEN) abandons superseded renders before encoding, so rapid
  // edits don't pile up work or show out-of-order frames.
  const previewGenRef = useRef(0);

  useEffect(() => {
    if (previewSize.w === 0 || previewSize.h === 0) return;
    const myGen = ++previewGenRef.current;
    void renderPreview(previewConfig, previewSize.w, previewSize.h)
      .then((dataUrl) => {
        if (myGen === previewGenRef.current) setPreviewUrl(dataUrl);
      })
      .catch(() => {
        // "preview superseded" or a transient failure — ignore; the
        // newest request will paint.
      });
  }, [previewConfig, previewSize.w, previewSize.h]);

  function patch(p: Partial<PatternConfig>) {
    setConfig((c) => ({ ...c, ...p }));
  }

  function setType(id: PatternType) {
    patch({ type: id, ...TYPE_DEFAULTS[id] });
  }

  // Everything palette: saved custom presets (Rust-owned settings),
  // preset resolution/picker order, edit handlers, the theme-variant
  // swap, and the color reroll. See usePalette.ts.
  const {
    displayPresets,
    activeCustom,
    applyPreset,
    savePalette,
    deleteCustomPreset,
    renameCustomPreset,
    setColor,
    addColor,
    removeColor,
    addEmoji,
    removeEmoji,
    replaceEmoji,
    rerollColors,
  } = usePalette({ config, setConfig, patch, effectiveDark, systemPreset });

  // Randomize re-rolls EVERY modifier the current generator exposes
  // (counts, sizes, knobs, shape/fill, swirl, …) plus the seed — not
  // just the seed. The set of randomized variables is kept in lockstep
  // with the exposed sliders via randomizedModifiers() in patterns.ts.
  function reroll() {
    patch({ ...randomizedModifiers(config.type), seed: randomSeed() });
  }

  // Cmd/Ctrl+Enter applies, Cmd/Ctrl+Shift+R re-rolls. Apple desktop
  // staples — Cmd+R itself is avoided since some webviews still treat
  // it as a reload. Only live while this is the visible tab.
  useKeydown('Enter', () => void (animated ? applyLive() : apply()), {
    cmdOrCtrl: true,
    enabled: active,
  });
  useKeydown('r', () => reroll(), { cmdOrCtrl: true, shift: true, enabled: active });

  const paletteOptions = displayPresets.map(({ preset }) => ({
    id: preset.id,
    label: preset.name,
  }));
  const activeRemovable = displayPresets.some(
    (d) => d.removable && d.preset.id === config.colorPresetId,
  );
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
        {/* When Animate is on: generative types run the live WebGL canvas
            (same shader as the wallpaper) and Emoji runs the animated glyph
            field — every pattern type is one or the other. Each overlay is
            opaque and covers the still beneath it. Both consume the
            DEBOUNCED config so a fast slider drag costs one update, not
            one per input event. */}
        {animated && ANIMATABLE.includes(previewConfig.type) && (
          <LivePreview config={{ ...previewConfig, speed }} className="gen-bg" />
        )}
        {animated && previewConfig.type === 'emoji' && (
          <EmojiField config={{ ...previewConfig, speed }} className="gen-bg" />
        )}
        {animated && settings?.liveClock.enabled && (
          <ClockOverlay clock={settings.liveClock} background={previewConfig.colors[0]} />
        )}

        <div className="gen-panel pat-top">
          <OptionScroller
            label="Pattern"
            options={PATTERN_TYPES.map((t) => ({ id: t.id, label: t.name }))}
            value={config.type}
            onChange={setType}
            ariaLabel="Pattern type"
          />
          {/* Palette selector lives in the top tray (left), with the
              fine palette editing in the side panel. */}
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
          {/* Wrapped in the scroller column so its eyebrow + control line
              up with the Pattern / Palette pickers beside it. */}
          <div className="opt-scroller">
            <span className="opt-scroller-eyebrow">Theme</span>
            <SegmentedIcons
              options={THEME_MODE_OPTIONS}
              value={themeMode}
              onChange={setThemeMode}
              ariaLabel="Theme mode"
            />
          </div>
        </div>

        <div className="gen-panel pat-side" inert={busy || undefined}>
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
            {(TYPE_SPECS[config.type]?.knobs ?? []).map((k) => (
              <KnobControl key={k.key} knob={k} config={config} patch={patch} />
            ))}
            {/* Animation speed sits with the knobs while Animate is on: it
                shapes the motion the preview shows, and it is the one control
                every animated pattern shares (shaders, emoji, still drift). */}
            {animated && <SpeedSlider />}

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
          <StatusInline status={status} />
          {/* One Apply button; the Animate toggle decides whether it sets a
              live (animated) wallpaper or a static one. */}
          <label className="pat-anim">
            <span>Animate</span>
            <span className="switch">
              <input
                type="checkbox"
                checked={animated}
                onChange={(e) => setAnimated(e.target.checked)}
                aria-label="Animate the wallpaper"
              />
              <span className="switch-track" />
            </span>
          </label>
          <IconButton
            variant="primary"
            onClick={animated ? applyLive : apply}
            disabled={busy}
            label={animated ? 'Apply animated wallpaper' : 'Apply as wallpaper'}
            title="Apply as wallpaper (⌘⏎)"
          >
            <CheckIcon />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
