# Ambient

A cross-platform wallpaper generator for Linux / macOS / Windows. Pick colors, pick a pattern, render at your exact screen resolution, apply.

**The headline feature** — **iOS-style emoji wallpapers using Microsoft Fluent 3D emojis**, rendered pixel-perfect on whatever desktop you're on. There's nothing like this on Linux today, and the COSMIC integration handles HiDPI / scaling correctly out of the box.

## What it does

Five pattern types via a Canvas-based generator, all rendered at native screen resolution:

- **Mesh gradient** — soft, multi-color radial blobs, the "iOS Photos suggested" aesthetic
- **Geometric** — bauhaus-style random shapes
- **Dots** — halftone-style grids
- **Stripes** — diagonal color bands
- **Emoji** — iPhone-style staggered grids with random rotation + mirror; top-curated emojis come from **Microsoft Fluent 3D** (MIT-licensed art via `cdn.jsdelivr.net/gh/microsoft/fluentui-emoji`), others fall back to Fluent Color (flat) via `emojicdn.elk.sh`

Bonus paths for variety:

- **Library** — pull random images from NASA APOD (free), Unsplash, or Pexels (BYOK keys in Settings)
- **Generate** — AI-generated wallpapers via Pollinations (free) or OpenAI DALL-E 3 (BYOK)

Native COSMIC desktop integration: Ambient writes directly to `cosmic-bg`'s RON config so wallpapers apply at the correct physical pixel size on HiDPI displays without zoom or distortion. For other desktops (GNOME / KDE / sway / X11) the [`wallpaper`](https://crates.io/crates/wallpaper) crate handles it.

## Quick start (dev)

### Linux (Arch / Ubuntu / Fedora)

```bash
# Arch — adjust for your distro
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool

# Node 20+ and Rust
node --version
rustc --version || curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh

# Run
npm install
npm run tauri:dev
```

### macOS

```bash
brew install node rustup
rustup-init -y
npm install
npm run tauri:dev
```

### Windows

```powershell
# Install Rust + Node from rustup.rs and nodejs.org
# Install Visual Studio Build Tools (C++ workload)
npm install
npm run tauri:dev
```

## Shipping

Tauri's `tauri build` produces native installers per platform. The bundle config in `src-tauri/tauri.conf.json` is already set up with metadata (publisher, category, license, dependencies).

| Target | Command | Output |
|--------|---------|--------|
| **Linux .deb** | `npm run tauri:build` | `src-tauri/target/release/bundle/deb/` |
| **Linux .rpm** | `npm run tauri:build` | `src-tauri/target/release/bundle/rpm/` |
| **Linux AppImage** | `npm run tauri:build` | `src-tauri/target/release/bundle/appimage/` |
| **macOS .dmg** | `npm run tauri:build` (on macOS) | `src-tauri/target/release/bundle/dmg/` |
| **macOS .app** | `npm run tauri:build` (on macOS) | `src-tauri/target/release/bundle/macos/` |
| **Windows .msi** | `npm run tauri:build` (on Windows) | `src-tauri/target/release/bundle/msi/` |
| **Windows .nsis** | `npm run tauri:build` (on Windows) | `src-tauri/target/release/bundle/nsis/` |
| **Flatpak** | `npm run flatpak:build` | installed to `~/.var/app/com.ambient.app/` |

### Automated cross-platform releases via GitHub Actions

`.github/workflows/release.yml` builds all three platforms on tag push (`v*`). Workflow:

1. Push a tag: `git tag v0.1.0 && git push --tags`
2. GitHub Actions builds macOS (universal), Linux (Ubuntu 22.04), Windows (latest)
3. Bundles get uploaded to a **draft release** ready for you to publish

Code-signing secrets (commented in the workflow) need to be filled in if you want to ship to non-dev users:

