# Development

Day-to-day commands for hacking on Ambient locally.

## Prerequisites

- Rust stable
- `bun` ≥ 1.3 (the lockfile is `bun.lock`; npm/pnpm won't install correctly)
- `webkit2gtk-4.1` on Linux hosts (`sudo pacman -S webkit2gtk-4.1` on
  Arch, `sudo apt-get install libwebkit2gtk-4.1-dev` on Ubuntu/Debian)

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
(`~/.local/share/com.ambient.app/`), so license state, settings, and
the wallpaper library carry over.

## Tests

```bash
# JS unit tests (Vitest + jsdom). Currently covers isDarkForMode +
# dismissUpdate.
bun run test

# Rust unit tests. Covers safe_filename, thumbnail_path_for,
# first_wxh, strip_ansi.
cd src-tauri && cargo test --lib
```

Vitest runs in `jsdom` env. Browser globals (`localStorage`,
`matchMedia`) aren't automatically mirrored onto `globalThis` with the
current vitest 4 + jsdom + bun combo — when a test needs them, stub
with `vi.stubGlobal('localStorage', { ... })` per-test. See
`src/lib/updater.test.ts` for the pattern.

`cargo test` without `--lib` runs the binary's tests (which don't
exist), reports zero, and silently skips the library. Always pass
`--lib`.

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

### Linux aarch64

Built in CI on the native `ubuntu-22.04-arm` runner — no local
toolchain needed. The release script downloads the artifact alongside
the macOS / Windows ones.

## Releasing

```bash
bun run release 0.x.y
```

What that does, in order:

1. Promotes `CHANGELOG.md`'s `[Unreleased]` block to `[0.x.y] —
   YYYY-MM-DD`, stashes the body to a temp file as release notes.
2. Bumps version in `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`.
3. Commits + pushes to `main` (triggers the cheap `check` CI job).
4. Dispatches the `build-tauri` matrix via `gh workflow run` (4 jobs:
   macOS aarch64, Windows x86_64, Windows aarch64, Linux aarch64
   on the native ARM runner). Waits for green.
5. Downloads the 4 CI artifacts.
6. Builds Linux x86_64 locally against host webkit2gtk-4.1 (with the
   linuxdeploy fallback baked in).
7. Signs all 5 artifacts with the Tauri updater key at
   `~/.config/ambient/updater-private.key` if present.
8. Uploads everything to `ambient-releases` R2 bucket with the
   `Ambient-VERSION-Platform-Arch.ext` naming pattern.
9. Writes a dual-shape `latest.json` (legacy `downloads.*` keys for
   pre-0.4 clients + plugin-format `platforms.*` block with
   minisign signatures for the in-app updater).
10. Tags `v0.x.y`, pushes the tag, creates a GitHub release with the
    5 artifacts attached.

### Release-time notes

- The CI matrix only runs on `workflow_dispatch` — pushes to main
  don't burn macOS minutes. `release.sh` dispatches it explicitly.
- The Tauri updater pubkey embedded in `tauri.conf.json` pairs with
  the private key at `~/.config/ambient/updater-private.key`. Lose
  the private key and every existing 0.4+ install loses the ability
  to verify future updates. Back it up somewhere outside the laptop.
- For CI-side signing, paste the private key into a repo secret
  named `TAURI_SIGNING_PRIVATE_KEY` (and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you put a passphrase on it,
  which the default `bun tauri signer generate -w ... --password ""`
  doesn't). The workflow already wires both env vars into
  `tauri-action`.

## Resetting state during development

Sometimes you want to test the activation flow, a fresh library, or
the empty-state UI. The Tauri store lives at
`~/.local/share/com.ambient.app/ambient.json`. Surgical edits via
`jq`:

```bash
# Clear license only (re-triggers the LicenseGate on next launch).
jq 'del(."license.state")' \
  ~/.local/share/com.ambient.app/ambient.json \
  > /tmp/x && mv /tmp/x ~/.local/share/com.ambient.app/ambient.json

# Nuke everything (library, settings, license).
rm ~/.local/share/com.ambient.app/ambient.json
```

Wallpapers themselves live at
`~/.local/share/com.ambient.app/wallpapers/`. Thumbnails are under
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
- **Update banner needs latest.json to advertise a newer `version`
  than `getVersion()`** to appear. To test the install path without
  cutting a real release: edit `latest.json` in the R2 bucket
  directly via `wrangler r2 object put`. The plugin will reject the
  install if signatures are missing or invalid — falls back to
  opening the download page silently.
- **License re-validation is throttled to once per 24h.** To force
  a re-check, clear the `license.state` block (above) and re-paste
  the key.

## CI structure

`.github/workflows/build.yml` has two jobs:

- **`check`** — runs on every push + PR. tsc, biome, vitest, cargo
  test --lib. Fast; ~1-2 min total. Gates the matrix.
- **`build-tauri`** — `workflow_dispatch` only. 4-arch matrix
  (macos-latest aarch64, windows-latest x86_64, windows-11-arm
  aarch64, ubuntu-22.04-arm aarch64). Linux x86_64 still builds
  locally during `release.sh`.
