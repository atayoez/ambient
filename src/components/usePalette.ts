// Palette management for the Patterns tab, extracted from Patterns.tsx so
// the component keeps to layout + the apply/preview pipeline. Owns:
//
// - the user's saved palettes (Rust-owned settings.customPresets — loaded
//   once, mutated optimistically + patched through)
// - preset resolution across the three sources (live system-accent preset,
//   custom palettes, curated COLOR_PRESETS) and the picker's display order
// - the palette/emoji edit handlers (every direct edit clears
//   colorPresetId so the theme swap leaves user customization alone)
// - the theme-swap effect (re-applies the active preset's light/dark
//   variant when the resolved theme flips)

import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COLOR_PRESETS,
  type ColorPreset,
  type CustomPreset,
  customToColorPreset,
  getPreset,
  MAX_COLORS,
  MIN_COLORS,
  type PatternConfig,
  randomPalette,
  SYSTEM_PRESET_ID,
} from '../lib/patterns';
import { loadSettings, patchSettings } from '../lib/store';

export interface DisplayPreset {
  preset: ColorPreset;
  removable: boolean;
}

export interface UsePalette {
  /** Picker order: system accent → custom (deletable) → curated. */
  displayPresets: DisplayPreset[];
  /** The custom palette currently selected, if any (drives rename UI). */
  activeCustom: CustomPreset | undefined;
  resolvePreset: (id: string | undefined) => ColorPreset | undefined;
  applyPreset: (id: string) => void;
  savePalette: () => void;
  deleteCustomPreset: (id: string) => void;
  renameCustomPreset: (id: string, name: string) => void;
  setColor: (i: number, color: string) => void;
  addColor: () => void;
  removeColor: (i: number) => void;
  addEmoji: (emoji: string) => void;
  removeEmoji: (i: number) => void;
  replaceEmoji: (i: number, emoji: string) => void;
  rerollColors: () => void;
}

export function usePalette(opts: {
  config: PatternConfig;
  setConfig: Dispatch<SetStateAction<PatternConfig>>;
  patch: (p: Partial<PatternConfig>) => void;
  effectiveDark: boolean;
  /** Accent-derived "System" preset, when the platform exposes one. */
  systemPreset: ColorPreset | null;
}): UsePalette {
  const { config, setConfig, patch, effectiveDark, systemPreset } = opts;

  // User-saved palettes (colors + emojis) — real data, so Rust-owned
  // settings (not the localStorage draft KV). Loaded once on mount;
  // edits update local state and patch settings. Patterns is the only
  // editor, so no settings-changed subscription is needed. `setCustomPresets`
  // keeps the functional-update signature the mutators below rely on.
  const [customPresets, setCustomPresetsState] = useState<CustomPreset[]>([]);
  const customPresetsRef = useRef<CustomPreset[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadSettings().then((s) => {
      if (cancelled) return;
      customPresetsRef.current = s.customPresets ?? [];
      setCustomPresetsState(s.customPresets ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const setCustomPresets = useCallback(
    (update: CustomPreset[] | ((prev: CustomPreset[]) => CustomPreset[])) => {
      const next =
        typeof update === 'function' ? update(customPresetsRef.current) : update;
      customPresetsRef.current = next;
      setCustomPresetsState(next);
      // patchSettings → Rust emits `settings-changed`, which App.tsx
      // forwards onto the typed bus — no manual dispatch needed.
      void patchSettings({ customPresets: next });
    },
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

  const displayPresets = useMemo<DisplayPreset[]>(
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

  // Re-apply the active preset's variant when the resolved theme flips.
  // Custom palettes (where the user manually edited a chip and
  // colorPresetId got cleared) survive the swap unchanged.
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
    if (config.colors.length >= MAX_COLORS) return;
    patch({
      colors: [...config.colors, '#ffffff'],
      colorPresetId: undefined,
    });
  }

  function removeColor(i: number) {
    if (config.colors.length <= MIN_COLORS) return;
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

  // Randomize just the colours — a fresh random palette tuned for the
  // current theme. Clears colorPresetId so it's treated as custom.
  function rerollColors() {
    patch({ colors: randomPalette(effectiveDark), colorPresetId: undefined });
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

  const activeCustom = customPresets.find((p) => p.id === config.colorPresetId);

  return {
    displayPresets,
    activeCustom,
    resolvePreset,
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
  };
}
