# Changelog

All notable changes to **Ambient** are tracked here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release script in `scripts/release.sh` reads the `[Unreleased]`
section below — when you cut a release, whatever's under Added /
Changed / Fixed becomes the GitHub release notes for that version,
gets stamped with the date, and a fresh empty `[Unreleased]` section
is added on top. Edit this file as you go, not at release time.

## [Unreleased]

### Added
- Floating bottom tab bar (Liquid Glass pill) that auto-sizes to its
  active label.
- Auto-rotation timer with two flavors: refresh from the current Source,
  or shuffle saved wallpapers (mutually exclusive, configurable per-tab).
- "Currently applied" indicator in Library; delete blocked on the active
  wallpaper.
- Output resolution selector in Generate (Auto, FHD, QHD, ultrawide, 4K,
  5K).
- Pollinations model picker (FLUX variants, Turbo, SDXL) and inline
  OpenAI key + model in Generate.
- Per-pattern fine controls: mesh bubbles/softness, geometric
  shape/fill, dots scatter/size-var, stripes angle/width-var.
- Bundled Inter Variable font — Linux no longer falls through to
  DejaVu/Liberation.
- Lucide-style icon set; primary actions are now icon-only with
  tooltips.

### Changed
- Settings tab removed — every setting now lives inside the tab it
  controls.
- Achromatic accent palette — lavender replaced with platform-neutral
  accents, matching macOS Tahoe Liquid Glass restraint.
- Per-platform font stack: SF on macOS, Segoe UI Variable on Win11,
  bundled Inter elsewhere.
- NASA APOD personal key field removed — single daily fetch never needs
  one.
- Pattern preset picker bundles light/dark palettes + matching emojis;
  preset stays selected until you customize a chip.
- Patterns "Randomness" slider removed; preview now matches apply
  WYSIWYG.
- Pattern type picker is a native Select.
- Window fixed at 820×600, non-resizable; maximize removed.
- macOS-only SVG turbulence refraction (other WebViews render it
  inconsistently).
- Rename `unsplashTopic` → `unsplashQuery` with a one-shot migration
  shim.
- Tray "Next wallpaper" item removed — rotation handles it
  automatically.

### Fixed
- Library delete now removes the file first, then the JSON entry —
  failed deletes no longer orphan files on disk.
- Library writes serialized + path-deduplicated — rotation can no
  longer resurrect a deleted entry.
- Library orphans (entries whose file is gone) pruned on mount.
- Tab-pill indicator measures from the active tab's layout — longer
  labels and localizations no longer overflow.
- Block native image/canvas drag and overscroll bounce that betrayed
  the WebView underneath.
- Cross-tab settings sync via custom event — toggling rotation in
  Library reflects in Sources immediately.

## [0.1.0] — 2026-05-15

Initial release.

### Added
- Five pattern generators (mesh gradients, geometric, dots, stripes,
  emoji wallpapers using Microsoft Fluent 3D)
- Curated photo sources: NASA APOD, Unsplash, Pexels (BYO API key for
  the latter two)
- AI generation via Pollinations (free) or OpenAI DALL-E 3 (BYOK)
- Local library of every applied wallpaper, re-apply or delete in one
  click
- Dark / light / auto theme mode for pattern palettes; auto follows
  the system color scheme
- Native Wayland on Linux (no XWayland), vibrancy on macOS, Mica on
  Windows
- License-key activation gate (Polar customer-portal API); $15 one-time
  purchase via Polar with no subscription, no telemetry, no account
- Update checker — polls
  `https://ambient.oezcan.me/downloads/latest.json`, throttled to once
  per 6h, shows a dismissible banner above the tab content when a
  newer version exists
