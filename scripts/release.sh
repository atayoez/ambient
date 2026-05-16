#!/usr/bin/env bash
# scripts/release.sh — cut a new Ambient release.
#
# Usage: bun run release <version>   (e.g. bun run release 0.2.0)
#
# What it does, in order:
# 1. Validates the version arg + clean working tree
# 2. Bumps "version" in package.json, src-tauri/Cargo.toml,
#    src-tauri/tauri.conf.json
# 3. Commits the bump and pushes to main — triggers CI
# 4. Waits for the matching CI run to finish, downloads the macOS .dmg
#    and Windows .exe artifacts
# 5. Builds the Linux AppImage locally (with the linuxdeploy-manual
#    fallback we've been needing under tauri's bundling step)
# 6. Uploads all three installers to the ambient-releases R2 bucket
#    under versioned names: Ambient_<VERSION>_{aarch64,x64-setup,x86_64}.{dmg,exe,AppImage}
# 7. Generates a fresh latest.json and uploads it
# 8. Tags v<VERSION> and pushes the tag
#
# The Worker's /downloads/latest/{platform} aliases resolve via
# latest.json, so the marketing site's Download cards never need
# touching across releases.
#
# Prerequisites: bun, gh CLI (authenticated), wrangler-authenticated
# Cloudflare account, host webkit2gtk-4.1 + linuxdeploy in
# ~/.cache/tauri/ (will be present after one successful local build).

set -euo pipefail

# --- args + env ------------------------------------------------------

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>   (e.g. $0 0.2.0)" >&2
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

# Make sure bun is in PATH for child shells (e.g. tauri build → bun run build)
export PATH="$HOME/.bun/bin:$PATH"

# Tauri update-signing key. If present, each shipped artifact gets a
# minisign signature embedded in latest.json's platforms block; the
# plugin then verifies on download_and_install. Without it, we still
# ship + still write the legacy `downloads` block (so the manual
# updater banner keeps working), but auto-install won't be available.
TAURI_SIGNING_PRIVATE_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.config/ambient/updater-private.key}"
SIGN_ENABLED=false
if [[ -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]]; then
  SIGN_ENABLED=true
  export TAURI_SIGNING_PRIVATE_KEY_PATH
fi

# Sign one artifact in place. Stdout is the base64 signature suitable
# for embedding in latest.json's platforms.<key>.signature field.
sign_artifact() {
  local f="$1"
  bunx tauri signer sign \
    -k "$TAURI_SIGNING_PRIVATE_KEY_PATH" \
    --password "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
    "$f" >/dev/null
  cat "${f}.sig"
}

echo "==> Releasing v$VERSION (was $CURRENT_VERSION)"
if [[ "$SIGN_ENABLED" == "true" ]]; then
  echo "    Update signing: ENABLED (key at $TAURI_SIGNING_PRIVATE_KEY_PATH)"
else
  echo "    Update signing: DISABLED (set TAURI_SIGNING_PRIVATE_KEY_PATH to enable)"
fi

# --- 0. Promote CHANGELOG's [Unreleased] section --------------------
# The Unreleased section becomes the new v$VERSION section, and we
# stash its body to a temp file so we can pass it as release notes to
# `gh release create` later. If the section is empty, we still proceed
# (the release notes will just be a one-liner).

NOTES_FILE="$(mktemp -t ambient-notes-XXXXXX.md)"

