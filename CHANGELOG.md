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
- **HDR wallpaper output.** Pattern apply writes a 10-bit AVIF
  alongside the PNG: BT.2020 primaries, PQ (ST.2084) transfer, and a
  smooth highlight-boost curve that pushes max-channel pixels above
  the SDR 100-nit ceiling toward ~400 nits. HDR monitors light up
  bright pattern highlights past SDR peak; SDR monitors automatically
  fall back to the PNG sibling. `set_wallpaper` prefers the `.avif`
  when present, transparently falls back to the `.png` if the OS
  rejects AVIF. tiny-skia is still 8-bit internally so this isn't a
  full float-color pipeline (flagged for a later iteration) but the
  output file is genuine HDR with correct container metadata.
- **16-bit lossless PNG** for the Pattern apply path (was 8-bit).
  Lanczos3 downscale from the 4× SSAA intermediate produces fractional
  sub-byte values; saving them at 16-bit per channel eliminates the
  banding the old 8-bit save introduced in mesh gradients.
- **Tray "Next wallpaper" menu item** — advance the wallpaper without
  reopening the window. Works in tray-only state because rotation
  itself is now a Rust tokio task.
- **Pattern shapes: hexagons, stars (5-point), plus.** Geometric mode
  now has 7 base shapes (was 4). Mix mode draws from the full set
  including rotated squares, triangles, and lines.
- **OS keyring storage for BYO API keys.** Unsplash / Pexels / OpenAI
  keys live in macOS Keychain / Windows Credential Manager / libsecret
  on Linux (with a mode-0600 JSON fallback for headless setups). One-
  time migration on first launch lifts existing keys out of
  `ambient-settings.json`.
- **Pre-webview license gate.** Polar license validation happens in
  Rust `setup()` so the first frame already shows the right state —
  no more "loading" flash. Cached license valid <24h skips the
  network call; stale caches kick off a background revalidation that
  emits `license-revoked` if Polar explicitly rejects.
- **84 bundled Fluent 3D emojis** (was 41) — every glyph in every
  COLOR_PRESET ships in the binary so all preset emoji patterns
  render offline.
- **`render_preview` Tauri command** for the Patterns tab — WYSIWYG
  preview at the live `.preview-wrap` size × DPR, encoded as JPEG
  q75 base64 data URL.

### Changed
- **Massive Rust migration.** Settings, Library index, License,
  Sources HTTP (NASA / Unsplash / Pexels), AI generation (Pollinations
  / OpenAI), auto-rotation, theme-follow, and the Pattern renderer
  all moved from TypeScript to Rust:
  - Single `tokio::sync::RwLock<Settings>` replaces the
    `mutateSettings` / `mutateLibrary` Promise-chain workaround for
    cross-tab races.
  - Rotation + theme-follow run as background tokio tasks subscribed
    to the settings watch channel; both survive webview destroy/
    rebuild (the tray-only-mode-rotation bug is fixed).
  - License validation, source fetch, AI generation, image download
    all in `reqwest` from Rust — `tauri-plugin-http` removed entirely.
  - JS Canvas renderer deleted; tiny-skia + `image` crate handles
    every pattern type, with the LCG seed bit-exact to the old JS
    implementation so saved configs render identically.
- **Pattern preview is WYSIWYG with apply.** Same code path renders
  both, just at different sizes — the "preview shows 5 shapes but
  the wallpaper has 80" mismatch is gone.
- **Preview latency.** Single-worker pattern + JPEG transport +
  rendering at wrapper pixel size (× DPR, no browser scaling) +
  `image::imageops::fast_blur` instead of true Gaussian gives sub-
  100 ms render on the cold-cache first frame, ~30 ms after.
- **`apply_pattern` uses 4× SSAA** for non-emoji renders (was 2×),
  capped so the intermediate render stays under ~8K even on 5K
  monitors. Sharper edges on triangles, hexagons, stars, plus, and
  lines.
- **Apply notification + library-promote** are Rust side-effects of
  `desktop::set_wallpaper` now, not JS-orchestrated. Apply pipeline
  is one Tauri invoke from the frontend's perspective.
