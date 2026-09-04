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

- **Live wallpapers on COSMIC** (and every other Wayland desktop with
  layer-shell: Sway, Hyprland, Niri, River, …). The animated pattern
  renders in a compositor-managed background surface, so it sits under
  every window and panel and comes back on its own after a restart or
  login. KDE Plasma keeps its native plugin; GNOME stays static-only.
- **macOS Intel build** (`Ambient-x.y.z-macOS-x86_64.dmg`) alongside Apple
  Silicon; the site's macOS card now has an architecture picker.
- **Live wallpapers on every monitor.** Linux gets one surface per output
  (and follows monitor hotplug); macOS one window per screen (rebuilt when
  displays are added, removed, or rearranged); Windows one window per
  monitor instead of a single canvas stretched across the virtual desktop.
- **Animation speed slider** (0.25× to 3×) in the Patterns pane whenever
  Animate is on, and in Settings → Desktop. It drives every animation — the
  shaders, the emoji drift and spin, the Ken Burns drift of stills — and the
  preview follows the slider live; the desktop updates as soon as you let go.
- **Live clock.** Settings → Desktop → Live clock puts the time (and
  optionally the date and seconds) on the live wallpaper — five positions,
  three sizes, 12/24-hour. The Patterns preview shows it in place, and it
  renders identically on KDE's plugin and the Windows/macOS/Linux windows.

### Changed

- Tooling: Bun 1.4 is the only JavaScript runtime the repo needs — the
  release scripts run on `bun` instead of Node, and the unit tests run on
  Bun's built-in test runner (Vitest, jsdom, and the coverage provider are
  gone; `bun run test:coverage` is built in).
- Releases are built by one native CI matrix — Linux, Windows, and macOS ×
  x86_64 and arm64 — instead of a mix of local cross-builds and a
  macOS-only CI job. A platform that fails to build keeps its previous
  release in the update feed; the others still ship.

### Fixed