- **macOS**: Apple Developer Program ($99/yr) — `APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- **Windows**: EV cert (~$200) — `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`. Without a cert, Windows SmartScreen will flag the installer until it builds reputation.

### Flatpak (Linux)

The Flatpak manifest at `flatpak/com.ambient.app.yaml` is set up for local builds. To submit to Flathub you'd additionally need:

1. Generate offline source manifests (Flathub requires reproducible builds with no network during build):

    ```bash
    pip install flatpak-node-generator
    flatpak-node-generator npm package-lock.json
    # And the cargo equivalent — see https://github.com/flatpak/flatpak-builder-tools
    ```

2. Add the resulting `node-sources.json` and `cargo-sources.json` as additional sources in the manifest.

Local install (with network during build):

```bash
flatpak install flathub org.freedesktop.Platform//24.08 org.freedesktop.Sdk//24.08 \
    org.freedesktop.Sdk.Extension.rust-stable//24.08 org.freedesktop.Sdk.Extension.node22//24.08

npm run flatpak:build
flatpak run com.ambient.app
```

## Self-contained-ness

Wallpaper generation (Patterns tab) is **fully offline** — Canvas renders everything in-process. Wallpaper-setting works offline (writes to disk + invokes the OS's wallpaper API directly).

Online dependencies (graceful failure when offline):

- **Emoji assets** — fetched from `cdn.jsdelivr.net/gh/microsoft/fluentui-emoji` on first use, then HTTP-cached by the webview. If unreachable, falls back to the system color emoji font.
- **Sources** — NASA APOD / Unsplash / Pexels APIs only run when you hit "Fetch + apply" or change source.
- **AI generation** — Pollinations / OpenAI obviously need internet.

## Future targets

Not in v0 but the foundation supports them:

- **Mobile (Android / iOS)** via `tauri android init` / `tauri ios init`. Needs:
  - Touch-friendly UI layout (the current layout assumes desktop window sizes)
  - Native wallpaper APIs per OS (the `wallpaper` Rust crate is desktop-only)
- **Web** via `npm run build` (already produces a static SPA in `dist/`). Needs:
  - Gating every `invoke()` and Tauri API call behind a `'__TAURI__' in window` check
  - Wallpaper-set replaced by "Download image" button
  - Useful as a "try before installing" demo

## Project layout

```
ambient/
├─ src/                  React + TypeScript frontend
│  ├─ App.tsx            Custom titlebar + tab navigation + sliding-pill animation
│  ├─ index.css          Liquid Glass styling + design tokens
│  ├─ components/
│  │  ├─ Patterns.tsx    Canvas-based generator (5 types, live preview)
│  │  ├─ Sources.tsx     Curated sources (NASA / Unsplash / Pexels) + fetch
│  │  ├─ Library.tsx     Saved wallpaper grid
│  │  ├─ Generate.tsx    AI generation (Pollinations / OpenAI)
│  │  └─ Settings.tsx    AI provider config + rotation
│  └─ lib/
│     ├─ patterns.ts     Pattern rendering + Fluent emoji loader
│     ├─ sources.ts      NASA APOD / Unsplash / Pexels HTTP wrappers
│     ├─ aigen.ts        Pollinations / OpenAI image gen
│     ├─ wallpaper.ts    Tauri command wrappers
│     ├─ store.ts        tauri-plugin-store wrapper
│     └─ types.ts        Shared types + DEFAULT_SETTINGS
├─ src-tauri/            Rust + Tauri 2 backend
│  ├─ src/lib.rs         set_wallpaper / fetch_and_save / save_image_bytes /
│  │                     list_wallpapers / delete_wallpaper /
│  │                     get_primary_monitor_pixels (COSMIC-aware)
│  ├─ tauri.conf.json    Window config + bundle metadata
│  ├─ capabilities/
│  │  └─ default.json    Permission scopes (HTTP, window, store, etc.)
│  └─ icons/             Platform-specific icon set
├─ flatpak/              Flathub manifest + .desktop + AppStream metainfo
├─ .github/workflows/
│  └─ release.yml        Cross-platform release builds via tauri-action
├─ app-icon.svg          Source for generated icons
└─ LICENSE               MIT
```

## License

MIT — see `LICENSE`.
