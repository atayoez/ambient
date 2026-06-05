#!/usr/bin/env bash
# scripts/build-arch-pkg.sh — build the native Arch package (.pkg.tar.zst)
# from a prebuilt Tauri .deb, via makepkg. Used by the build-arch CI job
# (runs in an archlinux container) and runnable locally.
#
# Tauri v2 has no pacman bundler, so packaging/arch/PKGBUILD repackages
# the .deb's payload into a pacman package. We feed the version through
# $AMBIENT_VERSION (the PKGBUILD reads it) rather than sed-templating, so
# this works regardless of the host's sed/coreutils flavour.
#
# Usage: build-arch-pkg.sh <version> <path-to-deb> [output-dir]
#   <version>      e.g. 0.9.0  (no v prefix)
#   <path-to-deb>  the x86_64 .deb to repackage
#   [output-dir]   where to copy the resulting .pkg.tar.zst (default: CWD)

set -euo pipefail

VERSION="${1:?Usage: $0 <version> <deb> [outdir]}"
DEB="${2:?Usage: $0 <version> <deb> [outdir]}"
OUTDIR="${3:-$PWD}"

# Resolve the output dir to an absolute path up front — we `cd` into $WORK
# below, so a relative outdir (e.g. "dist/arch") would otherwise be created
# under packaging/arch instead of the caller's directory.
mkdir -p "$OUTDIR"
OUTDIR="$(cd "$OUTDIR" && pwd)"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$REPO_ROOT/packaging/arch"

if [[ ! -f "$DEB" ]]; then
  echo "deb not found: $DEB" >&2
  exit 1
fi

# The PKGBUILD's source= expects ambient_<ver>_amd64.deb next to it.
cp "$DEB" "$WORK/ambient_${VERSION}_amd64.deb"

cd "$WORK"
# --nodeps: we're only repackaging files, not compiling, so the runtime
# deps (webkit2gtk etc.) need not be installed on the builder. The deps
# are still recorded in the package metadata for the end user's pacman.
AMBIENT_VERSION="$VERSION" makepkg -f --nodeps

PKG=$(ls -1 ambient-"${VERSION}"-*-x86_64.pkg.tar.* | head -1)
if [[ -z "$PKG" ]]; then
  echo "makepkg produced no package" >&2
  exit 1
fi
mkdir -p "$OUTDIR"
cp "$PKG" "$OUTDIR/"
echo "Built $OUTDIR/$(basename "$PKG")"
