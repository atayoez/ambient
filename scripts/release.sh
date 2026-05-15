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

echo "==> Releasing v$VERSION (was $CURRENT_VERSION)"

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

echo "==> Committing version bump"
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "Release v$VERSION"
git push origin main

HEAD_SHA="$(git rev-parse HEAD)"
echo "    HEAD is now $HEAD_SHA"

# --- 3. Wait for CI to build mac + win ------------------------------

echo "==> Locating CI run for this commit"
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID="$(gh run list --workflow=build.yml --limit 5 --json databaseId,headSha \
    --jq '.[] | select(.headSha == "'"$HEAD_SHA"'") | .databaseId' | head -n1)"
  if [[ -n "$RUN_ID" ]]; then break; fi
  sleep 2
done
if [[ -z "$RUN_ID" ]]; then
  echo "Couldn't find a CI run for $HEAD_SHA. Find it manually with: gh run list" >&2
  exit 1
fi
echo "    CI run: $RUN_ID"
echo "==> Waiting for CI (mac + win build typically ~6 min total)"
gh run watch "$RUN_ID" --exit-status >/dev/null

# --- 4. Download mac + win artifacts --------------------------------

WORKDIR="$(mktemp -d -t ambient-release-XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Downloading CI artifacts to $WORKDIR"
gh run download "$RUN_ID" -n ambient-macos-latest   -D "$WORKDIR/macos"   >/dev/null
gh run download "$RUN_ID" -n ambient-windows-latest -D "$WORKDIR/windows" >/dev/null

DMG="$(find "$WORKDIR/macos" -name "*.dmg" -print -quit)"
EXE="$(find "$WORKDIR/windows" -name "*.exe" -print -quit)"
if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  echo "macOS .dmg not found in artifact" >&2; exit 1
fi
if [[ -z "$EXE" || ! -f "$EXE" ]]; then
  echo "Windows .exe not found in artifact" >&2; exit 1
fi
echo "    macOS: $DMG"
echo "    Windows: $EXE"

# --- 5. Build Linux locally -----------------------------------------

echo "==> Building Linux AppImage locally"
# tauri's own bundling step sometimes errors on linuxdeploy invocation
# even though the AppDir is fine. Tolerate exit-1 and finish by hand.
bun run tauri build || true
APPIMAGE=""
# Tauri 2's AppImage filename can vary across versions; pick whatever's in
# the appimage/ bundle dir, falling back to the manual linuxdeploy step.
APPIMAGE_DIR="src-tauri/target/release/bundle/appimage"
APPIMAGE="$(find "$APPIMAGE_DIR" -maxdepth 1 -name "*.AppImage" -print -quit 2>/dev/null || true)"
if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
  echo "    Tauri bundling didn't emit an AppImage. Running linuxdeploy manually."
  (
    cd "$APPIMAGE_DIR"
    NO_STRIP=true ~/.cache/tauri/linuxdeploy-x86_64.AppImage \
      --appdir Ambient.AppDir --output appimage
  )
  APPIMAGE="$(find "$APPIMAGE_DIR" -maxdepth 1 -name "*.AppImage" -print -quit)"
fi
if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
  echo "AppImage build failed — no file produced in $APPIMAGE_DIR" >&2
  exit 1
fi
echo "    Linux: $APPIMAGE"

# --- 6. Upload to R2 ------------------------------------------------

DMG_NAME="Ambient_${VERSION}_aarch64.dmg"
EXE_NAME="Ambient_${VERSION}_x64-setup.exe"
APPIMAGE_NAME="Ambient_${VERSION}_x86_64.AppImage"

echo "==> Uploading installers to R2"
(
  cd website
  bunx wrangler r2 object put "ambient-releases/$DMG_NAME" \
    --file="$DMG" \
    --content-type=application/x-apple-diskimage --remote >/dev/null
  bunx wrangler r2 object put "ambient-releases/$EXE_NAME" \
    --file="$EXE" \
    --content-type=application/vnd.microsoft.portable-executable --remote >/dev/null
  bunx wrangler r2 object put "ambient-releases/$APPIMAGE_NAME" \
    --file="$REPO_ROOT/$APPIMAGE" \
    --content-type=application/x-executable --remote >/dev/null
)

# --- 7. Update latest.json ------------------------------------------

RELEASED="$(date -u +%Y-%m-%d)"
LATEST_JSON="$WORKDIR/latest.json"
cat > "$LATEST_JSON" <<EOF
{
  "version": "$VERSION",
  "released": "$RELEASED",
  "notes": "Release v$VERSION",
  "downloads": {
    "macos":   "https://ambient.oezcan.me/downloads/$DMG_NAME",
    "windows": "https://ambient.oezcan.me/downloads/$EXE_NAME",
    "linux":   "https://ambient.oezcan.me/downloads/$APPIMAGE_NAME"
  }
}
EOF

echo "==> Uploading new latest.json"
(
  cd website
  bunx wrangler r2 object put ambient-releases/latest.json \
    --file="$LATEST_JSON" \
    --content-type=application/json --remote >/dev/null
)

# --- 8. Tag the release ---------------------------------------------

echo "==> Tagging v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"

# --- done ------------------------------------------------------------

echo
echo "✓ Released v$VERSION"
echo
echo "  Manifest:    https://ambient.oezcan.me/downloads/latest.json"
echo "  Download:    https://ambient.oezcan.me/#download"
echo "  Latest mac:  https://ambient.oezcan.me/downloads/latest/macos"
echo "  Latest win:  https://ambient.oezcan.me/downloads/latest/windows"
echo "  Latest nix:  https://ambient.oezcan.me/downloads/latest/linux"
