#!/usr/bin/env bash
# scripts/build-local.sh — build every Ambient artifact we CAN build on this
# machine, into dist/ in the layout scripts/publish-local.sh + ci-publish.sh
# expect. This is the default build path now that CI is only used for macOS
# (the one target that can't be built off a Mac).
#
# What it builds:
#   - Linux x86_64 .deb + .rpm   — in an ubuntu:22.04 container (old glibc, so
#                                   the binaries run on older distros too).
#   - Arch x86_64 .pkg.tar.zst   — makepkg repackages the .deb (native, fast).
#   - Linux aarch64 .deb + .rpm  — ONLY with --arm64: an emulated arm64
#                                   container (qemu-user). Correct but slow
#                                   (Rust compiles under emulation).
#
# What it does NOT build (get these elsewhere):
#   - Windows .msi   — build on the Windows VM, drop into ~/vms/share/
#                      (publish-local.sh picks it up + signs it here).
#   - macOS .dmg     — CI only (no off-Mac cross-compile exists).
#
# Usage:
#   scripts/build-local.sh [--arm64]
#
# Container engine: rootless podman needs the vfs storage driver (the overlay
# driver EOVERFLOWs on dpkg's chown in a user namespace). We pin vfs + an
# isolated --root so we never fight the host's container storage.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

WITH_ARM64=0
[[ "${1:-}" == "--arm64" ]] && WITH_ARM64=1

VERSION="$(node -e "console.log(require('./package.json').version)")"
KEY="$HOME/.config/ambient/updater-private.key"
PODMAN=(podman --storage-driver vfs --root /tmp/ambient-pbuild)
UBUNTU="docker.io/library/ubuntu:22.04"

# The in-container build steps, shared by every Linux arch. Clones the repo
# (mounted ro at /src) so the host tree/target is never touched, installs the
# Tauri Linux deps + Rust + Bun exactly like CI, builds, copies out to /out.
CONTAINER_BUILD='set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf xdg-utils \
  build-essential curl git file ca-certificates pkg-config libssl-dev unzip
curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
git clone /src /build
cd /build
bun install --frozen-lockfile
bun x tauri build --bundles deb,rpm
mkdir -p /out
cp -v src-tauri/target/release/bundle/deb/*.deb /out/
cp -v src-tauri/target/release/bundle/rpm/*.rpm /out/'

build_linux() {
  local arch_flag="$1" out="$2"
  rm -rf "$out"; mkdir -p "$out"
  # shellcheck disable=SC2068
  "${PODMAN[@]}" run --rm $arch_flag \
    -v "$REPO_ROOT":/src:ro -v "$REPO_ROOT/$out":/out \
    -v "$KEY":/key:ro \
    -e TAURI_SIGNING_PRIVATE_KEY=/key -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD= \
    "$UBUNTU" bash -c "$CONTAINER_BUILD"
}

echo "==> [1/?] Linux x86_64 (.deb + .rpm) in ubuntu:22.04"
build_linux "" "dist/ambient-ubuntu-22.04-x86_64"

echo "==> Arch x86_64 (.pkg.tar.zst) via makepkg"
mkdir -p dist/ambient-arch-x86_64
DEB_X64="$(find dist/ambient-ubuntu-22.04-x86_64 -name '*.deb' -print -quit)"
scripts/build-arch-pkg.sh "$VERSION" "$DEB_X64" dist/ambient-arch-x86_64

if [[ "$WITH_ARM64" == 1 ]]; then
  echo "==> Linux aarch64 (.deb + .rpm) in EMULATED arm64 container (slow)"
  build_linux "--arch arm64" "dist/ambient-ubuntu-22.04-arm-aarch64"
fi

echo
echo "✓ Local build done (v$VERSION):"
find dist -maxdepth 2 -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.pkg.tar.zst' \) -printf '   %p\n'
echo
echo "Still needed for a full release:"
echo "   • Windows .msi  → build on the VM, drop into ~/vms/share/"
[[ "$WITH_ARM64" == 1 ]] || echo "   • Linux arm64   → re-run with --arm64 (emulated, slow)"
echo "   • macOS .dmg    → CI (only target that can't be built locally)"
echo
echo "Then: scripts/publish-local.sh $VERSION"
