#!/usr/bin/env bash
# scripts/release.sh — prep + tag + push, then build & publish locally.
#
# Usage: bun run release <version>   (e.g. bun run release 1.3.0)
#
# What it does:
#   1. Validates the version arg + clean working tree
#   2. Promotes CHANGELOG.md's [Unreleased] section to [v<VERSION>] -
#      DATE and seeds a fresh empty Unreleased scaffold on top
#   3. Bumps version in package.json, src-tauri/Cargo.toml,
#      src-tauri/Cargo.lock, src-tauri/tauri.conf.json
#   4. Commits "Release v<VERSION>"
#   5. Tags v<VERSION>
#   6. Pushes commit + tag — the tag-push trigger in
#      .github/workflows/build.yml builds ONLY macOS (the one target
#      that needs Apple's SDK/notarisation and can't be cross-built here)
#   7. Builds every OTHER platform locally (Linux x86_64/aarch64 AppImage
#      + Windows x86_64/aarch64) via build-local.sh, then publishes them
#      with publish-local.sh — partial-aware, so the feed goes live with
#      Linux+Windows immediately and macOS folds in once CI finishes
#      (the scheduled publish-macos run, or `publish-local.sh --ci-run`).
#
# Skip the local half (tag/push only, e.g. macOS-only re-cut):
#   bun run release <version> --no-local
#
# Pre-0.7 a ~430-line bash script ran the whole release locally; 0.7–1.2
# pushed everything to a 5-platform CI matrix. CI hit Actions budget
# limits, so the split above is the durable arrangement: local owns the
# cross-buildable platforms, CI owns only macOS.

set -euo pipefail

VERSION="${1:-}"
RUN_LOCAL=1
for arg in "$@"; do [[ "$arg" == "--no-local" ]] && RUN_LOCAL=0; done
if [[ -z "$VERSION" || "$VERSION" == "--"* ]]; then
  echo "Usage: $0 <version> [--no-local]   (e.g. $0 1.3.0)" >&2
  exit 1
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be MAJOR.MINOR.PATCH (got: '$VERSION')" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Commit or stash first." >&2
  git status --short
  exit 1
fi

CURRENT_VERSION="$(node -e "console.log(require('./package.json').version)")"
if [[ "$VERSION" == "$CURRENT_VERSION" ]]; then
  echo "Version $VERSION is already the current version. Pick a new one." >&2
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION already exists. Pick a new version or delete the tag first:" >&2
  echo "  git tag -d v$VERSION && git push --delete origin v$VERSION" >&2
  exit 1
fi

# Preflight the LOCAL build environment BEFORE we tag + push. The push
# triggers CI and makes vX.Y.Z public, so a missing tool or an unreachable
# orion must fail here — not after the tag is already out and the local
# half bails mid-build. Mirrors build-local.sh's own checks; skipped with
# --no-local. ARM_HOST defaults to orion (the native-arm64 AppImage box).
if [[ "$RUN_LOCAL" -eq 1 ]]; then
  echo "==> Preflighting the local build environment"
  ARM_HOST="${ARM_HOST:-orion}"
  fail=0
  command -v "$HOME/.cargo/bin/cargo-xwin" >/dev/null || { echo "  ✗ cargo-xwin missing (cargo install cargo-xwin)" >&2; fail=1; }
  command -v makensis >/dev/null || { echo "  ✗ makensis missing (Arch AUR 'nsis')" >&2; fail=1; }
  [[ -f "$HOME/.config/ambient/updater-private.key" ]] || { echo "  ✗ updater key missing at ~/.config/ambient/updater-private.key" >&2; fail=1; }
  if ssh -o BatchMode=yes -o ConnectTimeout=8 "$ARM_HOST" 'command -v podman >/dev/null' 2>/dev/null; then
    echo "  ✓ $ARM_HOST reachable over ssh and has podman (arm64 AppImage build)"
  else
    echo "  ✗ $ARM_HOST unreachable over ssh, or podman not installed there." >&2
    echo "    The arm64 AppImage builds in an ubuntu:26.04 container ON $ARM_HOST" >&2
    echo "    (native aarch64). Fix ssh access / install podman, set ARM_HOST=<host>," >&2
    echo "    or re-run with --no-local to tag + push for the macOS-only CI build." >&2
    fail=1
  fi
  [[ "$fail" -eq 0 ]] || { echo "Preflight failed — nothing tagged or pushed." >&2; exit 1; }
