#!/usr/bin/env bash
# scripts/publish-local.sh — publish a release from this machine: sign, build
# latest.json, upload to R2, cut the GitHub release. The local counterpart to
# the old CI `release` job, but PARTIAL-AWARE: it publishes whatever artifacts
# are present and leaves every other platform pointing at the previous release
# in latest.json, so a Mac/ARM build that isn't ready never breaks the feed.
#
# Expects (whatever exists) under $SRC, in build-local.sh's layout:
#   $SRC/ambient-linux-x86_64/          *.AppImage(.sig)   (build-local.sh)
#   $SRC/ambient-linux-arm-aarch64/     *.AppImage(.sig)   (build-local.sh, on $ARM_HOST)
#   $SRC/ambient-windows-latest-x86_64/ *-setup.exe(.sig)  (build-local.sh, signed)
#   $SRC/ambient-windows-11-arm-aarch64/ *-setup.exe(.sig) (build-local.sh, signed)
#   $SRC/ambient-macos-latest-aarch64/  *.dmg *.app.tar.gz(.sig)  (CI only, via --ci-run)
#
# Pull the CI-built macOS/ARM artifacts first with:  --ci-run <run-id>
# (downloads `ambient-*` artifacts from that build.yml run into dist/).
#
# Usage:  scripts/publish-local.sh <version> [--ci-run <run-id>]
# Env:    CLOUDFLARE_ACCOUNT_ID (default below); wrangler must be logged in.
#         RPM_GPG_PRIVATE_KEY/RPM_GPG_PASSPHRASE optional (else rpm ships unsigned).

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO_ROOT"

# Version defaults to package.json; a numeric positional arg overrides it.
VERSION="$(node -e "console.log(require('./package.json').version)")"
CI_RUN=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ci-run) CI_RUN="${2:?--ci-run needs a run id}"; shift 2;;
    [0-9]*)   VERSION="$1"; shift;;
    *) echo "unknown arg: $1" >&2; shift;;
  esac
done

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-848c6419822ef3e91b6f66d69ebe63eb}"
# Source dir for the ambient-* artifact subdirs: build-out/ when present (the
# local build-local.sh stages there, kept clear of vite's dist/), else dist/
# (CI download-artifact path, e.g. publish-macos.yml).
SRC="${AMBIENT_STAGE:-$([ -d build-out ] && echo build-out || echo dist)}"
# Start the rename staging dir EMPTY: the upload + GH-release globs match
# `Ambient-*`, so a previous release's renamed artifacts left here would be
# re-uploaded and attached to this version's release. Wipe, don't merge.
OUT="$SRC/renamed"; rm -rf "$OUT"; mkdir -p "$OUT"
WRANGLER="bunx wrangler@4"

if [[ -n "$CI_RUN" ]]; then
  echo "==> Downloading CI artifacts from run $CI_RUN"
  gh run download "$CI_RUN" --dir "$SRC" --pattern 'ambient-*' || echo "   (no CI artifacts; continuing partial)"
fi

# Windows: scripts/build-local.sh cross-compiles a signed NSIS setup.exe (+ a
# .sig) for x86_64; the arm64 setup.exe comes from CI (--ci-run). Both are
# updater-signed at build time, so there's nothing to sign here.

# Sign rpms only if the *correct* packaging key is provided (the one whose
# public half is on the site). It isn't in the local keyring, so by default
# rpms ship unsigned (dnf/zypper warn but install) rather than mis-signed.
if [[ -n "${RPM_GPG_PRIVATE_KEY:-}" ]]; then
  for rpm in $(find "$SRC" -name '*.rpm' 2>/dev/null); do
    "${CONTAINER:-podman}" --storage-driver vfs --root /tmp/ambient-pbuild run --rm \
      -v "$REPO_ROOT/$(dirname "$rpm")":/out -v "$REPO_ROOT/scripts":/scripts:ro \
      -e RPM_GPG_PRIVATE_KEY -e RPM_GPG_PASSPHRASE \
      docker.io/library/almalinux:9 bash /scripts/sign-rpms.sh "/out/$(basename "$rpm")"
  done
else
  echo "==> RPM_GPG_PRIVATE_KEY not set — rpms ship UNSIGNED"
fi