- **Typed in-process event bus** (`src/lib/events.ts`) replaces the
  string-based `'ambient-*'` CustomEvent surface. Rust mutations
  emit Tauri events; a single bridge in `App.tsx` forwards onto the
  typed bus so every consumer reacts uniformly.
- **`tauri-plugin-store` retired for Settings + Library**; persistence
  moved to Rust-owned `ambient-settings.json` / `ambient-library.json`
  files with atomic temp-file + rename writes. Per-tab draft state
  (`patterns.config`, `generate.prompt`, etc.) still uses the plugin.
- **`Cargo.toml` `[profile.dev.package."*"] opt-level = 3`** —
  third-party crates run at release speed even in `tauri dev`. First
  preview render dropped from 10+ seconds (debug `image::blur`) to
  sub-second.

### Fixed
- **Auto-rotation works in tray-only mode.** The pre-0.6 JS
  `setInterval` died the moment the user closed the window to tray
  (because the webview was destroyed). Rotation runs in Rust now.
- **Theme-follow works in tray-only mode.** Same story — the JS
  `matchMedia` listener died on tray-close. The Rust theme-check
  task polls every 5 minutes regardless of webview state.
- **Settings cross-tab clobber.** Multiple tabs writing partial
  settings used to race through the `mutate*` Promise chain;
  occasionally one tab's stale local copy would overwrite another
  tab's just-saved field. Rust's `RwLock<Settings>` serializes
  patches structurally.
- **Pattern dots blurry.** The old 0.85→1.0 radial-gradient fade was
  dominating tiny dots at low preview resolution and reading as a
  blur halo; switched to solid anti-aliased circles via
  `fill_path` — tiny-skia's edge AA handles the smoothing cleanly.
- **Dots density slider dead zone.** Values 6–7 were clamped to 8 in
  the renderer; the slider min is now 8 so every position changes
  the output.
- **Geometric / Mesh sliders.** Preview now renders at a useful
  resolution and uses `image::imageops::fast_blur` (was Gaussian
  blur, painfully slow in debug builds for the mesh softness range),
  so density/size/bubbles/softness changes are immediately visible.
- **Shape + Fill selectors centered** under the eyebrow label in the
  geometric pattern's inspector card (was left-aligned). The Shape
  picker also flex-wraps to a second row when the inspector is
  narrow.

## [0.5.0] — 2026-05-17

### Added
- **OS accent color** is read at launch and tints the entire chrome.
  macOS `AppleAccentColor`, Windows DWM `AccentColor`, and GNOME /
  COSMIC `accent-color` are parsed into both `--accent-os` (CSS color)
  and a new `--shadow-tint` RGB triplet on `<html>`. Every shadow,
  border, and previously-near-black fill across the app now flows
  through `rgb(var(--shadow-tint) / α)`, so primary buttons, focus
  rings, slider tracks, selection indicators, and even drop shadows
  follow the user's system accent. Default `0 0 0` triplet keeps the
  achromatic look on platforms without an accent.
- **Theme-aware tray icon.** macOS uses template-mode inversion
  automatically; Windows and GNOME/COSMIC detect the system theme at
  launch and ship the right-color glyph. The frontend's
  `useTrayThemeSync` calls a new `update_tray_theme` command on
  prefers-color-scheme flips so the icon stays in step while the
  window is open. Redesigned glyph: a filled landscape silhouette
  (mountain + foothill + sun) that survives the tray host's downscale
  to 16-22 px far better than the prior thin curve.
- **Library indicators on cards.** Currently-applied gets a check,
  the active light slot gets a sun, the dark slot gets a moon — all
  in the card's action bar, all sharing the accent ring. Icons stack
  when a card matches multiple slots.
- **Library list orders by most-recently-applied.** Every apply path
  (Library click, Patterns Apply, Sources fetch, Generate, rotation,
  tray) moves the entry to the head of the stored library. Sort is
  permanent — survives reopens.
- **Active tab persists** across reopens. Closing to tray and
  reopening (which destroys + rebuilds the webview) now lands you on
  the same tab.

### Changed
- **Hide-to-tray destroys the webview entirely** instead of just
  hiding it. WebKitGTK keeps GPU layers, decoded image cache, and
  backdrop-filter surfaces resident on `.hide()` — `nvidia-smi` after
  tray-close drops from ~200 MB to ~38 MB. Window rebuilds lazily on
  tray "Open Ambient" via `WebviewWindowBuilder::from_config`;
  `RunEvent::ExitRequested.prevent_exit` keeps the process alive
  after the last window closes so the tray icon survives.
