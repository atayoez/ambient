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
- "Follow system theme" toggle in Library: when on, the desktop
  wallpaper auto-switches whenever the OS flips between light and
  dark mode. The two slots populate passively — whatever wallpaper
  you apply in each mode becomes that mode's pick. Runs in the
  background even when the app is hidden to the tray.
- Categorized emoji picker popover (six themed categories: Cosmic,
  Nature, Animals, Faces, Food, Objects) replaces the standalone
  "paste an emoji string" text input. Click the "+" chip in the
  emoji-pattern palette to open it.
- SVG icons across the chrome: bottom tab pill swaps emoji labels
  for Palette / Image / Wand / LayoutGrid icons; the theme toggle
  swaps emoji glyphs for Sun / Moon / Auto-contrast.
- Page title now renders in the window titlebar (24px, semibold,
  centered) instead of as an h1 above each preview frame.
- `THIRD_PARTY_LICENSES.md` at the repo root covers the Inter
  variable font (SIL OFL 1.1) bundled in 0.2.0 and the Lucide-style
  icon geometry derivative.

### Changed
- Inspector sections (Pattern / Palette / Form / Shuffle / System
  theme) all render as visual tiles: bg + border + radius +
  drop-shadow, with the eyebrow heading inside.
- Library wallpaper cards get a soft drop-shadow that lifts on
  hover; preview frame, library-controls, and license card pick up
  matching shadow recipes.
- Form inputs (selects, text inputs, textareas, segmented controls,
  preset chips, color swatches, checkboxes, slider tracks) all
  share the same glass-pill material now — low-alpha tint +
  backdrop blur + subtle white border + drop-shadow + inset
  top-sheen. Corners match between nested pills (active-tab
  indicator inside the tabs pill, segment buttons inside segmented
  containers).
- Color picker swatch fills the entire pill (was previously sitting
  inside its own native padding + inner border).
- Bottom tab pill: transparent glass, no dark tint, subtle border +
  smaller drop-shadow than before. Click-tracking + visual identity
  preserved via the inner active-tab indicator.
- Emoji and color chips: same pill geometry (circle), same
  drop-shadow recipe — they read as a single chip family now.
- Textareas use a smaller 12px corner radius instead of full pill
  geometry (full pill was clipping multi-line text on expansion).
- WandIcon redesigned to Lucide's wand — the previous design had
  the diagonal stick mis-aligning with the 4-pointed star.
- `.tabs` no longer carries `backdrop-filter` blur — it was
  frosting Library card images behind the pill and reading as
  "not transparent."

### Fixed
- First-mount tab indicator no longer visibly animates from the
  88px fallback width to its measured value on app open.
  Transition is disabled until `App.tsx` confirms the first
  measurement has committed.
- Bottom tab pill no longer paints a horizontal dark strip at the
  bottom of the window — that was the `0 12px 32px` drop-shadow
  fading below the pill; replaced with a smaller `0 4px 12px`.
- `.content` bottom padding (was reserving space for an opaque
  pill) is gone, so the visual strip between scrolled content and
  the floating pill disappears.
- Emoji picker no longer overflows the 820px window when the "+"
  trigger lands near the right edge of the inspector — switched
  from button-anchored absolute positioning to viewport-fixed
  centered.
- Dropdowns no longer carry the lavender-stroked chevron SVG
  (legacy from the pre-achromatic palette).
- Dropdown corners now match the bottom pill's corners (both full
  pill radius, capped at half-height per element).

### Removed
- All cursor-driven and tab-switch-driven chrome animations:
  parallax tilt on `.tabs` / `.preview-wrap` / `.license-card`,
  BlurText fade on page titles, ShinyText sweep on UpdateBanner,
  ClickSpark radial pulse on apply buttons, AnimatedListItem
  stagger on Library mount, SpotlightCard hover glow on Library
  cards, the hover spotlight `.has-spotlight` mechanism on every
  surface, `.app::before` cursor specular + `.app::after` diagonal
  shimmer. Standing rule: no JS-driven motion in the chrome.
- ImageBleed halo around image previews: in light mode the dark
  preview painted a dark cloud bleeding into the inspector column;
  removed pending future revisit.
- React Bits dependency tree: BlurText, ClickSpark, SpotlightCard,
  AnimatedListItem, ShinyText component files all deleted, `motion`
  package uninstalled, React Bits attribution removed from
  `THIRD_PARTY_LICENSES.md`.
- Heavy `backdrop-filter: blur(...) [url(#liquid-refract)]` chain
  on `.app`: opaque base now, SVG turbulence filter in `index.html`
  deleted. Significant GPU cost reduction on integrated graphics +
  WebKitGTK.
- Selection outline / accent halo focus rings on every surface
  except the bottom tab pill's `.tab-indicator`. Border-color shift
  on focus is the only remaining keyboard cue for non-tab elements.

## [0.2.0] — 2026-05-16

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
