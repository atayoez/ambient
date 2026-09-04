# Development

Day-to-day commands for hacking on Ambient locally.

## Prerequisites

- Rust stable
- `bun` ≥ 1.3 (the lockfile is `bun.lock`; npm/pnpm won't install correctly)
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
(`~/.local/share/me.oezcan.ambient/`), so license state, settings, and
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
   `windows-11-arm`, `macos-15-intel`, `macos-latest`). Every cell signs
   its updater artifact with the `TAURI_SIGNING_PRIVATE_KEY` secret.
5. Runs `publish` → `scripts/publish.sh`: renames to the
   `Ambient-VERSION-Platform-Arch.ext` convention, merges the LIVE
   `latest.json` (only the cells that built are bumped; a failed cell
   keeps its previous release — the feed never breaks), uploads to the
   `ambient-releases` R2 bucket, and creates/updates the GitHub release
   with the installers attached.

### Release-time notes

- The matrix runs only on `v*` tags and manual dispatch — pushes to
  main spend just the cheap `check` minutes. macOS runners bill at 10×,
  Windows at 2×; a full six-cell release is roughly 300–400 billable
  minutes on a private repo, so don't dispatch it casually.
- Rebuild one platform (e.g. a cell that failed) without the others:
  `gh workflow run build.yml -f targets=macos-aarch64 -f publish=true`.
  `targets` is a comma-separated list of cells or `all`.
- Re-run only the publish step for a finished run:
  `bun run release:publish -- 1.x.y --run <run-id>` (downloads that
  run's `ambient-*` artifacts into `dist/` first).
- The Tauri updater pubkey embedded in `tauri.conf.json` pairs with the
  private key in the `TAURI_SIGNING_PRIVATE_KEY` repo secret (keep the
  original at `~/.config/ambient/updater-private.key` backed up
  somewhere outside the laptop — losing it means every 0.4+ install
  loses the ability to verify future updates).
- `publish` needs `CLOUDFLARE_API_TOKEN` (R2 object write on
  `ambient-releases`) as a repo secret; `GITHUB_TOKEN` handles the
  release itself.

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
  pushes automatically and on dispatch when `publish: true`.

`security.yml` (cargo-audit + gitleaks) and `deploy-site.yml` (the
Cloudflare Worker) are independent of the release flow.
