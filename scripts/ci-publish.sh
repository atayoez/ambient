#!/usr/bin/env bash
# scripts/ci-publish.sh — runs in the `release` job of build.yml after
# the 5-platform build matrix completes. Takes the freshly-built
# artifacts in ./dist/, renames them, uploads to R2, builds the
# latest.json manifest, and cuts the GitHub release.
#
# Required argv:
#   $1 = version (without v prefix), e.g. 0.7.0
#
# Required env:
#   CLOUDFLARE_API_TOKEN     — R2 Storage Write scope (in repo secret)
#   CLOUDFLARE_ACCOUNT_ID    — public account id; hardcoded by build.yml
#   GH_TOKEN                 — for `gh release create` (= GITHUB_TOKEN)
#
# Required dist/ layout (from actions/download-artifact pattern
# `ambient-*`):
#   dist/ambient-macos-latest-aarch64/      *.dmg + *.dmg.sig
#   dist/ambient-windows-latest-x86_64/     *.msi + *.msi.sig
#   dist/ambient-windows-11-arm-aarch64/    *.msi + *.msi.sig
#   dist/ambient-ubuntu-22.04-arm-aarch64/  *.AppImage + *.AppImage.sig
#   dist/ambient-ubuntu-22.04-x86_64/       *.AppImage + *.AppImage.sig

set -euo pipefail

VERSION="${1:?Usage: $0 <version>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ACCT_DIR="dist"
OUT="dist/renamed"
mkdir -p "$OUT"

find_one() {
  local pattern="$1"
  local dir="$2"
  local found
  found=$(find "$dir" -name "$pattern" -print -quit 2>/dev/null || true)
  if [[ -z "$found" || ! -f "$found" ]]; then
    echo "Missing $pattern in $dir" >&2
    echo "Dist tree:" >&2
    ls -R "$ACCT_DIR" >&2 || true
    return 1
  fi
  echo "$found"
}

echo "==> Locating artifacts"
DMG=$(find_one "*.dmg"          "$ACCT_DIR/ambient-macos-latest-aarch64")
# macOS updater artifact is the .app.tar.gz — Tauri signs the tarball,
# never the .dmg. The .dmg stays the user-facing installer download;
# the tarball + its .sig drive tauri-plugin-updater's macOS entry.
APP_TAR=$(find_one "*.app.tar.gz"     "$ACCT_DIR/ambient-macos-latest-aarch64")
APP_TAR_SIG=$(find_one "*.app.tar.gz.sig" "$ACCT_DIR/ambient-macos-latest-aarch64")
MSI_X64=$(find_one "*.msi"      "$ACCT_DIR/ambient-windows-latest-x86_64")
MSI_X64_SIG=$(find_one "*.msi.sig" "$ACCT_DIR/ambient-windows-latest-x86_64")
MSI_ARM=$(find_one "*.msi"      "$ACCT_DIR/ambient-windows-11-arm-aarch64")
MSI_ARM_SIG=$(find_one "*.msi.sig" "$ACCT_DIR/ambient-windows-11-arm-aarch64")
APP_ARM=$(find_one "*.AppImage" "$ACCT_DIR/ambient-ubuntu-22.04-arm-aarch64")
APP_ARM_SIG=$(find_one "*.AppImage.sig" "$ACCT_DIR/ambient-ubuntu-22.04-arm-aarch64")
APP_X64=$(find_one "*.AppImage" "$ACCT_DIR/ambient-ubuntu-22.04-x86_64")
APP_X64_SIG=$(find_one "*.AppImage.sig" "$ACCT_DIR/ambient-ubuntu-22.04-x86_64")
# Native packages — deb + rpm for both arches, pacman (Arch) x86_64 only.
DEB_X64=$(find_one "*.deb" "$ACCT_DIR/ambient-ubuntu-22.04-x86_64")
DEB_ARM=$(find_one "*.deb" "$ACCT_DIR/ambient-ubuntu-22.04-arm-aarch64")
RPM_X64=$(find_one "*.rpm" "$ACCT_DIR/ambient-ubuntu-22.04-x86_64")
RPM_ARM=$(find_one "*.rpm" "$ACCT_DIR/ambient-ubuntu-22.04-arm-aarch64")
PACMAN_X64=$(find_one "*.pkg.tar.zst" "$ACCT_DIR/ambient-arch-x86_64")

