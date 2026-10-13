# Ambient

> A native desktop wallpaper studio. Generate, fetch, and ship pixel-perfect wallpapers to your screen.

Ambient is a small Tauri app that lives in your tray and changes your wallpaper without friction. It does three things, and tries to do each of them well:

- **Patterns** — Five infinite generators (mesh gradients, geometric, dots, stripes, iOS-style emoji grids using Microsoft Fluent 3D). Re-rolls in milliseconds; renders at your screen's exact resolution.
- **Sources** — One-click fetch from curated providers: NASA Astronomy Picture of the Day, Unsplash, Pexels. Free, BYO API key for the latter two.
- **Generate** — AI image generation via Pollinations (free, no key) or OpenAI DALL-E 3 (bring your own key).

Anything you apply lands in your **Library** for re-use. Everything stays local; the only network traffic is to the image providers you opt into.

## Install

Builds for every release land on the [Releases page](https://github.com/atayoez/ambient/releases). Pick the file for your OS:

| Platform              | File                                        | Notes                                                                 |
|-----------------------|---------------------------------------------|-----------------------------------------------------------------------|
| macOS (Apple Silicon) | `Ambient-x.y.z-macOS-aarch64.dmg`           | Open the DMG, drag Ambient to Applications. Unsigned: right-click → Open the first time. |
| macOS (Intel)         | `Ambient-x.y.z-macOS-x86_64.dmg`            | Same as above, for 2020-and-earlier Intel Macs.                       |
| Windows x86_64        | `Ambient-x.y.z-Windows-x86_64-setup.exe`    | NSIS installer. Unsigned: "More info → Run anyway" the first time.    |
| Windows ARM64         | `Ambient-x.y.z-Windows-aarch64-setup.exe`   | Native ARM64 build for Snapdragon / Copilot+ PCs.                     |
| Linux x86_64          | `Ambient-x.y.z-Linux-x86_64.AppImage`       | `chmod +x` and run. Needs `webkit2gtk-4.1` on the host.               |
| Linux aarch64         | `Ambient-x.y.z-Linux-aarch64.AppImage`      | For Raspberry Pi 4/5, Asahi-on-Apple-Silicon, ARM workstations.       |

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

**Widgets tab** — things drawn over the live wallpaper on every desktop. The clock: on/off, anchor corner plus free horizontal/vertical position, size, 12/24-hour, seconds, date — previewed in place on a stage shaped like your screen.

## Keyboard shortcuts

| Shortcut             | Action                                       |
|----------------------|----------------------------------------------|
| `⌘1` … `⌘6`          | Jump to tab 1–6                              |
| `⌘Enter`             | Primary action (Apply / Generate / Re-fetch) |
| `⌘⇧R`                | Re-roll (Patterns) / Re-fetch (Sources)      |

`⌘` is Cmd on macOS, Ctrl on Windows/Linux.

## Build from source

Requires Rust (stable), [Bun](https://bun.sh) ≥ 1.4, and the platform-specific Tauri prerequisites listed on [tauri.app](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/atayoez/ambient
cd ambient
bun install
bun run tauri dev          # hot-reload dev build
bun run tauri build        # production installers for your platform
```

The release bundle ends up under `src-tauri/target/release/bundle/`.

On Linux the shell also links `gtk-layer-shell` (the Wayland live-wallpaper surface), so a dev host needs its headers too: `gtk-layer-shell-devel` on openSUSE, `libgtk-layer-shell-dev` on Debian/Ubuntu.

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the full dev / test / release commands (including the linuxdeploy bundling-step fallback and `jq` snippets for resetting license / library state during testing).

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
    live_win.rs   Live wallpaper window: Windows (WorkerW)
    live_mac.rs   Live wallpaper window: macOS (desktop window level)
    live_linux.rs Live wallpaper window: Linux Wayland layer-shell (COSMIC, Sway, …) and GNOME
    live_gnome.rs Installs + checks the GNOME Shell extension that places it on GNOME
  core/           ambient-core: renderer, sources, stores, KDE live plugin
plasma/           KDE Plasma wallpaper plugin (QML + baked shaders)
gnome/            GNOME Shell extension for live wallpapers (embedded in the app)
scripts/
  release.sh     Cut a versioned release: changelog + bump + tag + push
  publish.sh     Partial-aware publisher (run by CI; re-runnable locally)
website/         Marketing site (Cloudflare Worker + R2)
docs/            DEVELOPMENT.md + screenshots + operational notes
```

The design system tokens live in [`design-system/colors_and_type.css`](design-system/colors_and_type.css) — change anything there and the app picks it up via a single `@import` from `src/index.css`.

## Contributing

Issues and PRs welcome. Quick checks before pushing:

```bash
bun x tsc --noEmit                       # type-check
bun run lint                              # biome lint + format
bun run test                              # bun test (JS unit tests)
(cd src-tauri && cargo test --lib)        # cargo (Rust unit tests)
```

CI runs the same `check` job on every push/PR. The six-cell installer matrix ({Linux, Windows, macOS} × {x86_64, aarch64}, each built natively on a GitHub-hosted runner) and the publish job only fire on a `v*` tag push or a manual dispatch — `bun run release X.Y.Z` cuts the tag.

## License

Proprietary. See [`LICENSE`](LICENSE). End-user usage rights are granted via license keys purchased from [ambient.oezcan.me](https://ambient.oezcan.me).

The Microsoft Fluent emoji art used by the Emoji pattern is MIT-licensed by Microsoft — see [Microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji).