- COSMIC: still wallpapers are scaled to cover each screen (no more
  stretching a photo to the monitor's aspect ratio), and patterns render at
  the largest connected monitor's resolution instead of whichever output
  happened to be listed first.
- Windows: the live wallpaper window was positioned by raw virtual-screen
  coordinates, which is off by the virtual-screen origin when a monitor sits
  left of or above the primary one.
- Applying a still while a live wallpaper is running now turns the live
  wallpaper off first (on Windows/macOS the still used to land underneath
  it, and auto-rotate stayed paused because settings still said "live").
- KDE: re-applying a live wallpaper (speed, quality, clock changes) no
  longer restarts plasmashell every time — the shell only reloads when the
  bundled plugin files actually changed.
- Live wallpapers on macOS are restored after a restart, like Windows
  (1.4.0) — one shared restore path now covers all three desktops.

## [1.4.0] — 2026-07-12

### Added

- **Cache limit setting** (default 2 GB, 0 = unlimited): oldest saved
  wallpapers, thumbnails, and library entries are evicted automatically
  when the cache grows past the limit.
- **Animation speed setting** (0.25×–2×): scales every live wallpaper —
  shader motion, emoji drift, and Ken Burns pan alike.

### Changed

- Saved wallpapers move out of your Pictures folder into the system
  wallpaper location (`~/.local/share/wallpapers/Ambient` on Linux, the
  app data folder on Windows/macOS). Upgrades behave as fresh installs.
- Live wallpapers on Windows/macOS now honor the quality setting instead
  of a fixed preview cap.

### Fixed

- The tray icon now follows the taskbar/panel theme instead of the app
  theme — no more wrong-color glyph on light taskbars (Windows) or
  light Plasma panels (KDE).
- Windows: no more console windows flashing while the app checks the
  system theme or accent color.
- Windows: quitting from the tray while a live wallpaper is running
  actually exits the app, and the live wallpaper is restored after a
  restart.
- Windows: wallpapers render at the monitor's real resolution on
  HiDPI/4K displays.
- Windows: start-on-login works via the registry Run key.

## [1.3.0] — 2026-07-02

### Added

- **Free 7-day trial** — no card needed. Grab it from the website, sign in
  with your email, and the full app just works for a week (the license
  expires server-side; buying later uses the same sign-in).
- **Sign in with your email instead of a license key.** Polar emails you a
  one-time code; the app fetches and activates your license behind the
  scenes. The key-paste gate is gone.
- **Two new patterns:** *Matrix* — digital rain with real glyphs (authentic
  half-width katakana, or type your own text and watch it rain down the
  columns) — and *CRT Test* — an SMPTE color-bar test card with curved
  glass, scanlines, a rolling hum bar, static bursts, and H-sync tears
  when animated.
- **Account section in Settings**: signed-in email, trial countdown, and
  sign out.
- The window is **resizable and maximizable** now (was fixed 820×600).
- Tray: with auto-rotate off, "Next wallpaper" becomes **Random
  wallpaper** — one click re-rolls the current pattern with a random
  preset (colors + emojis) and fresh knobs, even from the tray with the
  window closed.

### Changed

- Emoji everywhere are now the **Microsoft Fluent 3D** artwork — the
  desktop live wallpaper, the picker, and the animated preview all show
  the same glossy 3D art instead of flat font glyphs.
- Sliders and pickers respond instantly; previews now render once after
  you stop adjusting instead of once per tick.

### Fixed

- **Animated wallpapers on ARM / OpenGL ES systems** (e.g. aarch64 +
  NVIDIA): the Plasma plugin's shaders were baked for desktop GL only, so
  every pattern except Emoji rendered blank. Now baked with GLES variants.
- **Blurred glass on NVIDIA**: the Wayland crash workaround used to
  disable GPU compositing (killing every blur); the crash is now fixed at
  its root (explicit-sync opt-out) and the glass is back.
- Maximized/fullscreen no longer letterboxes the content in a 1280px
  column.
- One Cmd+Enter no longer triggers Apply on every previously-visited tab
  at once.
- Empty palettes can no longer crash the mesh/stripes renderers, and the
  secrets file is never briefly world-readable during writes.

## [1.2.1] — 2026-06-26

### Added

- In-app updates for the Linux AppImage. The update banner and Settings →
  Updates now offer **Install & restart**: Ambient downloads the new
  AppImage, replaces itself in place, and relaunches — no trip to the
  download page. macOS and Windows still link to the site (those builds
  aren't OS-code-signed, so the OS install prompt is handled deliberately).

### Changed

### Fixed

- Glass panel text was unreadable in OS light mode — the frosted control
  panels and tab bar are deliberately dark, but light mode flipped the text
  to black, sinking every label into the dark glass. Text on those surfaces
  now stays light regardless of the OS colour scheme.

## [1.2.0] — 2026-06-26

### Added

- **Live wallpapers on macOS.** macOS joins KDE Plasma and Windows: an
  animated pattern now renders as a real live wallpaper sitting behind
  the desktop icons, instead of a still. Flip **Animate** in Patterns and
  Apply.
- **Live wallpaper on the lock screen (KDE).** With "Also set the lock
  screen" on, the animated wallpaper now drives the lock screen too, not
  just a still.

### Changed

- **Flower petals read as distinct.** Each petal edge is now shaded from
  the petal's own colour rather than a flat dark outline, so the bloom has
  clear, defined petals — in the live wallpaper and the applied still alike.

### Fixed

- **The live wallpaper always shows the current look.** A rendering fix
  (like the flower's) now reliably reaches the real desktop wallpaper
  instead of only the in-app preview — an older copy of the shader could
  be left installed, so the desktop and the app looked different.
- **Flower colours no longer depend on the palette size.** The petal
  colouring wraps cleanly around the bloom for any number of colours, so a
  4-colour palette looks as clean as a 6-colour one (no hard colour seam) —
  now in the applied wallpaper image as well as the live one.
- **Glass panels keep their frost.** The frosted-glass surfaces no longer
  lose their blur in release builds, and the right-hand panel sizes itself
  to its content.
- **Controls render correctly in the Linux webview.** The toggle switches,
  checkboxes, and the custom-palette delete icon now draw properly under
  WebKitGTK instead of showing as bare pills or blank boxes.

## [1.1.0] — 2026-06-25

### Added

- **Live wallpapers.** Patterns can now animate as a real, GPU-rendered
  live wallpaper instead of a still. Flip the new **Animate** toggle in
  Patterns, pick a pattern, and Apply — the desktop animates continuously.
  All nine generative patterns animate as their own shader (Flow, Waves,
  Aurora, Dots, Bokeh, Stripes, Geometric, Flower, Mesh), and the Emoji
  field drifts per-glyph.
  - **KDE Plasma** (X11 + Wayland) via a native Plasma wallpaper plugin
    the desktop renders itself.
  - **Windows 10/11** via a layer rendered behind the desktop icons.
  - A **live render-quality selector** in Settings (Performance / Balanced
    / High / Native) caps the shader's internal resolution and frame rate
    to match your hardware.
- **One shader, everywhere.** The in-app preview, the live wallpaper, and
  the static PNG that gets applied as your wallpaper now all run the exact
  same shaders — so a pattern looks identical whether it's animating live
  or saved as a still.

### Changed

- Backend extracted into a Tauri-independent `ambient-core` crate
  (`src-tauri/core`): pattern renderer, source fetchers, AI generation,
  settings/library/license stores, secrets, and the wallpaper-apply
  pipeline. The Tauri shell keeps only window/tray/updater/solo-instance,
  the rotation scheduler, and thin command wrappers. No user-facing
  change; groundwork for the Tauri-mobile (Android/iOS) port.

### Fixed

- **No more white flash on launch.** The window now opens on the app's
  own dark surface instead of a blank white frame while the webview warms
  up — most noticeable on Windows and on a cold first run.

## [1.0.3] — 2026-06-05

### Added
- **Signed RPMs.** The `.rpm` packages (Fedora/RHEL/openSUSE) are now
  GPG-signed in CI, so `zypper`/`dnf` stop warning about an unsigned
  package once you trust the key:
  `sudo rpm --import https://ambient.oezcan.me/ambient.gpg`. The download
  page shows that one-liner when you pick the rpm. (`.deb` and the Arch
  `.pkg.tar.zst` aren't signed — apt and `pacman -U <file>` don't verify
  a per-package signature, so there's nothing to warn about there.)

### Changed

### Fixed
- **No more crash on close on AMD/Intel machines that have NVIDIA
  packages installed.** libglvnd loads the `10_nvidia` EGL vendor ahead
  of Mesa, so on a box with no NVIDIA GPU (e.g. where Steam pulled in
  `nvidia-utils`) WebKit's web process would segfault tearing down the
  inactive NVIDIA driver, dumping a 90 MB core each time the window
  closed. Ambient now points its own processes at the Mesa/other EGL
  vendors when an NVIDIA vendor is present but its kernel module isn't
  loaded — real NVIDIA systems and explicit overrides are untouched.

## [1.0.2] — 2026-06-05

### Added
- **Three new wallpaper sources:** Bing Photo of the Day and Lorem Picsum
  (both free, no key), and Wallhaven (search-driven; works anonymously for
  SFW, optional key for more). Joins NASA, Unsplash, and Pexels.
- **Pollinations API token (BYOK).** Paste a free Pollinations token in
  Settings to lift the anonymous rate limit and drop the watermark; sent
  as a Bearer token. AI generation now reliably works for registered
  users. (An optional Wallhaven key field was added too.)
- **Wallhaven options.** Sort (Random / Top / Latest / Most viewed),
  Categories (General / + Anime / Everything), and Content (SFW / + Sketchy)
  controls on the Sources tab.

### Changed
- **Sources auto-refresh.** Switching to a source with no cached image, or
  changing a search/Wallhaven option, now pulls a fresh preview
  automatically (debounced, so flicking the picker doesn't spam requests).
  Auto-rotate works across all six sources.
- The website now reflects the current app: ten pattern generators, all
  six photo sources, AI with the free/token Pollinations path, and the
  rpm download is labelled for Fedora / RHEL / openSUSE.

### Fixed

## [1.0.1] — 2026-06-05

### Added

### Changed
- **Linux is native-packages-only now** — the AppImage was dropped. Its
  bundled GPU/Mesa libraries blank-screened the window on some hosts;
  `.deb`/`.rpm`/`.pkg.tar.zst` link the system WebKitGTK and don't. Linux
  updates come from your package manager (the in-app updater is now
  macOS/Windows only).
- **Download page** shows just your detected platform up front; the others
  tuck into an "Other platforms" disclosure, and the unsigned-app note only
  appears when it's actually about the platform on offer.
- **Update notifications now link to the download page** instead of
  installing in-app — the banner and the Settings "Updates" action both
  open the website so you grab the new build / package yourself.

### Fixed

## [1.0.0] — 2026-06-05

### Added
- **Native Linux packages.** Ambient now ships `.deb` (Debian/Ubuntu),
  `.rpm` (Fedora/RHEL) — both x86_64 and ARM64 — and a native Arch
  `.pkg.tar.zst` (x86_64). These link the system WebKitGTK, so they avoid
  the AppImage's bundled-library blank-window issue on some GPUs and are
  the recommended way to install on Linux.
- **Redesigned download page.** The site now offers a per-OS picker:
  macOS one button, Windows an architecture dropdown, and Linux a
  distro/format + architecture dropdown — auto-selecting your detected
  platform.

### Changed
- **Simpler storage.** Retired the `tauri-plugin-store` dependency (both the
  JS and Rust sides). Saved palettes now live in Rust-owned settings (one
  source of truth for real data; they migrate over automatically), and
  ephemeral UI drafts (current pattern, prompt, active tab) moved to the
  webview's localStorage. Upgrading keeps your palettes; an in-progress
  unsaved pattern resets once.
- The Linux AppImage no longer bundles the GStreamer media framework
  (Ambient has no audio/video), slimming the download.

### Fixed

## [0.9.0] — 2026-06-05

### Added
- **Unified notifications.** Every success and error across the app now
  appears in one consistent toast stack (bottom-right) instead of inline
  text that showed up in a different spot on each tab.
- **Danger zone in Settings.** New **Clear cache** (drops the regenerable
  thumbnail cache) and **Delete all saved wallpapers** (removes every
  wallpaper Ambient saved and empties the Library) actions.
- **Live AI models.** The Pollinations model list is fetched from the
  service instead of a hardcoded list that had drifted out of date.

### Changed
- **Consistency pass across the whole app.** Icon-only buttons are now
  round, the theme switch is a sun/moon/auto icon toggle used identically
  on Patterns and Library, the palette picker moved to the top tray,
  labels are sentence-case (no more all-caps grey titles), and status
  text is terser.
- **One control for one job.** Single-select everywhere uses the same
  arrow picker — the last native dropdown (auto-rotate Mode in Settings)
  is gone.
- **Shared UI component library** (`src/ui/`) now backs the buttons,
  fields, pickers, and toasts so the app stays visually consistent.

### Fixed
- **Blur is back** in `tauri dev` and native (non-AppImage) builds — the
  EGL crash workaround that disabled it is now scoped to the AppImage,
  where the crash actually happens.
- **AI generation errors are clear.** Pollinations rate-limit responses
  now surface a readable message (with the upgrade link) instead of
  failing silently.
- The AI prompt box no longer overflows its panel; the empty Generate
  tab no longer shows two stray white spots.
- Fixed a race when rapidly tagging a wallpaper light/dark, a redundant
  network fetch on the Sources tab at launch, and an event-listener leak.

## [0.8.2] — 2026-06-04

### Added
- **Per-wallpaper light/dark tags.** Mark any saved wallpaper as
  light-only or dark-only (Sun/Moon toggles on the Library tab); the
  rotation pools are built from these tags automatically.
- **Lock screen.** A "Lock screen" toggle on the Library tab — when on,
  applying a wallpaper also mirrors it to the KDE lock screen.
- **Randomize colors.** A new button that rolls a fresh themed palette
  for the current pattern.

### Changed
- **"Next wallpaper" actually works now.** The tray "Next wallpaper" (and
  auto-rotate) advance through the saved library filtered to the current
  system theme's pool, instead of trying to fetch a fresh source image.
  On a system light↔dark flip, the wallpaper auto-switches to a matching
  one only when the current one no longer fits.
- The pattern **Shuffle** and the new **Randomize colors** now live in
  the control pane next to the sliders (they're per-pattern, not global).

### Fixed
- **AppImage no longer crashes on launch** on systems where the bundled
  WebKit and host Mesa disagree on EGL (the "Could not create surfaceless
  EGL display: EGL_BAD_ALLOC" abort) — the DMABUF renderer is disabled so
  the webview falls back to a path that initializes reliably.

## [0.8.1] — 2026-06-04

### Added
- **Five new pattern generators**, bringing the total to ten:
  - **Flower** — flowing, translucent gradient petals radiating from a
    luminous centre, optionally swirled (the Windows 11 "Bloom" motif).
    Controls: Petals, Swirl, Size.
  - **Flow** — smooth wavy lines spanning the canvas edge-to-edge,
    flowing together like wind-blown strands. Controls: Lines,
    Amplitude, Frequency, Size.
  - **Waves** — translucent wavy bands stacked back-to-front (the
    layered-paper / silk look). Controls: Layers, Amplitude, Frequency.
  - **Aurora** — vertical northern-lights curtains of soft, swaying
    light. Controls: Bands, Spread, Sway.
  - **Bokeh** — scattered soft glowing orbs (a defocused depth-of-field
    look). Controls: Count, Size.

### Changed
- **Randomize now re-rolls every modifier** the active generator
  exposes — counts, sizes, shape/fill, swirl, amplitude, and so on —
  not just the seed.

### Fixed
- (none)

## [0.8.0] — 2026-06-03

### Added
- **8 new curated palettes** — Aurora, Cyberpunk, Autumn, Sakura,
  Vaporwave, Forest, Citrus, and Berry — bringing the themed set to 15,
  each with light/dark variants and a matching emoji set.
- **Full Unicode emoji picker.** The picker now offers the complete
  single-codepoint Unicode 16.0 set (~1,380 glyphs across 8 groups)
  instead of a curated handful. Glyphs not bundled in the binary are
  fetched as Fluent 3D artwork on first use and cached to disk, so the
  common set stays instant and offline while everything else still
  renders.
- **Palette rename.** Custom palettes can be renamed inline from the
  Patterns panel.
- **Background / foreground colour roles.** The Patterns palette editor
  now separates the background fill from the foreground (shape / dot /
  stripe / glyph) colours rather than presenting one flat list.

### Changed
- **Full redesign onto a single full-bleed "liquid glass" layout.**
  Every tab — Patterns, Generate, Sources, Library — now shows the
  preview edge-to-edge with floating frosted-glass control panels and
  arrow-scroller pickers, matching the marketing site. The glass is
  genuinely achromatic (it refracts the backdrop via blur + saturate)
  rather than being painted with colour tints, and all OS-accent-tinted
  chrome was removed for a consistent look.
- **Much sharper emoji wallpapers.** Emoji renders are now supersampled
  and Lanczos3-downscaled so rotated/scaled glyph edges are smoothly
  anti-aliased instead of jagged; the preview supersamples too, so it
  matches the applied result.
- **Instant source switching.** Switching wallpaper source no longer
  triggers a network fetch — the cached image shows immediately and
  fetching is explicit.
- **Updater signing is now wired into CI**, so released installers ship
  with valid update signatures.

### Fixed
- Emoji picker no longer clips off the left edge of the window.
- Previews are no longer darkened by an overlay scrim, and the action
  buttons (apply, generate, delete, randomise) now match the glass
  style.
- Preview generation is debounced and cancels superseded jobs, fixing
  the laggy/stuck-on-"generating" behaviour and pixelated pattern
  output; supersample intermediates are capped to avoid memory spikes.
- Fixed a heap-corruption crash when a new launch took over a running
  instance (now a clean hard-kill handoff).

## [0.7.0] — 2026-06-02

### Added
- **Solo-instance with new-launch-wins handoff.** Relaunching Ambient
  while one is already running now SIGTERMs the previous instance
  (after a PID-file + process-name check defends against PID rollover)
  and starts fresh. Inverts the usual single-instance "focus the
  existing window" pattern — the new launch always wins, so a wedged
  tray-only process never blocks the user from re-opening.
- **Content Security Policy** for the bundled HTML. Restricts to
  `'self'`, the Tauri asset protocol (`asset:` + `http://asset.localhost`),
  `data:` / `blob:` (for base64 preview images), `ipc:` for invoke,
  and Vite's dev-mode HMR ports — with `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'` as standard hardening.
- **Security CI.** A separate `Security` workflow runs `cargo-audit`
  (RustSec CVE feed against `Cargo.lock`) and `gitleaks` (secret scan
  over full history) on every push, PR, and Monday morning. Kept out of
  the build workflow so it never gates a release.
- **Release-Drafter** auto-populates the next release's notes as PRs
  land — categorizes by `feat:` / `fix:` / `chore:` / etc. into
  Added / Changed / Fixed sections matching `CHANGELOG.md`'s headings.
- **Renovate** opens grouped weekly dependency PRs (Monday morning,
  Europe/Berlin). The Tauri family travels together; rav1e + ravif
  travel together; patch / digest / lockfile bumps automerge after CI
  while majors stay manual.
- **Custom palettes.** Save the current colors + emoji as a reusable,
  named palette ("Custom N") that persists across sessions and sits in
  the picker alongside the curated themes, each with its own delete
  affordance. Plus a live **System** palette derived from the OS accent
  (now also read from KDE's `kdeglobals`, not just GNOME/macOS/Windows).
- **About panel** behind a titlebar info button — app icon, version,
  description, website link, and a **Check for updates** button that
  runs an on-demand check (bypassing the 6h background throttle, so it
  reports "up to date" too) with in-app install when one's available.
- **Click an emoji chip to swap it.** The emoji glyph is now a button
  that opens the picker targeting that slot; the picker auto-closes on
  pick. The "+" still appends.

### Changed
- **Bundle identifier renamed** `com.ambient.app` → `me.oezcan.ambient`.
  Tightens the bundle metadata to the actual project domain. Linux
  `.desktop` + icon filenames follow; the AppImage auto-integrate step
  writes the new names.
- **Bundle metadata corrected.** `license: MIT` (wrong — Ambient is
  proprietary) is now `Proprietary`; `copyright` attributes Atay
  Özcan; `homepage` points at the live site, not the private GitHub
  repo; `longDescription` no longer claims Linux-only.
- **Rust dependency majors bumped:** reqwest 0.12 → 0.13, ravif
  0.11 → 0.13, rav1e 0.7 → 0.8, tiny-skia 0.11 → 0.12. The keyring
  crate moved to its replacement (`keyring-core 1.0` + per-platform
  store crates registered as the default at startup); the only
  surface change is a one-line `set_default_store(...)` call in
  `secrets::init`. JS-side `@tauri-apps/plugin-opener` and
  `plugin-store` pinned strings also lifted to current releases.
- **Source preview cache simplified.** The Sources tab no longer
  keeps a parallel `ambient-source-preview-cache` localStorage entry;
  the preview now derives from the most-recent matching Library row
  (Rust-owned), with NASA APOD's "one image per day" semantics
  enforced by a local-day timestamp check. ~50 LOC of cache plumbing
  deleted.
- **Rust edition 2024** for the `ambient` crate. The one
  `std::env::set_var` site (GDK backend nudge) now lives inside an
  `unsafe { }` block with a SAFETY note about its single-threaded init
  context.
- **`tracing` replaces ad-hoc `eprintln!`** across the Rust side. Log
  levels filter at runtime via `RUST_LOG`, structured fields land in
  the formatter, and the integration seam for future log sinks is one
  subscriber-add away.
- **React Compiler 1.0** is enabled via `babel-plugin-react-compiler`
  in `vite.config.ts`. Auto-memoizes components and hook returns so
  the codebase doesn't need manual `React.memo` / `useMemo` /
  `useCallback` for the common case; bails out safely on Rules-of-React
  violations rather than miscompiling.
- **Telemetry-free, on the record.** Ambient does not ship any
  analytics, error-reporting SDK, or in-app phone-home — a deliberate
  product position, not an accident. The new Rust `tracing` stack
  writes to stdout / files only.
- **Complete offline emoji set.** The bundled Microsoft Fluent 3D set
  grew from 84 to 153 PNGs — every emoji the picker or any preset can
  produce now renders from the binary. The defunct CDN fallback (its
  `microsoft` style was dropped upstream, returning HTTP 400) was
  removed; a test guards that every UI-reachable emoji stays bundled.
- **Geometric shape count is resolution-independent.** The shape count
  is now the `density` value directly instead of scaling with pixel
  area, so the small preview renders the exact same number of shapes as
  the full-resolution wallpaper — the preview is now a faithful preview.
- **Pattern files are content-addressed** (`pattern-<type>-<hash>`
  keyed on the full config) instead of seed-only, so editing shapes
  without re-rolling produces a new path the compositor actually
  reloads; identical re-applies still dedupe to one file.
- **App categorized as GraphicsAndDesign** (was Utility) for macOS /
  `.deb`; the Linux `.desktop` entry leads with `Graphics`, adds
  `Keywords` for launcher search, and sets `StartupNotify`.
- **Inspector is disabled while a wallpaper is applying** so the config
  can't be mutated mid-render; the preview and status stay live.

### Fixed
- **Pruned dead code from the v0.6 TS→Rust migration.** Removed an
  unreferenced TS module (`src/lib/monitor.ts`), an unused crate
  (`rgb`), an unused npm dep (`@tauri-apps/plugin-notification`, still
  used Rust-side), two unreachable library-helper exports, and two
  Tauri commands (`fetch_and_save_wallpaper`, `save_image_bytes`) that
  had no remaining JS callers. No behavior change — purely deletion.
- **KDE Plasma wallpaper-set.** Applying a wallpaper on KDE failed —
  the `wallpaper` crate's KDE path relies on a `qdbus` + Plasma
  scripting eval that's frequently absent or broken on Plasma 6 /
  Wayland. Linux now routes by desktop: KDE → `plasma-apply-wallpaperimage`
  (with the crate as fallback), COSMIC → its RON config, everything
  else → the crate. A routing test pins each desktop string to its
  setter.
- **Emoji that silently didn't render** (frog, tortoise, and 67 others
  offered in the picker but never bundled) now render — see the
  offline-set expansion above.
- **Delete / remove badges stayed grey on direct hover.** The global
  `button:hover` wash out-specified the badges' own danger/accent hover;
  the custom badges and ghost buttons are now excluded from it, so the
  color chip ✕, the custom-palette delete, and the add/save buttons
  light up correctly when you point straight at them.
- **Bottom navbar icons were barely visible** — inactive tabs were on
  the muted token; bumped to a strong fraction of the text color (and
  raised the white-icon opacity + halo in light mode).

## [0.6.0] — 2026-05-17

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
