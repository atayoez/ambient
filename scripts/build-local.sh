#!/usr/bin/env bash
# scripts/build-local.sh — build every Ambient artifact except macOS, into
# build-out/ in the layout scripts/publish-local.sh expects (NOT dist/ — that's
# vite's frontend output, which the host Windows builds wipe). macOS is the
# only target CI still handles (Apple SDK + bundler are Mac-locked).
#
# Builds:
#   Linux x86_64 .AppImage   — ubuntu:rolling container here (signed).
#   Linux aarch64 .AppImage  — ubuntu:rolling container ON the arm host ($ARM_HOST,
#                              default orion) via ssh: runs NATIVE arm64 there,
#                              so linuxdeploy works (cross-bundling can't; native
#                              Tumbleweed/Arch hit distro-specific AppImage bugs).
#                              Built unsigned, signed back here.
#   Windows x86_64 + aarch64 — cargo-xwin cross-compile + NSIS (signed).
#
# Why a container for the AppImages: linuxdeploy/-plugin-gtk assume an Ubuntu
# layout (Arch self-copies GLib schemas; openSUSE puts appindicator in lib64).
# We use ubuntu:rolling (always the latest Ubuntu release) + `--pull=newer` so
# the build base never goes stale; for a lib-bundling AppImage, container vs
# native doesn't change the output.
# Rootless podman: vfs driver (overlay EOVERFLOWs on dpkg chown) + on the arm
# host, --security-opt label=disable (SELinux) and an inlined script (a bind-
# mounted script hit EPERM).
#
# Prereqs: cargo-xwin + the windows targets, LLVM (clang/lld-link), NSIS
# (makensis; Arch AUR `nsis`), podman, ssh access to $ARM_HOST. RUSTC_WRAPPER
# must be unset for the xwin builds (sccache breaks them).
#
# Usage: scripts/build-local.sh

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -e "console.log(require('./package.json').version)")"
KEY="$HOME/.config/ambient/updater-private.key"
ARM_HOST="${ARM_HOST:-orion}"   # arm64 build box (native aarch64, ssh-reachable)
PODMAN=(podman --storage-driver vfs --root /tmp/ambient-pbuild)
# ubuntu:rolling = the latest Ubuntu release, always. Paired with `--pull=newer`
# on each run so the cached image is refreshed when upstream moves.
UBUNTU="docker.io/library/ubuntu:rolling"

command -v "$HOME/.cargo/bin/cargo-xwin" >/dev/null || { echo "cargo-xwin missing — cargo install cargo-xwin" >&2; exit 1; }
command -v makensis >/dev/null || { echo "makensis missing — install NSIS (Arch: AUR 'nsis')" >&2; exit 1; }
[ -e "$HOME/.cargo/bin/makensis.exe" ] || ln -sf "$(command -v makensis)" "$HOME/.cargo/bin/makensis.exe"
# The arm64 AppImage builds in a container ON $ARM_HOST (native aarch64).
# Verify ssh + podman there up front rather than failing after the x86_64
# build has already run.
ssh -o BatchMode=yes -o ConnectTimeout=8 "$ARM_HOST" 'command -v podman >/dev/null' 2>/dev/null \
  || { echo "$ARM_HOST unreachable over ssh, or podman not installed there — needed for the arm64 AppImage. Set ARM_HOST=<host> or fix ssh/podman." >&2; exit 1; }

# clang shim for the Windows arm64 cross-build (ring's .S; /imsvc -> -isystem).
SHIM="$REPO_ROOT/.cache/xwin-shim"; mkdir -p "$SHIM"
printf '#!/usr/bin/env bash\nargs=(); for a in "$@"; do [ "$a" = "/imsvc" ] && args+=("-isystem") || args+=("$a"); done\nexec /usr/bin/clang "${args[@]}"\n' > "$SHIM/clang"
chmod +x "$SHIM/clang"

# In-container AppImage build (arch-agnostic; builds for the container's arch).
# `|| true` swallows the updater-sign step when no key is mounted (arm host);
# the .AppImage is bundled before that, and we sign it back on this box.
CONTAINER_APPIMAGE='set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  patchelf xdg-utils desktop-file-utils zsync file curl git ca-certificates \
  build-essential pkg-config libssl-dev unzip
curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"; curl -fsSL https://bun.sh/install | bash; export PATH="$HOME/.bun/bin:$PATH"
# Persistent cargo caches (named podman volume mounted at /ccache) — the
# first release pays the cold compile, later ones are incremental.
mkdir -p /ccache/registry /ccache/target
ln -sfn /ccache/registry "$HOME/.cargo/registry"
export CARGO_TARGET_DIR=/ccache/target
git clone /src /build && cd /build && bun install --frozen-lockfile
export APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true
bun x tauri build --bundles appimage || true
mkdir -p /out && cp -v "$CARGO_TARGET_DIR"/release/bundle/appimage/*.AppImage* /out/'

build_windows() { # <triple> <out-dir>
  local triple="$1" out="$2"; rm -rf "$out"; mkdir -p "$out"
  # Clear the bundle dir first: it lives in the persistent host target/ and
  # keeps a PREVIOUS release's Ambient_<oldver>_*-setup.exe, which the cp
  # glob below would otherwise sweep up alongside the new one (and publish's
  # `find | head -1` could then stage the wrong version under the new name).
  rm -rf "src-tauri/target/$triple/release/bundle/nsis"
  env PATH="$SHIM:$HOME/.cargo/bin:$PATH" RUSTC_WRAPPER= CARGO_INCREMENTAL=0 \
    TAURI_SIGNING_PRIVATE_KEY="$KEY" TAURI_SIGNING_PRIVATE_KEY_PASSWORD= \
    bun x tauri build --runner cargo-xwin --target "$triple" --bundles nsis
  cp -v "src-tauri/target/$triple/release/bundle/nsis/"*-setup.exe \
        "src-tauri/target/$triple/release/bundle/nsis/"*-setup.exe.sig "$out/"
}

sign_appimage() { # <dir> — sign any .AppImage missing a .sig (updater signature)
  local f; f=$(find "$1" -name '*.AppImage' | head -1)
  [ -n "$f" ] && [ ! -f "$f.sig" ] && \
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD= bun x tauri signer sign -f "$KEY" -p "" "$f" >/dev/null || true
}

# --- Three parallel lanes ------------------------------------------------
# The Linux container build, the arm64 remote build, and the Windows cross
# builds are fully independent (the containers clone the repo; only the two
# Windows builds share the host dist/ + cargo, so those stay sequential
# WITHIN their lane). Wall time = the slowest lane instead of the sum.
LOGDIR="$REPO_ROOT/build-out/logs"; mkdir -p "$LOGDIR"

lane_linux_x86() {
  echo "==> Linux x86_64 AppImage (ubuntu:rolling container, signed)"
  rm -rf build-out/ambient-linux-x86_64; mkdir -p build-out/ambient-linux-x86_64
  "${PODMAN[@]}" run --rm --pull=newer \
    -v "$REPO_ROOT":/src:ro -v "$REPO_ROOT/build-out/ambient-linux-x86_64":/out -v "$KEY":/key:ro -v ambient-ccache:/ccache \
    -e TAURI_SIGNING_PRIVATE_KEY=/key -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD= \
    "$UBUNTU" bash -c "$CONTAINER_APPIMAGE"
}

lane_linux_arm() {
  echo "==> Linux aarch64 AppImage (ubuntu:rolling container on $ARM_HOST, native arm64)"
  local out=build-out/ambient-linux-arm-aarch64; rm -rf "$out"; mkdir -p "$out"
  rsync -az --delete --exclude='/src-tauri/target' --exclude='node_modules' \
    --exclude='/build-out' --exclude='/dist' --exclude='/.cache' ./ "$ARM_HOST:/tmp/ambient-src/"
  ssh "$ARM_HOST" "mkdir -p \$HOME/ambient-out && rm -f \$HOME/ambient-out/*.AppImage*
  podman --storage-driver vfs --root \$HOME/orion-pbuild run --rm --pull=newer --security-opt label=disable \
    -v /tmp/ambient-src:/src:ro -v \$HOME/ambient-out:/out -v ambient-ccache:/ccache \
    $UBUNTU bash -c $(printf '%q' "$CONTAINER_APPIMAGE")"
  scp -q "$ARM_HOST:\$HOME/ambient-out/*.AppImage" "$out/" 2>/dev/null || \
    scp -q "$ARM_HOST":'~/ambient-out/*.AppImage' "$out/"
  sign_appimage "$out"
}

lane_windows() {
  echo "==> Windows x86_64 + aarch64 (NSIS setup.exe)"
  build_windows x86_64-pc-windows-msvc build-out/ambient-windows-latest-x86_64
  build_windows aarch64-pc-windows-msvc build-out/ambient-windows-11-arm-aarch64
}

echo "==> Building 3 lanes in parallel (logs: build-out/logs/)"
lane_linux_x86 > "$LOGDIR/linux-x86_64.log" 2>&1 & PID_X86=$!
lane_linux_arm > "$LOGDIR/linux-aarch64.log" 2>&1 & PID_ARM=$!
lane_windows   > "$LOGDIR/windows.log"      2>&1 & PID_WIN=$!

FAILED=0
for spec in "linux-x86_64:$PID_X86" "linux-aarch64:$PID_ARM" "windows:$PID_WIN"; do
  name="${spec%%:*}"; pid="${spec##*:}"
  if wait "$pid"; then
    echo "  ✓ lane $name done"
  else
    echo "  ✗ lane $name FAILED — last 40 log lines:" >&2
    tail -40 "$LOGDIR/$name.log" >&2 || true
    FAILED=1
  fi
done
[ "$FAILED" -eq 0 ] || { echo "One or more lanes failed — see build-out/logs/." >&2; exit 1; }

echo
echo "✓ Local build done (v$VERSION) — everything but macOS:"
find build-out -maxdepth 2 -type f \( -name '*.AppImage' -o -name '*-setup.exe' \) -printf '   %p\n'
echo
echo "Then: scripts/publish-local.sh $VERSION --ci-run <id>   (--ci-run folds in the CI macOS build)"