fi

echo "==> Releasing v$VERSION (was $CURRENT_VERSION)"

# --- 1. Promote CHANGELOG's [Unreleased] section --------------------

node --input-type=module -e "
  import fs from 'node:fs';
  const v = '$VERSION';
  const date = new Date().toISOString().slice(0, 10);
  let text = fs.readFileSync('./CHANGELOG.md', 'utf8');
  const re = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|\$)/;
  const m = text.match(re);
  if (!m) {
    console.error('Could not find ## [Unreleased] in CHANGELOG.md');
    process.exit(1);
  }
  const body = m[1].trim();
  const promotedHeader = '## [' + v + '] — ' + date;
  const promoted = body.length > 0
    ? promotedHeader + '\n\n' + body + '\n'
    : promotedHeader + '\n\n_No notable changes._\n';
  const freshUnreleased =
    '## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n' + promoted;
  text = text.replace(re, freshUnreleased);
  fs.writeFileSync('./CHANGELOG.md', text);
  console.log('    CHANGELOG.md updated.');
"

# --- 2. Bump manifests ----------------------------------------------

echo "==> Bumping version in manifests"

# package.json
node -e "
  const fs = require('fs');
  const f = './package.json';
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.version = '$VERSION';
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
"

# src-tauri/tauri.conf.json
node -e "
  const fs = require('fs');
  const f = './src-tauri/tauri.conf.json';
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.version = '$VERSION';
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
"

# src-tauri/Cargo.toml — replace only the FIRST `version = "..."`
# line (which is the [package] section's version, not a dep version).
awk -v v="$VERSION" '
  BEGIN { done = 0 }
  /^version[[:space:]]*=[[:space:]]*"[^"]+"/ && !done {
    print "version = \"" v "\""
    done = 1
    next
  }
  { print }
' src-tauri/Cargo.toml > src-tauri/Cargo.toml.tmp
mv src-tauri/Cargo.toml.tmp src-tauri/Cargo.toml

# Regenerate Cargo.lock so the version in the lock matches.
(cd src-tauri && cargo update --workspace --quiet)

# --- 3. Commit + tag + push -----------------------------------------

echo "==> Committing + tagging"
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"

echo "==> Pushing main + tag — CI builds macOS only"
git push origin main "v$VERSION"

if [[ "$RUN_LOCAL" -eq 0 ]]; then
  cat <<EOF

✓ Tagged v$VERSION and pushed (--no-local: skipped local build/publish).
  Run the local half yourself when ready:
    bun run release:local
EOF
  exit 0
fi

# --- 4. Build + publish the non-macOS platforms locally -------------
# build-local.sh stages into build-out/; publish-local.sh is partial-
# aware, so this goes live with Linux+Windows and leaves macOS pointing
# at the previous release until CI's macOS build is folded in (the
# scheduled publish-macos run, or `publish-local.sh $VERSION --ci-run <id>`).

# A previous release's --ci-run download leaves its macOS artifacts in
# build-out/; publish-local.sh stages whatever it finds there, which would
# ship the OLD macOS binary under this version's filenames. Wipe it so
# macOS genuinely stays "previous release" in the manifest until fold-in.
rm -rf "$REPO_ROOT/build-out/ambient-macos-latest-aarch64"

echo "==> Building local platforms (Linux + Windows)"
bash "$REPO_ROOT/scripts/build-local.sh"

echo "==> Publishing (partial-aware: Linux + Windows now, macOS later)"
bash "$REPO_ROOT/scripts/publish-local.sh" "$VERSION"

cat <<EOF

✓ v$VERSION tagged, pushed, and published (Linux + Windows live now).

  macOS is still building on CI. Fold it in once that run finishes:
    gh run watch                              # find the build.yml run id
    bun run publish:local $VERSION --ci-run <run-id>
  (Or let the scheduled publish-macos routine do it.)

  Release:  https://github.com/atayoez/ambient/releases/tag/v$VERSION
  Manifest: https://ambient.oezcan.me/downloads/latest.json
EOF
