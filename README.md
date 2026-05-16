# Ambient

> A native desktop wallpaper studio. Generate, fetch, and ship pixel-perfect wallpapers to your screen.

Ambient is a small Tauri app that lives in your tray and changes your wallpaper without friction. It does three things, and tries to do each of them well:

- **Patterns** — Five infinite generators (mesh gradients, geometric, dots, stripes, iOS-style emoji grids using Microsoft Fluent 3D). Re-rolls in milliseconds; renders at your screen's exact resolution.
- **Sources** — One-click fetch from curated providers: NASA Astronomy Picture of the Day, Unsplash, Pexels. Free, BYO API key for the latter two.
- **Generate** — AI image generation via Pollinations (free, no key) or OpenAI DALL-E 3 (bring your own key).

Anything you apply lands in your **Library** for re-use. Everything stays local; the only network traffic is to the image providers you opt into.

## Install

Builds for every release land on the [Releases page](https://github.com/atayozcan/ambient/releases). Pick the file for your OS:

| Platform                | File                                       | Notes                                                                |
|-------------------------|--------------------------------------------|----------------------------------------------------------------------|
| macOS (Apple Silicon)   | `Ambient-x.y.z-macOS-aarch64.dmg`          | Open the DMG, drag Ambient to Applications. Unsigned: right-click → Open the first time. |
| Windows x86_64          | `Ambient-x.y.z-Windows-x86_64.msi`         | MSI installer (WiX). Unsigned: "More info → Run anyway" the first time. |
| Windows ARM64           | `Ambient-x.y.z-Windows-aarch64.msi`        | Native ARM64 build for Snapdragon / Copilot+ PCs.                    |
| Linux x86_64            | `Ambient-x.y.z-Linux-x86_64.AppImage`      | `chmod +x` and run. Needs `webkit2gtk-4.1` on the host.              |
| Linux aarch64           | `Ambient-x.y.z-Linux-aarch64.AppImage`     | For Raspberry Pi 4/5, Asahi-on-Apple-Silicon, ARM servers.            |

The marketing site at [ambient.oezcan.me](https://ambient.oezcan.me/) auto-detects your OS + arch and surfaces the right download as the primary CTA.

### Linux requirements

The AppImage bundles its own GUI deps, but it expects `webkit2gtk-4.1` on the host. On Arch:

```bash
sudo pacman -S --needed webkit2gtk-4.1
```

On Ubuntu 22.04+ / Fedora the equivalent package is available in the default repos as `libwebkit2gtk-4.1-0`.

## Tour

> Drop screenshots in [docs/screenshots/](docs/screenshots/) — sized 1440 × 900 to match the default window aspect.

**Patterns tab** — pick a generator on the left, tune palette / density / size on the right, hit Apply. The Theme segment (Auto / Light / Dark) follows your system color-scheme by default.

**Sources tab** — same layout, with a vertical source picker and an inline configuration section for whichever provider you've selected.

**Generate tab** — write a prompt, hit Cmd+Enter, get a wallpaper applied directly. The last result stays in the preview frame so you can iterate.

**Library tab** — a grid of everything you've applied. Click to re-apply, click delete twice to remove.

## Keyboard shortcuts

| Shortcut             | Action                                       |
|----------------------|----------------------------------------------|
| `⌘1` … `⌘5`          | Jump to tab 1–5                              |
| `⌘Enter`             | Primary action (Apply / Generate / Re-fetch) |
| `⌘⇧R`                | Re-roll (Patterns) / Re-fetch (Sources)      |

`⌘` is Cmd on macOS, Ctrl on Windows/Linux.

## Build from source

Requires Rust (stable), [Bun](https://bun.sh) ≥ 1.3, and the platform-specific Tauri prerequisites listed on [tauri.app](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/atayozcan/ambient
cd ambient
bun install
bun run tauri dev          # hot-reload dev build
bun run tauri build        # production installers for your platform
```

The release bundle ends up under `src-tauri/target/release/bundle/`.

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the full dev / test / release commands (including the Docker QEMU recipe for the Linux aarch64 AppImage, the linuxdeploy bundling-step fallback, and `jq` snippets for resetting license / library state during testing).

## Project structure

```
src/              React + TypeScript frontend
  components/     Tab components + shared layout primitives
  lib/            Pattern engine, sources, store, app-level hooks
design-system/    Color + type tokens, reference HTML
src-tauri/
  src/
    lib.rs        Tauri builder + plugin registration + tray
    desktop.rs    set_wallpaper (cross-platform + COSMIC override)
    monitor.rs    randr-shelling monitor detection
    library.rs    File mgmt commands + WebP thumbnail cache
scripts/
  release.sh     Cut a versioned release (see DEVELOPMENT.md)
  build-linux-arm64.sh  Local aarch64 build via Docker + QEMU
  docker/        Dockerfile.aarch64 for the above
website/         Marketing site (Cloudflare Worker + R2)
docs/            DEVELOPMENT.md + screenshots + operational notes
```

The design system tokens live in [`design-system/colors_and_type.css`](design-system/colors_and_type.css) — change anything there and the app picks it up via a single `@import` from `src/index.css`.

## Contributing

Issues and PRs welcome. Quick checks before pushing:

```bash
bun x tsc --noEmit                       # type-check
bun run lint                              # biome lint + format
bun run test                              # vitest (JS unit tests)
(cd src-tauri && cargo test --lib)        # cargo (Rust unit tests)
```

CI runs the same `check` job on every push/PR. The cross-platform installer builds are gated to `workflow_dispatch` and only fire during a release cut — `scripts/release.sh` handles the dispatch.

## License

MIT. See [`LICENSE`](LICENSE).

The Microsoft Fluent emoji art used by the Emoji pattern is also MIT — see [Microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji).