node --input-type=module -e "
  import fs from 'node:fs';
  const v = '$VERSION';
  const date = new Date().toISOString().slice(0, 10);
  let text = fs.readFileSync('./CHANGELOG.md', 'utf8');

  // Capture [Unreleased] block up to the next '## [' header (or EOF).
  const re = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|\$)/;
  const m = text.match(re);
  if (!m) {
    console.error('Could not find ## [Unreleased] in CHANGELOG.md');
    process.exit(1);
  }
  const body = m[1].trim();

  // Strip empty (### Added / Changed / Fixed with no entries below)
  // sub-sections from the release notes — they're noise in the
  // release page, but we keep them as scaffolding in the new
  // [Unreleased] section so the next release has a template.
  const cleanedNotes = body
    .split(/\n(?=### )/)
    .filter(s => s.split(/\n+/).slice(1).join('\n').trim().length > 0)
    .join('\n')
    .trim();

  const notesForRelease = cleanedNotes.length > 0
    ? cleanedNotes
    : '_No changelog entries — see commit history._';
  fs.writeFileSync('$NOTES_FILE', notesForRelease + '\n');

  // Rewrite CHANGELOG.md: replace the [Unreleased] block with a fresh
  // empty Unreleased + the promoted versioned section.
  const promotedHeader = '## [' + v + '] — ' + date;
  const promoted = body.length > 0
    ? promotedHeader + '\n\n' + body + '\n'
    : promotedHeader + '\n\n_No notable changes._\n';

  const freshUnreleased = '## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n' + promoted;

  text = text.replace(re, freshUnreleased);
  fs.writeFileSync('./CHANGELOG.md', text);
  console.log('    CHANGELOG.md updated. Release notes saved to $NOTES_FILE');
"

# --- 1. Bump manifests ----------------------------------------------

echo "==> Bumping version in manifests"

# package.json — simple jq-style replace via node (already on disk).
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

# src-tauri/Cargo.toml — replace only the FIRST `version = "..."` line
# (which is the [package] section's version, not a dep version).
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

# --- 2. Commit + push ------------------------------------------------

echo "==> Committing version bump + CHANGELOG"
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "Release v$VERSION"
git push origin main

HEAD_SHA="$(git rev-parse HEAD)"
echo "    HEAD is now $HEAD_SHA"

# --- 3. Dispatch + wait for CI build (mac + win matrix) -------------
# build-tauri is gated to workflow_dispatch (see .github/workflows/
# build.yml). The push above only ran the cheap `check` job; we
# kick off the actual build matrix here so it doesn't fire on every
# main push.

echo "==> Dispatching build-tauri workflow"
gh workflow run build.yml --ref main

echo "==> Locating dispatched run"
RUN_ID=""
for _ in $(seq 1 30); do
  # Filter by event=workflow_dispatch so we don't accidentally grab
  # the cheap check-only run that the push above triggered.
  RUN_ID="$(gh run list --workflow=build.yml --limit 10 --json databaseId,headSha,event \
    --jq '.[] | select(.headSha == "'"$HEAD_SHA"'" and .event == "workflow_dispatch") | .databaseId' | head -n1)"
  if [[ -n "$RUN_ID" ]]; then break; fi
  sleep 2
done
if [[ -z "$RUN_ID" ]]; then
  echo "Couldn't find the dispatched CI run for $HEAD_SHA. Re-dispatch manually: gh workflow run build.yml --ref main" >&2
  exit 1
fi
echo "    CI run: $RUN_ID"
echo "==> Waiting for CI (mac + win matrix typically ~10 min)"
gh run watch "$RUN_ID" --exit-status >/dev/null

# --- 4. Download mac + win artifacts --------------------------------

WORKDIR="$(mktemp -d -t ambient-release-XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Downloading CI artifacts to $WORKDIR"
# Three-arch CI matrix: mac aarch64, win x64, win arm64. Both Linux
# builds are local (next steps): x86_64 against the host toolchain,
# aarch64 via Docker + QEMU.
gh run download "$RUN_ID" -n "ambient-macos-latest-aarch64"     -D "$WORKDIR/macos-aarch64"   >/dev/null
gh run download "$RUN_ID" -n "ambient-windows-latest-x86_64"    -D "$WORKDIR/windows-x86_64"  >/dev/null
gh run download "$RUN_ID" -n "ambient-windows-11-arm-aarch64"   -D "$WORKDIR/windows-aarch64" >/dev/null

DMG_AARCH64="$(find "$WORKDIR/macos-aarch64"   -name "*.dmg"      -print -quit)"
MSI_X64="$(find       "$WORKDIR/windows-x86_64"  -name "*.msi"      -print -quit)"
MSI_AARCH64="$(find   "$WORKDIR/windows-aarch64" -name "*.msi"      -print -quit)"

for f in "$DMG_AARCH64" "$MSI_X64" "$MSI_AARCH64"; do
  if [[ -z "$f" || ! -f "$f" ]]; then
    echo "Missing one or more CI artifacts. WORKDIR=$WORKDIR" >&2
    ls -R "$WORKDIR" >&2
    exit 1
  fi
done

echo "    macOS  aarch64:  $DMG_AARCH64"
echo "    Windows x86_64:  $MSI_X64"
echo "    Windows aarch64: $MSI_AARCH64"

# --- 5. Build both Linux variants locally ---------------------------
# x86_64 against the host webkit2gtk-4.1 toolchain. aarch64 via
# Docker + QEMU (see scripts/build-linux-arm64.sh). Both keep Linux
# builds off the CI minute meter.

echo "==> Building Linux x86_64 AppImage locally"
# tauri's bundling step sometimes errors on linuxdeploy invocation
# even though the AppDir is fine. Tolerate exit-1 and finish by hand.
bun run tauri build || true
APPIMAGE_DIR="src-tauri/target/release/bundle/appimage"
APPIMAGE_X64="$(find "$APPIMAGE_DIR" -maxdepth 1 -name "*.AppImage" -print -quit 2>/dev/null || true)"
if [[ -z "$APPIMAGE_X64" || ! -f "$APPIMAGE_X64" ]]; then
  echo "    Tauri bundling didn't emit an AppImage. Running linuxdeploy manually."
  (
    cd "$APPIMAGE_DIR"
    NO_STRIP=true ~/.cache/tauri/linuxdeploy-x86_64.AppImage \
      --appdir Ambient.AppDir --output appimage
  )
  APPIMAGE_X64="$(find "$APPIMAGE_DIR" -maxdepth 1 -name "*.AppImage" -print -quit)"
fi
if [[ -z "$APPIMAGE_X64" || ! -f "$APPIMAGE_X64" ]]; then
  echo "Local Linux x86_64 build failed — no file produced in $APPIMAGE_DIR" >&2
  exit 1
fi
APPIMAGE_X64="$REPO_ROOT/$APPIMAGE_X64"
echo "    Linux x86_64: $APPIMAGE_X64"

echo "==> Building Linux aarch64 AppImage locally (Docker + QEMU)"
echo "    First run takes ~40 min for the apt + cargo cold start;"
echo "    subsequent runs are ~15 min with the named-volume caches."
APPIMAGE_AARCH64="$("$REPO_ROOT/scripts/build-linux-arm64.sh")"
if [[ -z "$APPIMAGE_AARCH64" || ! -f "$APPIMAGE_AARCH64" ]]; then
  echo "Local Linux aarch64 build failed" >&2
  exit 1
fi
echo "    Linux aarch64: $APPIMAGE_AARCH64"

# --- 6. Sign + upload to R2 -----------------------------------------

DMG_AARCH64_NAME="Ambient-${VERSION}-macOS-aarch64.dmg"
MSI_X64_NAME="Ambient-${VERSION}-Windows-x86_64.msi"
MSI_AARCH64_NAME="Ambient-${VERSION}-Windows-aarch64.msi"
APPIMAGE_X64_NAME="Ambient-${VERSION}-Linux-x86_64.AppImage"
APPIMAGE_AARCH64_NAME="Ambient-${VERSION}-Linux-aarch64.AppImage"

DMG_AARCH64_SIG=""; MSI_X64_SIG=""; MSI_AARCH64_SIG=""
APPIMAGE_X64_SIG=""; APPIMAGE_AARCH64_SIG=""
if [[ "$SIGN_ENABLED" == "true" ]]; then
  echo "==> Signing artifacts with Tauri update key"
  DMG_AARCH64_SIG="$(sign_artifact "$DMG_AARCH64")"
  MSI_X64_SIG="$(sign_artifact "$MSI_X64")"
  MSI_AARCH64_SIG="$(sign_artifact "$MSI_AARCH64")"
  APPIMAGE_X64_SIG="$(sign_artifact "$APPIMAGE_X64")"
  APPIMAGE_AARCH64_SIG="$(sign_artifact "$APPIMAGE_AARCH64")"
fi

echo "==> Uploading installers to R2"
(
  cd website
  bunx wrangler r2 object put "ambient-releases/$DMG_AARCH64_NAME" \
    --file="$DMG_AARCH64" \
    --content-type=application/x-apple-diskimage --remote >/dev/null
  bunx wrangler r2 object put "ambient-releases/$MSI_X64_NAME" \
    --file="$MSI_X64" \
    --content-type=application/x-msi --remote >/dev/null
  bunx wrangler r2 object put "ambient-releases/$MSI_AARCH64_NAME" \
    --file="$MSI_AARCH64" \
    --content-type=application/x-msi --remote >/dev/null
  bunx wrangler r2 object put "ambient-releases/$APPIMAGE_X64_NAME" \
    --file="$APPIMAGE_X64" \
    --content-type=application/x-executable --remote >/dev/null
  bunx wrangler r2 object put "ambient-releases/$APPIMAGE_AARCH64_NAME" \
    --file="$APPIMAGE_AARCH64" \
    --content-type=application/x-executable --remote >/dev/null
)

# --- 7. Update latest.json ------------------------------------------

RELEASED="$(date -u +%Y-%m-%d)"
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LATEST_JSON="$WORKDIR/latest.json"

# Dual-shape manifest:
#  - `version` + `downloads` keep the legacy v0.3-and-earlier updater
#    + the Worker's /downloads/latest/<platform> 302 aliases working.
#    `downloads.windows` / `downloads.linux` default to the x86_64
#    variants since that's the vast majority of users; -arm64 aliases
#    handle the rest (see worker.js).
#  - `pub_date` + `platforms` are what tauri-plugin-updater reads.
#    Five platform keys, one per matrix arch. Only emitted when
#    signing is enabled; without a signature the plugin would reject
#    the artifact at install time anyway, and the absence cleanly
#    degrades to "no update available" rather than "downloaded then
#    failed verification."
PLATFORMS_BLOCK=""
if [[ "$SIGN_ENABLED" == "true" ]]; then
  # Escape newlines + quotes for JSON embedding.
  esc() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip()))'; }
  DMG_AARCH64_SIG_JSON="$(printf      '%s' "$DMG_AARCH64_SIG"      | esc)"
  MSI_X64_SIG_JSON="$(printf          '%s' "$MSI_X64_SIG"          | esc)"
  MSI_AARCH64_SIG_JSON="$(printf      '%s' "$MSI_AARCH64_SIG"      | esc)"
  APPIMAGE_X64_SIG_JSON="$(printf     '%s' "$APPIMAGE_X64_SIG"     | esc)"
  APPIMAGE_AARCH64_SIG_JSON="$(printf '%s' "$APPIMAGE_AARCH64_SIG" | esc)"
  PLATFORMS_BLOCK=$(cat <<PEOF
,
  "platforms": {
    "darwin-aarch64": {
      "signature": $DMG_AARCH64_SIG_JSON,
      "url": "https://ambient.oezcan.me/downloads/$DMG_AARCH64_NAME"
    },
    "windows-x86_64": {
      "signature": $MSI_X64_SIG_JSON,
      "url": "https://ambient.oezcan.me/downloads/$MSI_X64_NAME"
    },
    "windows-aarch64": {
      "signature": $MSI_AARCH64_SIG_JSON,
      "url": "https://ambient.oezcan.me/downloads/$MSI_AARCH64_NAME"
    },
    "linux-x86_64": {
      "signature": $APPIMAGE_X64_SIG_JSON,
      "url": "https://ambient.oezcan.me/downloads/$APPIMAGE_X64_NAME"
    },
    "linux-aarch64": {
      "signature": $APPIMAGE_AARCH64_SIG_JSON,
      "url": "https://ambient.oezcan.me/downloads/$APPIMAGE_AARCH64_NAME"
    }
  }
PEOF
)
fi

