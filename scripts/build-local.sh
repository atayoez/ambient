#!/usr/bin/env bash
# scripts/build-local.sh — build every Ambient artifact we can build on this
# machine, into dist/ in the layout scripts/publish-local.sh expects. This is
# the default build path now that CI is only used for macOS (the one target
# that genuinely can't be built off a Mac).
#
# What it builds:
#   - Linux x86_64 .deb + .rpm      — ubuntu:22.04 container (old glibc, so the
#                                      binaries run on older distros too).
#   - Arch x86_64 .pkg.tar.zst      — makepkg repackages the .deb (native, fast).
#   - Windows x86_64 + aarch64      — cargo-xwin cross-compile (MSVC CRT/SDK via
#     NSIS setup.exe (+ updater .sig)  xwin) then NSIS bundle. WiX/.msi can't be
#                                      built off Windows, NSIS can; the updater
#                                      .sig is produced here too.
#   - Linux aarch64 .deb + .rpm     — ONLY with --arm64: an emulated arm64
#                                      container (qemu-user). Correct but slow.
#
# What it does NOT build:
#   - macOS .dmg — CI only (Apple SDK + bundler are Mac-locked).
#
# Prerequisites (one-time): rustup + the windows targets, `cargo install
# cargo-xwin`, LLVM (lld-link), and NSIS (`makensis`; on Arch via the AUR
# `nsis` package). The Windows build needs RUSTC_WRAPPER unset (sccache breaks
# the cross-build) — handled below.
#
# Usage: scripts/build-local.sh [--arm64]
#
# Container engine: rootless podman needs the vfs storage driver (the overlay
# driver EOVERFLOWs on dpkg's chown in a user namespace).

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

WITH_ARM64=0
[[ "${1:-}" == "--arm64" ]] && WITH_ARM64=1

VERSION="$(node -e "console.log(require('./package.json').version)")"
KEY="$HOME/.config/ambient/updater-private.key"
PODMAN=(podman --storage-driver vfs --root /tmp/ambient-pbuild)
UBUNTU="docker.io/library/ubuntu:22.04"

# --- Windows prereqs (the cross-bundler invokes `makensis.exe`) ---
command -v "$HOME/.cargo/bin/cargo-xwin" >/dev/null || { echo "cargo-xwin missing — run: cargo install cargo-xwin" >&2; exit 1; }
command -v makensis >/dev/null || { echo "makensis missing — install NSIS (Arch: AUR 'nsis')" >&2; exit 1; }
[ -e "$HOME/.cargo/bin/makensis.exe" ] || ln -sf "$(command -v makensis)" "$HOME/.cargo/bin/makensis.exe"

# The in-container Linux build steps, shared by every Linux arch. Clones the
# repo (mounted ro at /src) so the host tree/target is never touched, installs
# the Tauri Linux deps + Rust + Bun like CI, builds, copies out to /out.
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

# Cross-compile + NSIS-bundle one Windows target on the host. cargo-xwin pulls
# the MSVC CRT + Windows SDK and links with lld-link; RUSTC_WRAPPER must be
# empty (sccache breaks it). Produces a signed setup.exe (TAURI_SIGNING key).
build_windows() {
  local triple="$1" out="$2"
  rm -rf "$out"; mkdir -p "$out"
  env PATH="$HOME/.cargo/bin:$PATH" RUSTC_WRAPPER= CARGO_INCREMENTAL=0 \
    TAURI_SIGNING_PRIVATE_KEY="$KEY" TAURI_SIGNING_PRIVATE_KEY_PASSWORD= \
    bun x tauri build --runner cargo-xwin --target "$triple" --bundles nsis
  cp -v "src-tauri/target/$triple/release/bundle/nsis/"*-setup.exe \
        "src-tauri/target/$triple/release/bundle/nsis/"*-setup.exe.sig "$out/"
}

echo "==> Linux x86_64 (.deb + .rpm) in ubuntu:22.04"
build_linux "" "dist/ambient-ubuntu-22.04-x86_64"

echo "==> Arch x86_64 (.pkg.tar.zst) via makepkg"
mkdir -p dist/ambient-arch-x86_64
DEB_X64="$(find dist/ambient-ubuntu-22.04-x86_64 -name '*.deb' -print -quit)"
scripts/build-arch-pkg.sh "$VERSION" "$DEB_X64" dist/ambient-arch-x86_64

echo "==> Windows x86_64 (NSIS setup.exe) via cargo-xwin"
build_windows x86_64-pc-windows-msvc dist/ambient-windows-latest-x86_64

echo "==> Windows aarch64 (NSIS setup.exe) via cargo-xwin"
# Best-effort: arm64 can fail on the `ring` C cross-compile under cargo-xwin.
# If it does, publish-local.sh is partial-aware and the feed keeps the prior
# arm64 build, so a release is never blocked on it.
CC_aarch64_pc_windows_msvc=clang-cl CXX_aarch64_pc_windows_msvc=clang-cl AR_aarch64_pc_windows_msvc=llvm-lib \
  build_windows aarch64-pc-windows-msvc dist/ambient-windows-11-arm-aarch64 || {
  echo "   !! Windows arm64 cross-build failed — skipping (feed keeps the previous arm64 build)"
  rm -rf dist/ambient-windows-11-arm-aarch64
}

if [[ "$WITH_ARM64" == 1 ]]; then
  echo "==> Linux aarch64 (.deb + .rpm) in EMULATED arm64 container (slow)"
  build_linux "--arch arm64" "dist/ambient-ubuntu-22.04-arm-aarch64"
fi

echo
echo "✓ Local build done (v$VERSION):"
find dist -maxdepth 2 -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.pkg.tar.zst' -o -name '*-setup.exe' \) -printf '   %p\n'
echo
echo "Still needed for a full release:"
[[ "$WITH_ARM64" == 1 ]] || echo "   • Linux arm64 → re-run with --arm64 (emulated, slow)"
echo "   • macOS .dmg  → CI (only target that can't be built locally)"
echo
echo "Then: scripts/publish-local.sh $VERSION   (add --ci-run <id> to fold in the macOS build)"
