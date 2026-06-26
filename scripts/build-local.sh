#!/usr/bin/env bash
# scripts/build-local.sh — build every Ambient artifact except macOS on this
# machine, into build-out/ in the layout scripts/publish-local.sh expects (NOT
# dist/ — that's vite's frontend output, which the host Windows builds wipe via
# beforeBuildCommand). macOS is the only target CI still handles (Apple SDK +
# bundler are Mac-locked).
#
# Builds (all by default):
#   Linux  x86_64  .AppImage    — ubuntu:22.04 container, bundles system WebKit.
#   Linux  aarch64 .AppImage    — CROSS-compiled in an arm64-multiarch container
#                                 (ports.ubuntu.com + cross gcc); AppImage
#                                 packaging is arch-agnostic. Best-effort.
#   Windows x86_64 + aarch64    — cargo-xwin cross-compile + NSIS (signed
#     NSIS setup.exe (+ .sig)     setup.exe). ring's arm64 .S needs the clang
#                                 shim (/imsvc → -isystem).
#
# Not built here: macOS (.dmg) — CI only.
#
# AppImage note: the bundler runs linuxdeploy/appimagetool, which want FUSE; we
# set APPIMAGE_EXTRACT_AND_RUN=1 so they run extracted (no FUSE in the rootless
# container). Tauri can't make .msi off Windows (WiX) but NSIS works.
#
# Prereqs (one-time): rustup + the windows + aarch64-linux targets, `cargo
# install cargo-xwin`, LLVM (clang/lld-link), NSIS (`makensis`; Arch: AUR
# `nsis`). RUSTC_WRAPPER must be unset for the xwin builds (sccache breaks them).
#
# Usage: scripts/build-local.sh

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(node -e "console.log(require('./package.json').version)")"
KEY="$HOME/.config/ambient/updater-private.key"
PODMAN=(podman --storage-driver vfs --root /tmp/ambient-pbuild)   # vfs: rootless overlay EOVERFLOWs on dpkg chown
UBUNTU="docker.io/library/ubuntu:22.04"

command -v "$HOME/.cargo/bin/cargo-xwin" >/dev/null || { echo "cargo-xwin missing — cargo install cargo-xwin" >&2; exit 1; }
command -v makensis >/dev/null || { echo "makensis missing — install NSIS (Arch: AUR 'nsis')" >&2; exit 1; }
[ -e "$HOME/.cargo/bin/makensis.exe" ] || ln -sf "$(command -v makensis)" "$HOME/.cargo/bin/makensis.exe"

# clang shim for the Windows arm64 cross-build (ring's .S; /imsvc → -isystem).
SHIM="$REPO_ROOT/.cache/xwin-shim"
mkdir -p "$SHIM"
cat > "$SHIM/clang" <<'SH'
#!/usr/bin/env bash
args=(); for a in "$@"; do [ "$a" = "/imsvc" ] && args+=("-isystem") || args+=("$a"); done
exec /usr/bin/clang "${args[@]}"
SH
chmod +x "$SHIM/clang"

run_container() { # <out-dir> <script>
  local out="$1" script="$2"
  rm -rf "$out"; mkdir -p "$out"
  "${PODMAN[@]}" run --rm \
    -v "$REPO_ROOT":/src:ro -v "$REPO_ROOT/$out":/out -v "$KEY":/key:ro \
    -e TAURI_SIGNING_PRIVATE_KEY=/key -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD= \
    "$UBUNTU" bash -c "$script"
}

build_windows() { # <triple> <out-dir>
  local triple="$1" out="$2"
  rm -rf "$out"; mkdir -p "$out"
  env PATH="$SHIM:$HOME/.cargo/bin:$PATH" RUSTC_WRAPPER= CARGO_INCREMENTAL=0 \
    TAURI_SIGNING_PRIVATE_KEY="$KEY" TAURI_SIGNING_PRIVATE_KEY_PASSWORD= \
    bun x tauri build --runner cargo-xwin --target "$triple" --bundles nsis
  cp -v "src-tauri/target/$triple/release/bundle/nsis/"*-setup.exe \
        "src-tauri/target/$triple/release/bundle/nsis/"*-setup.exe.sig "$out/"
}

# Shared container prelude: Tauri Linux deps (+ AppImage tooling) + Rust + Bun.
APT='export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  patchelf xdg-utils desktop-file-utils zsync file curl git ca-certificates \
  build-essential pkg-config libssl-dev unzip'

LINUX_X64="set -eux
$APT
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. \"\$HOME/.cargo/env\"; curl -fsSL https://bun.sh/install | bash; export PATH=\"\$HOME/.bun/bin:\$PATH\"
git clone /src /build && cd /build && bun install --frozen-lockfile
export APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true
bun x tauri build --bundles appimage
mkdir -p /out && cp -v src-tauri/target/release/bundle/appimage/*.AppImage* /out/"

LINUX_ARM="set -eux
$APT
dpkg --add-architecture arm64
cat > /etc/apt/sources.list <<EOF
deb [arch=amd64] http://archive.ubuntu.com/ubuntu jammy main universe
deb [arch=amd64] http://archive.ubuntu.com/ubuntu jammy-updates main universe
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy main universe
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy-updates main universe
EOF
apt-get update
apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu g++-aarch64-linux-gnu \
  libwebkit2gtk-4.1-dev:arm64 libgtk-3-dev:arm64 libayatana-appindicator3-dev:arm64 librsvg2-dev:arm64
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. \"\$HOME/.cargo/env\"; rustup target add aarch64-unknown-linux-gnu
curl -fsSL https://bun.sh/install | bash; export PATH=\"\$HOME/.bun/bin:\$PATH\"
git clone /src /build && cd /build && bun install --frozen-lockfile
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
export PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_SYSROOT_DIR=/ PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig
export APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=true ARCH=aarch64
bun x tauri build --target aarch64-unknown-linux-gnu --bundles appimage
mkdir -p /out && cp -v src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/appimage/*.AppImage* /out/"

echo "==> Linux x86_64 (.AppImage)"
run_container "build-out/ambient-ubuntu-22.04-x86_64" "$LINUX_X64"

echo "==> Linux aarch64 (.AppImage) — cross-compiled (best-effort)"
run_container "build-out/ambient-ubuntu-22.04-arm-aarch64" "$LINUX_ARM" || {
  echo "   !! Linux arm64 AppImage failed — skipping (feed keeps the prior arm64 build)"
  rm -rf build-out/ambient-ubuntu-22.04-arm-aarch64
}

echo "==> Windows x86_64 (NSIS setup.exe)"
build_windows x86_64-pc-windows-msvc build-out/ambient-windows-latest-x86_64

echo "==> Windows aarch64 (NSIS setup.exe)"
build_windows aarch64-pc-windows-msvc build-out/ambient-windows-11-arm-aarch64

echo
echo "✓ Local build done (v$VERSION) — everything but macOS:"
find build-out -maxdepth 2 -type f \( -name '*.AppImage' -o -name '*-setup.exe' \) -printf '   %p\n'
echo
echo "Then: scripts/publish-local.sh $VERSION --ci-run <id>   (--ci-run folds in the CI macOS build)"
