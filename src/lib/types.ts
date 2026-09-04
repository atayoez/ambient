// Wire types for the Rust-owned state. GENERATED from the Rust structs in
// src-tauri/core/src/types.rs by ts-rs (see the TS derives there) into
// src/lib/generated/ — this file just re-exports them, plus the few
// TS-only helper unions. Regenerate with `bun run gen:types` after
// changing the Rust types; nothing here is hand-mirrored anymore.
//
// Semantics worth knowing (details on the Rust structs):
// - Settings: Rust owns defaults (impl Default + serde field defaults) —
//   get_settings always returns a fully-populated object, so TS holds
//   `Settings | null` until the first load (useSettings in appHooks.ts).
// - Settings.rotationSource: 'off' = no auto-rotation; 'sources'/'library'
//   pick the fetch pool. Mutually exclusive, flipped by the two tabs.
// - Settings.themeMode drives the rotation/"Next" pools via each
//   wallpaper's light/dark `mode` tag.
// - Settings.lastApplied / lastPattern are stamped by Rust on apply; the
//   webview only reads lastApplied (Library's "currently applied" badge).
// - Wallpaper.source is a free-form origin label ("nasa-apod" |
//   "unsplash" | … | "generated"); no code branches on it.

export type { ClockPosition } from './generated/ClockPosition';
export type { GenProvider } from './generated/GenProvider';
export type { LiveClock } from './generated/LiveClock';
export type { LiveQuality } from './generated/LiveQuality';
export type { RotationSource } from './generated/RotationSource';
export type { Settings } from './generated/Settings';
export type { SourceKind } from './generated/SourceKind';
export type { Wallpaper } from './generated/Wallpaper';
export type { WallpaperMode } from './generated/WallpaperMode';

// TS-only: the resolution presets offered by the Generate tab. The Rust
// side keeps gen_resolution a free-form string on purpose — a new option
// added here must not be rejected by a stale Rust enum.
export type GenResolution =
  | 'auto'
  | '1920x1080'
  | '2560x1440'
  | '3440x1440'
  | '3840x2160'
  | '5120x2880';
