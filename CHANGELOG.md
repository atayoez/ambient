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

### Changed

### Fixed

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