- **Library theme-follow → Auto / Light / Dark segmented**, same
  shape as the Patterns palette mode picker. Auto follows system
  `prefers-color-scheme`; Light / Dark lock to that slot and the
  capture-on-apply target follows the mode. Replaces the verbose
  `ThemeFollowControl` (gone).
- **AI tab restructured.** Sections in order: Provider → Output →
  Model → Prompt → API key (only when OpenAI). Pollinations / OpenAI
  inner sections collapsed into a single Model section that switches
  its control by provider. Clarifying paragraphs under sections
  dropped.
- **Sources tab restructured.** Unsplash / Pexels combined sections
  split into separate "Search" (top, with the workflow) and
  "API key" (bottom, with setup). Inner field labels dropped —
  section titles carry the meaning.
- **Section titles centered** across all inspector tiles. Palette
  section's segmented + presets row also centered.
- **Rotation control collapsed into one row.** `☑ every [60] min`
  instead of a redundant "Auto-rotate from this source" sentence
  stacked above the interval. Disabled UI (interval + flanking text)
  fades to 0.4 opacity when the checkbox is off.
- **Tab pill icons stay light in light mode** with a drop-shadow
  halo so they read against the bright app surface on the
  Patterns / Sources / Generate tabs, not just over Library cards.
- **`patchSettings` / `mutateSettings`** added to `lib/store.ts` —
  serialized read-modify-write for settings, mirroring the existing
  `mutateLibrary`. Every settings update now only writes the fields
  it actually touched.