# Release filename convention — matches what release.sh used in v0.4+.
DMG_NAME="Ambient-${VERSION}-macOS-aarch64.dmg"
APP_TAR_NAME="Ambient-${VERSION}-macOS-aarch64.app.tar.gz"
MSI_X64_NAME="Ambient-${VERSION}-Windows-x86_64.msi"
MSI_ARM_NAME="Ambient-${VERSION}-Windows-aarch64.msi"
APP_ARM_NAME="Ambient-${VERSION}-Linux-aarch64.AppImage"
APP_X64_NAME="Ambient-${VERSION}-Linux-x86_64.AppImage"
DEB_X64_NAME="Ambient-${VERSION}-Linux-x86_64.deb"
DEB_ARM_NAME="Ambient-${VERSION}-Linux-aarch64.deb"
RPM_X64_NAME="Ambient-${VERSION}-Linux-x86_64.rpm"
RPM_ARM_NAME="Ambient-${VERSION}-Linux-aarch64.rpm"
PACMAN_X64_NAME="Ambient-${VERSION}-Linux-x86_64.pkg.tar.zst"

echo "==> Renaming to release convention"
cp "$DMG"     "$OUT/$DMG_NAME"
cp "$APP_TAR" "$OUT/$APP_TAR_NAME"
cp "$MSI_X64" "$OUT/$MSI_X64_NAME"
cp "$MSI_ARM" "$OUT/$MSI_ARM_NAME"
cp "$APP_ARM" "$OUT/$APP_ARM_NAME"
cp "$APP_X64" "$OUT/$APP_X64_NAME"
cp "$DEB_X64" "$OUT/$DEB_X64_NAME"
cp "$DEB_ARM" "$OUT/$DEB_ARM_NAME"
cp "$RPM_X64" "$OUT/$RPM_X64_NAME"
cp "$RPM_ARM" "$OUT/$RPM_ARM_NAME"
cp "$PACMAN_X64" "$OUT/$PACMAN_X64_NAME"

echo "==> Building latest.json"
node scripts/build-latest-json.mjs \
  --version "$VERSION" \
  --macos-updater-sig "$APP_TAR_SIG" \
  --msi-x64-sig "$MSI_X64_SIG" \
  --msi-arm-sig "$MSI_ARM_SIG" \
  --appimage-x64-sig "$APP_X64_SIG" \
  --appimage-arm-sig "$APP_ARM_SIG" \
  --output "$OUT/latest.json"

echo "==> Extracting release notes from CHANGELOG.md"
node scripts/extract-changelog.mjs \
  --version "$VERSION" \
  --output "$OUT/notes.md"

echo "==> Uploading to R2"
# bunx auto-installs wrangler@4 on first call, then caches. Pinning
# the major version means a wrangler-side change to the assets/jsonc/r2
# behavior doesn't surprise us mid-release.
WRANGLER="bunx wrangler@4"
upload() {
  local path="$1"
  local name="$2"
  local ct="$3"
  $WRANGLER r2 object put "ambient-releases/$name" \
    --file="$path" \
    --content-type="$ct" \
    --remote
}
upload "$OUT/$DMG_NAME"      "$DMG_NAME"      "application/x-apple-diskimage"
upload "$OUT/$APP_TAR_NAME"  "$APP_TAR_NAME"  "application/gzip"
upload "$OUT/$MSI_X64_NAME"  "$MSI_X64_NAME"  "application/x-msi"
upload "$OUT/$MSI_ARM_NAME"  "$MSI_ARM_NAME"  "application/x-msi"
upload "$OUT/$APP_X64_NAME"  "$APP_X64_NAME"  "application/x-executable"
upload "$OUT/$APP_ARM_NAME"  "$APP_ARM_NAME"  "application/x-executable"
upload "$OUT/$DEB_X64_NAME"  "$DEB_X64_NAME"  "application/vnd.debian.binary-package"
upload "$OUT/$DEB_ARM_NAME"  "$DEB_ARM_NAME"  "application/vnd.debian.binary-package"
upload "$OUT/$RPM_X64_NAME"  "$RPM_X64_NAME"  "application/x-rpm"
upload "$OUT/$RPM_ARM_NAME"  "$RPM_ARM_NAME"  "application/x-rpm"
upload "$OUT/$PACMAN_X64_NAME" "$PACMAN_X64_NAME" "application/zstd"
upload "$OUT/latest.json"    "latest.json"    "application/json"

