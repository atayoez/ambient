# Ambient

> A native desktop wallpaper studio. Generate, fetch, and ship pixel-perfect wallpapers to your screen.

Ambient is a small Tauri app that lives in your tray and changes your wallpaper without friction. It does three things, and tries to do each of them well:

- **Patterns** — Five infinite generators (mesh gradients, geometric, dots, stripes, iOS-style emoji grids using Microsoft Fluent 3D). Re-rolls in milliseconds; renders at your screen's exact resolution.
- **Sources** — One-click fetch from curated providers: NASA Astronomy Picture of the Day, Unsplash, Pexels. Free, BYO API key for the latter two.
- **Generate** — AI image generation via Pollinations (free, no key) or OpenAI DALL-E 3 (bring your own key).

Anything you apply lands in your **Library** for re-use. Everything stays local; the only network traffic is to the image providers you opt into.

## Install

Builds for every release land on the [Releases page](https://github.com/atayozcan/ambient/releases). Pick the file for your OS:

| Platform | File                            | Notes                                                                |
|----------|---------------------------------|----------------------------------------------------------------------|
| macOS    | `Ambient_x.y.z_aarch64.dmg`     | Apple Silicon only. Open the DMG, drag Ambient to Applications.       |
| Windows  | `Ambient_x.y.z_x64-setup.exe`   | Run the NSIS installer. Unsigned: right-click → Properties → Unblock first.   |
| Linux    | `Ambient_x.y.z_x86_64.AppImage` | `chmod +x` and run. Flatpak is on the way to Flathub.                |

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

## Project structure

```
src/              React + TypeScript frontend
  components/     Tab components + shared layout primitives
  lib/            Pattern engine, source fetchers, settings store
design-system/    Color + type tokens, reference HTML
src-tauri/        Rust backend (commands, tray, wallpaper bridge)
flatpak/          Flathub-ready manifest (work in progress)
```

The design system tokens live in [`design-system/colors_and_type.css`](design-system/colors_and_type.css) — change anything there and the app picks it up via a single `@import` from `src/index.css`.

## Contributing

Issues and PRs welcome. Quick checks before pushing:

```bash
bun x tsc --noEmit          # type-check
bun run lint                # biome lint + format
```

CI runs the same checks plus full Tauri builds on macOS / Windows / Linux on every push.

## License

MIT. See [`LICENSE`](LICENSE).

The Microsoft Fluent emoji art used by the Emoji pattern is also MIT — see [Microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji).
