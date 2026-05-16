#!/usr/bin/env bash
# scripts/build-linux-arm64.sh — build the Linux aarch64 AppImage
# locally via Docker + QEMU.
#
# Outputs the absolute AppImage path on stdout; status / logs go to
# stderr. release.sh captures stdout to feed the path into its upload
# step. Standalone invocation also works:
#
#   ./scripts/build-linux-arm64.sh
#
# Expects binfmt_misc qemu-aarch64 to be registered on the host
# (Arch: `sudo pacman -S qemu-user-static binfmt-support`; Ubuntu:
# `sudo apt-get install qemu-user-static binfmt-support`). The
# Dockerfile + caches keep build #2 onwards under ~15 min; cold first
# build is ~40 min while it apt-installs and cargo-fetches inside the
# emulated VM.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="ambient-build-aarch64:latest"
DOCKERFILE="$REPO_ROOT/scripts/docker/Dockerfile.aarch64"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker (or podman aliased to it) is required" >&2
  exit 1
fi

if [[ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ]]; then
  echo "qemu-aarch64 binfmt not registered on host." >&2
  echo "Arch:   sudo pacman -S qemu-user-static binfmt-support" >&2
  echo "Ubuntu: sudo apt-get install qemu-user-static binfmt-support" >&2
  exit 1
fi

# Build image if missing. Subsequent calls reuse the cached layers.
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Building Docker image $IMAGE (first run only — slow)" >&2
  docker build --platform linux/arm64 -t "$IMAGE" \
    -f "$DOCKERFILE" "$REPO_ROOT/scripts/docker" >&2
fi

# CARGO_TARGET_DIR keeps aarch64 artifacts off the host's default
# target/ tree (which is x86_64 and would clobber on the next host
# build). Named volumes cache the heavy bits across runs:
#   - cargo registry / git / installed-toolchain caches
#   - bun's install cache
#   - the linuxdeploy AppImage Tauri downloads on first bundle
#   - node_modules (so re-running doesn't re-bun-install every time)
APPIMAGE_DIR="$REPO_ROOT/src-tauri/target-aarch64/release/bundle/appimage"

echo "==> Running aarch64 Tauri build inside container (slow under QEMU)" >&2
docker run --rm --platform linux/arm64 \
  -v "$REPO_ROOT:/work" \
  -v ambient-aarch64-cargo:/root/.cargo \
  -v ambient-aarch64-rustup:/root/.rustup \
  -v ambient-aarch64-bun-cache:/root/.bun/install/cache \
  -v ambient-aarch64-tauri-cache:/root/.cache/tauri \
  -v ambient-aarch64-node_modules:/work/node_modules \
  -e CARGO_TARGET_DIR=/work/src-tauri/target-aarch64 \
  "$IMAGE" \
  bash -c '
    set -euo pipefail
    cd /work
    bun install --frozen-lockfile
    bun run tauri build || true

    # Same linuxdeploy fallback as host build — Tauri'\''s bundling
    # step occasionally fails the linuxdeploy invocation even when
    # the AppDir is fine. Finish by hand if the AppImage is missing.
    out=src-tauri/target-aarch64/release/bundle/appimage
    if ! ls "$out"/*.AppImage >/dev/null 2>&1; then
      echo "Tauri bundling did not emit AppImage; running linuxdeploy manually." >&2
      cd "$out"
      NO_STRIP=true ~/.cache/tauri/linuxdeploy-aarch64.AppImage \
        --appdir Ambient.AppDir --output appimage
    fi
  ' >&2

APPIMAGE="$(find "$APPIMAGE_DIR" -maxdepth 1 -name "*.AppImage" -print -quit 2>/dev/null || true)"
if [[ -z "$APPIMAGE" || ! -f "$APPIMAGE" ]]; then
  echo "Linux aarch64 build failed — no AppImage in $APPIMAGE_DIR" >&2
  exit 1
fi

echo "    Linux aarch64: $APPIMAGE" >&2
# Single stdout line: absolute path. release.sh captures this.
echo "$APPIMAGE"