echo "==> Creating GitHub release"
# `gh release create` is idempotent-ish — if the tag's release already
# exists (e.g. re-running this job after a partial failure) it returns
# non-zero. Detect + upload assets to the existing release instead so
# retries don't strand us.
if gh release view "v$VERSION" >/dev/null 2>&1; then
  echo "    Release v$VERSION already exists — uploading assets via gh release upload --clobber"
  gh release upload "v$VERSION" --clobber \
    "$OUT/$DMG_NAME#Ambient $VERSION (macOS Apple Silicon)" \
    "$OUT/$MSI_X64_NAME#Ambient $VERSION (Windows x86_64 MSI)" \
    "$OUT/$MSI_ARM_NAME#Ambient $VERSION (Windows arm64 MSI)" \
    "$OUT/$APP_X64_NAME#Ambient $VERSION (Linux x86_64 AppImage)" \
    "$OUT/$APP_ARM_NAME#Ambient $VERSION (Linux aarch64 AppImage)" \
    "$OUT/$DEB_X64_NAME#Ambient $VERSION (Debian/Ubuntu x86_64)" \
    "$OUT/$DEB_ARM_NAME#Ambient $VERSION (Debian/Ubuntu aarch64)" \
    "$OUT/$RPM_X64_NAME#Ambient $VERSION (Fedora/RHEL x86_64)" \
    "$OUT/$RPM_ARM_NAME#Ambient $VERSION (Fedora/RHEL aarch64)" \
    "$OUT/$PACMAN_X64_NAME#Ambient $VERSION (Arch x86_64)"
else
  gh release create "v$VERSION" \
    --title "v$VERSION" \
    --notes-file "$OUT/notes.md" \
    "$OUT/$DMG_NAME#Ambient $VERSION (macOS Apple Silicon)" \
    "$OUT/$MSI_X64_NAME#Ambient $VERSION (Windows x86_64 MSI)" \
    "$OUT/$MSI_ARM_NAME#Ambient $VERSION (Windows arm64 MSI)" \
    "$OUT/$APP_X64_NAME#Ambient $VERSION (Linux x86_64 AppImage)" \
    "$OUT/$APP_ARM_NAME#Ambient $VERSION (Linux aarch64 AppImage)" \
    "$OUT/$DEB_X64_NAME#Ambient $VERSION (Debian/Ubuntu x86_64)" \
    "$OUT/$DEB_ARM_NAME#Ambient $VERSION (Debian/Ubuntu aarch64)" \
    "$OUT/$RPM_X64_NAME#Ambient $VERSION (Fedora/RHEL x86_64)" \
    "$OUT/$RPM_ARM_NAME#Ambient $VERSION (Fedora/RHEL aarch64)" \
    "$OUT/$PACMAN_X64_NAME#Ambient $VERSION (Arch x86_64)"
fi

echo
echo "✓ v$VERSION published"
echo "  GH release:  https://github.com/atayozcan/ambient/releases/tag/v$VERSION"
echo "  Manifest:    https://ambient.oezcan.me/downloads/latest.json"
echo "  Direct mac:  https://ambient.oezcan.me/downloads/latest/macos"
