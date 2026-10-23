# Development

Day-to-day commands for hacking on Ambient locally.

## Prerequisites

- Rust stable
- `bun` ≥ 1.4 (the lockfile is `bun.lock`; npm/pnpm won't install correctly).
  Bun is also the script runtime (`bun -e`, the `.mjs` release helpers) and
  the test runner — no Node install needed for anything in this repo.
- Linux hosts: `webkit2gtk-4.1` + `gtk-layer-shell` dev packages
  (`sudo zypper in webkitgtk3-devel gtk-layer-shell-devel` on openSUSE,
  `sudo apt-get install libwebkit2gtk-4.1-dev libgtk-layer-shell-dev` on
  Ubuntu/Debian, `sudo pacman -S webkit2gtk-4.1 gtk-layer-shell` on Arch).
  gtk-layer-shell is the Wayland live-wallpaper surface (live_linux.rs).

`bun` typically lives at `~/.bun/bin/bun`, which is *not* in
`/bin/sh`'s default PATH. Subshell invocations (anything Tauri spawns
via `beforeBuildCommand`) need `PATH="$HOME/.bun/bin:$PATH"` prepended.

## Dev loop

```bash
# Hot-reload dev. Compiles Rust, starts Vite on :1420, opens the
# Tauri window. JS / CSS / HTML hot-reload; Rust changes need a
# restart.
bun run tauri dev
```

The dev app shares the production app's data dir
(`~/.local/share/me.oezcan.ambient/`), so settings and the wallpaper
library carry over.

## Tests

```bash
# JS unit tests — Bun's built-in runner (Jest-style describe/it/expect,
# imports from "bun:test"). Covers the event bus, theme resolution,
# pattern manifest, and the live-clock formatter.
bun run test
bun run test:coverage     # built-in coverage report

# Rust unit tests. Covers the randr parsers, desktop routing, settings,
# renderer helpers, …
cd src-tauri && cargo test --workspace --lib
```

`bun test` has no DOM. The tests are written against pure modules;
the one browser global they need (`window` as an EventTarget for
`src/lib/events.ts`) comes from `scripts/test-preload.ts` (wired in
`bunfig.toml`), and a test that needs more stubs it explicitly.

`cargo test` without `--lib` runs the binary's tests (which don't
exist), reports zero, and silently skips the library. Always pass
`--lib`; `--workspace` so the ambient-core member is included.

## Type-check + lint

```bash
bun x tsc --noEmit       # TypeScript
bun run lint              # Biome (formatter + linter)
bun run format            # Biome auto-fix
```

Run these before pushing — CI's `check` job runs them on every
push/PR and gates merges.

## Production build

```bash
# Slow with the LTO release profile (~3-4 min on a Ryzen / M2 first
# build). Output: src-tauri/target/release/bundle/{appimage,dmg,msi}/
bun run tauri build
```

### Known linuxdeploy bug

Tauri's bundler sometimes errors out on the linuxdeploy invocation
even though the binary + AppDir are fine. Finish by hand:

```bash
cd src-tauri/target/release/bundle/appimage
NO_STRIP=true ~/.cache/tauri/linuxdeploy-x86_64.AppImage \
  --appdir Ambient.AppDir --output appimage
```

The release script (`scripts/release.sh`) handles this fallback
automatically.

### Other architectures / OSes

Don't cross-build locally — every release artifact comes from the CI
matrix (below), where each of the six cells builds natively on a
GitHub-hosted runner of that OS + CPU. `bun run tauri build` on your own
machine is for testing the bundle you can run right here.

## Releasing

```bash
bun run release 1.x.y            # add --watch to follow the CI run
```

What that does, in order:

1. Promotes `CHANGELOG.md`'s `[Unreleased]` block to `[1.x.y] —
   YYYY-MM-DD` and seeds a fresh empty `[Unreleased]` on top.
2. Bumps version in `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`.
3. Commits `Release v1.x.y`, tags `v1.x.y`, pushes commit + tag.

The tag push is the release. `.github/workflows/build.yml` then:

4. Runs `check`, then the **six-cell matrix** — linux/windows/macos ×
   x86_64/aarch64 — each cell natively on a hosted runner of that OS +
   CPU (`ubuntu-22.04`, `ubuntu-22.04-arm`, `windows-latest`,
   `windows-11-arm`, `macos-15-intel`, `macos-latest`).
5. Runs `publish` → `scripts/publish.sh`: renames to the
   `Ambient-VERSION-Platform-Arch.ext` convention (only the cells that
   built; a failed cell never blocks the others), pulls the release
   notes from `CHANGELOG.md`, and creates/updates the GitHub release
   with the installers attached. GitHub Releases is the only
   distribution channel; there is no in-app updater.

### Release-time notes

- The matrix runs only on `v*` tags and manual dispatch — pushes to
  main spend just the cheap `check` minutes. macOS runners bill at 10×,
  Windows at 2× (free on a public repo, but don't dispatch it casually).
- Rebuild one platform (e.g. a cell that failed) without the others:
  `gh workflow run build.yml -f targets=macos-aarch64 -f publish=true`.
  `targets` is a comma-separated list of cells or `all`.
- Re-run only the publish step for a finished run:
  `bun run release:publish -- 1.x.y --run <run-id>` (downloads that
  run's `ambient-*` artifacts into `dist/` first).
- No repo secrets are needed: the automatic `GITHUB_TOKEN` creates the
  release and uploads the assets.

## Resetting state during development

Sometimes you want to test a fresh library or the empty-state UI. The
Tauri store lives at `~/.local/share/me.oezcan.ambient/ambient.json`:

```bash
# Nuke everything (library, settings).
rm ~/.local/share/me.oezcan.ambient/ambient.json
```

Wallpapers themselves live at
`~/.local/share/me.oezcan.ambient/wallpapers/`. Thumbnails are under
`wallpapers/thumbs/` — safe to delete; they regenerate on next
Library view.

## Behavior to be aware of

- **Tab content stays mounted across switches** (lazy on first visit,
  sticky after). Patterns slider tweaks and Generate prompt edits
  survive tab hops; they commit to disk only on Apply ✓.
- **OS notifications fire only when the window is hidden.** Minimize
  the app or send it to tray (the X button hides, doesn't quit) to
  see the next auto-rotation / theme-follow event surface as a toast.
  Foreground events stay quiet because the in-app status pill is
  enough.

## CI structure

`.github/workflows/build.yml` has four jobs:

- **`check`** — every push + PR. tsc, biome, generated-file drift
  (shaders + matrix font), vitest, cargo test --workspace --lib. Fast;
  ~1-2 min. Gates the rest.
- **`plan`** — tag push / dispatch only. Turns the `targets` input into
  the matrix (all six cells on a tag).
- **`build`** — the matrix: `linux-x86_64`, `linux-aarch64`,
  `windows-x86_64`, `windows-aarch64`, `macos-x86_64`, `macos-aarch64`,
  each on a native hosted runner, uploading `ambient-<cell>` artifacts.
- **`publish`** — runs even if some cells failed (partial-aware), on tag
  pushes automatically and on dispatch when `publish: true`. Attaches
  the installers to the GitHub release.

`security.yml` (cargo-audit + gitleaks) is independent of the release flow.