# Rename present artifacts to the release convention + remember which we have.
declare -A HAVE
stage() { # <glob-dir> <glob> <release-name> <download-key>
  local f; f=$(find "$1" -name "$2" 2>/dev/null | head -1 || true)
  [[ -n "$f" && -f "$f" ]] || return 0
  cp "$f" "$OUT/$3"; HAVE[$4]="$OUT/$3"; echo "   have $4 -> $3"
}
echo "==> Staging present artifacts"
stage $SRC/ambient-macos-latest-aarch64      '*.dmg'          "Ambient-$VERSION-macOS-aarch64.dmg"          macos
stage $SRC/ambient-macos-latest-aarch64      '*.app.tar.gz'   "Ambient-$VERSION-macOS-aarch64.app.tar.gz"   macos_up
stage $SRC/ambient-macos-latest-aarch64      '*.app.tar.gz.sig' "Ambient-$VERSION-macOS-aarch64.app.tar.gz.sig" macos_sig
stage $SRC/ambient-windows-latest-x86_64     '*-setup.exe'      "Ambient-$VERSION-Windows-x86_64-setup.exe"      windows
stage $SRC/ambient-windows-latest-x86_64     '*-setup.exe.sig'  "Ambient-$VERSION-Windows-x86_64-setup.exe.sig"  windows_sig
stage $SRC/ambient-windows-11-arm-aarch64    '*-setup.exe'      "Ambient-$VERSION-Windows-aarch64-setup.exe"     windows_arm
stage $SRC/ambient-windows-11-arm-aarch64    '*-setup.exe.sig'  "Ambient-$VERSION-Windows-aarch64-setup.exe.sig" windows_arm_sig
stage $SRC/ambient-linux-x86_64       '*.AppImage'      "Ambient-$VERSION-Linux-x86_64.AppImage"       linux_appimage
stage $SRC/ambient-linux-x86_64       '*.AppImage.sig'  "Ambient-$VERSION-Linux-x86_64.AppImage.sig"   linux_appimage_sig
stage $SRC/ambient-linux-arm-aarch64  '*.AppImage'      "Ambient-$VERSION-Linux-aarch64.AppImage"      linux_appimage_arm
stage $SRC/ambient-linux-arm-aarch64  '*.AppImage.sig'  "Ambient-$VERSION-Linux-aarch64.AppImage.sig"  linux_appimage_arm_sig

# Merge latest.json: start from the LIVE manifest, bump only what we rebuilt.
echo "==> Building latest.json (merged with live)"
curl -fsS https://ambient.oezcan.me/downloads/latest.json -o "$OUT/live.json"
HAVE_JSON=$(for k in "${!HAVE[@]}"; do printf '%s\t%s\n' "$k" "${HAVE[$k]}"; done)
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" RELEASED="$(date -u +%Y-%m-%d)" \
VERSION="$VERSION" HAVE_JSON="$HAVE_JSON" node scripts/merge-latest-json.mjs \
  "$OUT/live.json" "$OUT/latest.json"

echo "==> Release notes"
node scripts/extract-changelog.mjs --version "$VERSION" --output "$OUT/notes.md" || echo "Release v$VERSION" > "$OUT/notes.md"

echo "==> Uploading present artifacts + latest.json to R2"
ct() { case "$1" in *.dmg) echo application/x-apple-diskimage;; *.app.tar.gz) echo application/gzip;;
  *-setup.exe) echo application/x-msdownload;; *.deb) echo application/vnd.debian.binary-package;;
  *.AppImage) echo application/x-executable;; *.json) echo application/json;;
  *) echo application/octet-stream;; esac; }
for f in "$OUT"/Ambient-* "$OUT/latest.json"; do
  [[ -f "$f" ]] || continue
  $WRANGLER r2 object put "ambient-releases/$(basename "$f")" --file="$f" --content-type="$(ct "$f")" --remote
done

echo "==> GitHub release v$VERSION"
ASSETS=(); for f in "$OUT"/Ambient-*; do [[ "$f" == *.sig ]] || ASSETS+=("$f"); done
if gh release view "v$VERSION" >/dev/null 2>&1; then
  gh release upload "v$VERSION" --clobber "${ASSETS[@]}"
  gh release edit "v$VERSION" --draft=false --latest
else
  gh release create "v$VERSION" --latest --title "v$VERSION" --notes-file "$OUT/notes.md" "${ASSETS[@]}"
fi
echo; echo "✓ v$VERSION published (partial-aware). Live: https://ambient.oezcan.me/downloads/latest.json"
