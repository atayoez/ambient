# Ambient — operations reference

The state of the release setup as of 2026-10-23. Read this when
something is broken, when cutting a release, or when picking the
project back up after a break. Intended for the maintainer + future me
(or future Claude sessions).

## Distribution

GitHub Releases is the only distribution channel:
<https://github.com/atayoez/ambient/releases>. Each release carries six
installers, named `Ambient-<VERSION>-<Platform>-<Arch>.<ext>`:

```
Ambient-<VERSION>-macOS-aarch64.dmg
Ambient-<VERSION>-macOS-x86_64.dmg
Ambient-<VERSION>-Windows-x86_64-setup.exe
Ambient-<VERSION>-Windows-aarch64-setup.exe
Ambient-<VERSION>-Linux-x86_64.AppImage
Ambient-<VERSION>-Linux-aarch64.AppImage
```

There is no in-app updater: users pick up new versions from the
releases page (or from the AUR package under `packaging/`).

## Cutting a release

```bash
bun run release 1.X.Y            # --watch to follow the CI run
```

Everything builds in CI — one native six-cell matrix, no local
cross-builds, no ssh build boxes. `scripts/release.sh`:

1. Reads `CHANGELOG.md` `[Unreleased]`, promotes it to `[1.X.Y] — DATE`
2. Bumps version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`
3. Commits "Release vX.Y.Z", tags `vX.Y.Z`, pushes main + tag

The tag push triggers `.github/workflows/build.yml`:

4. `check` (tsc / biome / bun test / cargo test), then the matrix — `linux-x86_64` (ubuntu-22.04), `linux-aarch64` (ubuntu-22.04-arm), `windows-x86_64` (windows-latest), `windows-aarch64` (windows-11-arm), `macos-x86_64` (macos-15-intel), `macos-aarch64` (macos-latest). Each cell runs `tauri build --target <triple>` and uploads `ambient-<cell>`
5. `publish` → `scripts/publish.sh`: **partial-aware** — renames whatever cells built to the `Ambient-VERSION-Platform-Arch.ext` naming, pulls the release notes from `CHANGELOG.md`, and creates/updates the `gh release` with them attached

**Prerequisites**: `gh` authenticated, clean working tree. No repo
secrets are needed; the automatic `GITHUB_TOKEN` creates the release and
uploads the assets.

**Cost**: macOS runners bill 10×, Windows 2×. The repo is public, so
hosted-runner minutes are free, but the matrix still never runs on plain
main pushes.

**If a cell fails**: the rest still publish. Rebuild just that cell and attach it: `gh workflow run build.yml -f targets=<cell> -f publish=true` (comma-separate for several). **If publish itself failed** (gh outage): `bun run release:publish -- 1.X.Y --run <run-id>` re-runs it locally from that run's artifacts — `gh release upload --clobber` is idempotent.

## The gotchas that have actually bitten

### 1. Tauri capabilities allow-list

`src-tauri/capabilities/default.json` has an `http:default` permission with a per-URL `allow` list. Plugin-http silently fails on any host not on the list — **no error to JavaScript, just a rejected promise**. When adding any new external HTTP call to the app, **also add its URL pattern here**. A feature once shipped completely broken because its API host wasn't on the list; it took a debug round to figure out the request never left the machine.

### 2. linuxdeploy fails inside `tauri build`

After `bun run tauri build` errors with `failed to run linuxdeploy`, the Rust binary IS built but the AppImage is missing. Recover by hand:

```bash
cd src-tauri/target/release/bundle/appimage
NO_STRIP=true ~/.cache/tauri/linuxdeploy-x86_64.AppImage \
  --appdir Ambient.AppDir --output appimage
```

Produces `Ambient-x86_64.AppImage` in the same directory. The CI matrix sidesteps this by building on Ubuntu runners with `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true` — the failure only bites a bare host `tauri build` on non-Ubuntu distros, so this manual recovery is just for ad-hoc local builds.

### 3. Bun not in `/bin/sh` PATH

The system shell doesn't see bun by default — `tauri build` spawns the `beforeBuildCommand` (`bun run build`) via `sh` and fails to find bun. Always invoke as:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run tauri build
```

### 4. Flatpak is deleted (post-0.4)

`flatpak/com.ambient.app.yaml`, `.flatpak-builder/`, the `build-flatpak` CI job, and the `flatpak:build` npm script are all gone. Linux ships as AppImage only — both x86_64 and aarch64. Restore from git history if Flathub re-enters scope.

## Open to-dos

- Signed binaries for macOS / Windows so the "from the internet" warning goes away

## License history

Repo was private from 2026-05-15 to 2026-10-16 with a proprietary LICENSE in between; it is public and MIT-licensed again as of 2026-10-16.

Commits made during the proprietary window remain in history under the licence they were published with; everything from the MIT re-licence commit onward is MIT.
