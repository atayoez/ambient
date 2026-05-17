# Ambient

A Linux wallpaper generator distributed as a Flatpak. Pick colors, pick a pattern, render at your exact screen resolution, apply.

**The headline feature** — **iOS-style emoji wallpapers using Microsoft Fluent 3D emojis**, rendered pixel-perfect on Linux. There's nothing like this on Linux today, and the COSMIC integration handles HiDPI / scaling correctly out of the box.

## What it does

Five Canvas-rendered pattern types, all at native screen resolution:

- **Mesh gradient** — soft, multi-color radial blobs
- **Geometric** — bauhaus-style random shapes
- **Dots** — halftone-style grids
- **Stripes** — diagonal color bands
- **Emoji** — iPhone-style staggered grids with random rotation + mirror; top emojis use **Microsoft Fluent 3D** (MIT-licensed art via jsDelivr), others fall back to Fluent Color (flat) via `emojicdn.elk.sh`

Bonus paths for variety:

- **Library** — pull random images from NASA APOD (free), Unsplash, or Pexels (BYOK keys in Settings)
- **Generate** — AI-generated wallpapers via Pollinations (free) or OpenAI DALL-E 3 (BYOK)

Native COSMIC desktop integration writes directly to `cosmic-bg`'s RON config so wallpapers apply at correct physical pixel size on HiDPI displays without zoom or distortion. Other desktops (GNOME / KDE / sway / X11) are handled by the [`wallpaper`](https://crates.io/crates/wallpaper) crate.

## Dev setup (Arch Linux)

```bash
sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
    appmenu-gtk-module libappindicator-gtk3 librsvg xdotool

# Node 20+ and Rust
node --version
rustc --version || curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh

# Install + run
npm install
npm run tauri:dev
```

(Other distros need equivalents: `webkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `gtk-3-dev` on Debian/Ubuntu.)

## Shipping as Flatpak

Manifest at `flatpak/com.ambient.app.yaml`, AppStream metainfo at `flatpak/com.ambient.app.metainfo.xml`, desktop entry at `flatpak/com.ambient.app.desktop`.

### Local install (with network during build)

```bash
# One-time: install runtimes + SDK extensions
flatpak install flathub \
    org.freedesktop.Platform//24.08 \
    org.freedesktop.Sdk//24.08 \
    org.freedesktop.Sdk.Extension.rust-stable//24.08 \
    org.freedesktop.Sdk.Extension.node22//24.08

# Build + install + launch
npm run flatpak:build
flatpak run com.ambient.app
```

### Flathub submission

Flathub requires reproducible offline builds, so before submitting:

1. Generate offline source manifests:

    ```bash
    # Node deps
    pip install flatpak-node-generator
    flatpak-node-generator npm package-lock.json
    # Cargo deps — see https://github.com/flatpak/flatpak-builder-tools/tree/master/cargo
    python flatpak-cargo-generator.py src-tauri/Cargo.lock -o cargo-sources.json
    ```

2. Add the resulting `node-sources.json` and `cargo-sources.json` to the manifest's `sources:` list.

3. Submit to https://github.com/flathub/flathub.

## Self-containment

Pattern generation (the headline feature) is **fully offline** — Canvas renders everything in-process. Wallpaper-setting works offline (writes to disk + invokes the OS's wallpaper API directly).

Online dependencies (gracefully fail when offline):

- **Emoji assets** — fetched from `cdn.jsdelivr.net/gh/microsoft/fluentui-emoji` on first use, then HTTP-cached by WebKit. Falls back to the system color emoji font if unreachable.
- **Sources** — NASA APOD / Unsplash / Pexels APIs only when you hit *Fetch + apply* or change source.
- **AI generation** — Pollinations / OpenAI obviously need internet.

## Future targets (not in v0)

The underlying Tauri 2 codebase supports cross-platform builds — macOS, Windows, mobile, web — but Flatpak is the only release format being maintained for v0. Adding macOS / Windows builds is straightforward (`tauri build` on those platforms). Mobile would need a touch-friendly layout + native wallpaper APIs. Web would need gating every Tauri command behind a `'__TAURI__' in window` check.

## Project layout

```
ambient/
├─ src/                  React + TypeScript frontend
│  ├─ App.tsx            Custom titlebar + tab nav + sliding-pill animation
│  ├─ index.css          Liquid Glass styling + design tokens
│  ├─ components/
│  │  ├─ Patterns.tsx    Canvas-based generator (5 types, live preview)
│  │  ├─ Sources.tsx     Curated sources (NASA / Unsplash / Pexels)
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
│  │  └─ default.json    Permission scopes
│  └─ icons/             Platform-specific icon set
├─ flatpak/              Flathub manifest + .desktop + AppStream metainfo
├─ app-icon.svg          Source for generated icons
└─ LICENSE               Proprietary
```

## License

Proprietary — see `LICENSE`.