### Fixed
- **Theme mode no longer resets** after switching. Root cause was
  Sources / Generate / RotationControl saving their full local
  `Settings` copy on every update, which clobbered concurrent changes
  from other tabs (most visibly Library's `themeMode`). Fixed via
  `patchSettings` at every call site.
- **`useThemeFollow` stale-closure race** — the capture mode was
  bound at effect setup, so changing the mode and immediately
  applying a wallpaper captured into the wrong slot. The on-applied
  handler now reads the live `themeMode` from disk inside the
  mutator.

## [0.4.0] — 2026-05-16

### Added
- **Linux AppImage self-integrates on first launch.** Copies itself
  from wherever it was downloaded to `~/.local/bin/Ambient.AppImage`
  and writes a `com.ambient.app.desktop` entry + 512×512 icon under
  the XDG paths so the COSMIC / GNOME / KDE launcher discovers it
  without needing `appimaged` or `AppImageLauncher`. Idempotent across
  re-launches; downloads a fresh AppImage re-integrates to the new
  path.
- **OS notifications** when the wallpaper changes in the background.
  Auto-rotation + theme-follow events fire an OS toast via
  tauri-plugin-notification; foreground applies stay silent (the
  in-app status pill is enough). Permission requested once on first
  background event.
- **In-app updater** via tauri-plugin-updater. The "Update" button on
  the update banner now downloads the signed artifact, verifies its
  minisign signature against the embedded pubkey, replaces the binary,
  and relaunches — all in one click. Falls back to opening the
  download page on any failure.
- **Library thumbnail cache.** A new Rust command generates 480×300
  WebP thumbnails under `wallpapers/thumbs/` on first card render and
  reuses them on subsequent loads. Caps steady-state WebKit image
  memory for image-heavy libraries.
- **Windows aarch64 + Linux aarch64 builds** ship alongside the
  existing x86_64 / aarch64 (macOS) ones. Five artifacts per release.
- **Auto-detected primary download** on the marketing site. The
  Download section shows one big card for the visitor's OS + arch
  (Client Hints API on Chromium, UA parsing elsewhere) and tucks the
  other four behind a `<details>` disclosure.
- **Test harness.** `bun run test` runs Vitest (jsdom env, 5 tests
  for `isDarkForMode` + `dismissUpdate`); `cargo test --lib` runs
  Rust unit tests (10 tests for `safe_filename`, `thumbnail_path_for`,
  `first_wxh`, `strip_ansi`). CI runs both on every push.
- `docs/DEVELOPMENT.md` consolidates the dev/test/release commands.

### Changed
- **Patterns + Generate are draft-by-default.** Slider tweaks and
  prompt edits stay in memory; they persist to disk only when you
  click Apply ✓. License, library mutations, theme-follow, and
  rotation toggles continue to autosave (they were already discrete
  user actions).
- **Tabs stay mounted across switches** (lazy on first visit, sticky
  after). Switching Patterns → Library → Patterns no longer drops
  unapplied tweaks.
- **Windows installer switched from NSIS to MSI** (WiX-generated,
  native Windows 11 feel). NSIS-installed 0.3 users should uninstall
  the old version before installing 0.4.
- **Release artifacts renamed** to `Ambient-VERSION-{macOS,Windows,
  Linux}-{aarch64,x86_64}.{dmg,msi,AppImage}`.
- **CI build matrix gated to `workflow_dispatch`.** Only the cheap
  `check` job (tsc + biome + tests) runs on every push; the
  build-tauri matrix only fires when `scripts/release.sh` kicks it
  off. Saves macOS minutes (10× priced on free tier) per push.
- **Linux x86_64 builds locally** during release against the host's
  webkit2gtk-4.1 toolchain; Linux aarch64 builds on the native
  `ubuntu-22.04-arm` CI runner alongside the macOS / Windows jobs.
- **Release profile tuned** (LTO + strip + codegen-units=1 +
  panic=abort). Smaller binary, lower boot RSS, slightly faster cold
  start.
- **`src-tauri/src/lib.rs` split** into `desktop.rs` (wallpaper
  setter), `monitor.rs` (randr detection), `library.rs` (file
  management + thumbnail cache). lib.rs went from ~380 to 79 lines.
- **`App.tsx` extracted into hooks** (`lib/appHooks.ts`):
  useLicenseGate, useUpdateBanner, useAutoRotate, useThemeFollow,
  useWindowMaximized, useTabKeybindings. App.tsx went from 427 to
  212 lines.
- **`Patterns.tsx` split** into PaletteEditor (chip rows + emoji
  picker) and useApplyPattern (render-save-set pipeline). 700 to 466
  lines.
- **Shared `useDebouncedCallback` hook** in `lib/hooks.ts` replaces
  inline `saveDebounceRef` in Generate.tsx + Sources.tsx.
- **Library cards memoized** via `React.memo` with a custom
  comparator. 20+ cards stop re-rendering on every status / confirm
  flip.
- **AppImage filename** now includes `Linux-x86_64` / `Linux-aarch64`;
  embedded icon is the full 512×512 PNG (was 256×256), so file
  managers with libappimage thumbnailer render the right icon.
- **Website rebuilt around real app screenshots** captured from the
  live app (no more CSS-mocked tabs). Achromatic palette throughout
  (cosmic gradients retired) to match the app. Voice rewritten across
  en/de/tr — fewer em dashes, less press-release phrasing.
- **Legal pages updated**: TMG → DDG (Digitale-Dienste-Gesetz, replaced
  on 14 May 2024); TTDSG → TDDDG (renamed the same day). Impressum +
  Privacy fully translated to DE + TR via `data-i18n-html`. Privacy
  policy effective date bumped; the now-nonexistent free-trial form
  data flow removed from the data-processing section.
- **Pricing copy honest.** Dropped "Signed binaries with automatic
  updates" (which weren't actually signed) for "Free updates for life
  with in-app notifications". JSON-LD `softwareVersion` field bumped
  to match.

### Removed
- `flatpak/` directory + `.flatpak-builder/` cache + `build-flatpak`
  CI job + `flatpak:build` npm script. Was kept on ice for a future
  Flathub submission; pulled because that isn't on the near-term
  roadmap. Restore from git history if Flathub re-enters scope.
- `cosmic-app` git branch (local + `origin`).
- Manual fetch logic in `lib/updater.ts` — now wraps the plugin's
  `check()` for signature-verified update checks.

### Fixed
- Library thumbnails on a 20+ wallpaper library no longer spike WebKit
  image-cache memory to hundreds of MB worst case. The Rust thumbnail
  cache caps each card to ~30 KB on disk / ~10 MB decoded.

## [0.3.0] — 2026-05-16

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