cat > "$LATEST_JSON" <<EOF
{
  "version": "$VERSION",
  "released": "$RELEASED",
  "pub_date": "$PUB_DATE",
  "notes": "Release v$VERSION",
  "downloads": {
    "macos":         "https://ambient.oezcan.me/downloads/$DMG_AARCH64_NAME",
    "windows":       "https://ambient.oezcan.me/downloads/$MSI_X64_NAME",
    "windows-arm64": "https://ambient.oezcan.me/downloads/$MSI_AARCH64_NAME",
    "linux":         "https://ambient.oezcan.me/downloads/$APPIMAGE_X64_NAME",
    "linux-arm64":   "https://ambient.oezcan.me/downloads/$APPIMAGE_AARCH64_NAME"
  }$PLATFORMS_BLOCK
}
EOF

echo "==> Uploading new latest.json"
(
  cd website
  bunx wrangler r2 object put ambient-releases/latest.json \
    --file="$LATEST_JSON" \
    --content-type=application/json --remote >/dev/null
)

# --- 8. Tag + GitHub release ----------------------------------------

echo "==> Tagging v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"

echo "==> Creating GitHub release with installers attached"
# Notes were collected from CHANGELOG.md's [Unreleased] section at the
# top of this script and stashed to $NOTES_FILE. Repo is private, so
# the release page is collaborator-visible only — serves as our internal
# build archive.
gh release create "v$VERSION" \
  --title "v$VERSION" \
  --notes-file "$NOTES_FILE" \
  "$DMG_AARCH64#Ambient $VERSION (macOS Apple Silicon)" \
  "$MSI_X64#Ambient $VERSION (Windows x86_64 MSI)" \
  "$MSI_AARCH64#Ambient $VERSION (Windows arm64 MSI)" \
  "$APPIMAGE_X64#Ambient $VERSION (Linux x86_64 AppImage)" \
  "$APPIMAGE_AARCH64#Ambient $VERSION (Linux aarch64 AppImage)" \
  >/dev/null

# --- done ------------------------------------------------------------

echo
echo "✓ Released v$VERSION"
echo
echo "  Manifest:    https://ambient.oezcan.me/downloads/latest.json"
echo "  Download:    https://ambient.oezcan.me/#download"
echo "  Latest mac:  https://ambient.oezcan.me/downloads/latest/macos"
echo "  Latest win:  https://ambient.oezcan.me/downloads/latest/windows"
echo "  Latest nix:  https://ambient.oezcan.me/downloads/latest/linux"
echo "  GH release:  $(gh release view "v$VERSION" --json url --jq .url 2>/dev/null || echo '(check gh release list)')"
