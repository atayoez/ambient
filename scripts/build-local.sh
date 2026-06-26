#!/usr/bin/env bash
# scripts/build-local.sh — build every Ambient artifact except macOS on this
# machine, into build-out/ in the layout scripts/publish-local.sh expects
# (NOT dist/ — that's vite's frontend output, which the host Windows builds'
# `tauri build` wipes via beforeBuildCommand). macOS is
# the only target CI still handles (Apple SDK + bundler are Mac-locked).
#
# Builds (all by default, ~30-40 min):
#   Linux  x86_64  .deb + .rpm   — ubuntu:22.04 container (old glibc).
#   Linux  aarch64 .deb + .rpm   — CROSS-compiled in an arm64-multiarch
#                                  container (ports.ubuntu.com + cross gcc), no
#                                  emulation.
#   Arch   x86_64  .pkg.tar.zst  — makepkg repackages the .deb (native).
#   Windows x86_64 + aarch64     — cargo-xwin cross-compile (MSVC CRT/SDK via
#     NSIS setup.exe (+ .sig)      xwin, lld-link) then NSIS bundle. .msi can't
#                                  build off Windows, NSIS can; the updater .sig
#                                  is produced here too.
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

# clang shim for the Windows cross-build: ring compiles its aarch64 .S/.c with
# gnu-driver `clang`, but cargo-xwin passes clang-cl `/imsvc <dir>` system
# includes, which the gnu driver (clang 22) rejects. `-isystem` is the
# universal spelling and finds the same MSVC headers. Harmless for x64 (ring
# uses pregenerated asm there); only ring's gnu-`clang` calls hit the shim,
# cargo-xwin's own compiles go through `clang-cl`.
SHIM="$REPO_ROOT/.cache/xwin-shim"
mkdir -p "$SHIM"
cat > "$SHIM/clang" <<'SH'
#!/usr/bin/env bash
args=(); for a in "$@"; do [ "$a" = "/imsvc" ] && args+=("-isystem") || args+=("$a"); done
exec /usr/bin/clang "${args[@]}"
SH
chmod +x "$SHIM/clang"

# Run a container build script (mounts repo ro, out rw, signing key) — used for
# both the native x86_64 and the cross-compiled aarch64 Linux builds.
run_container() { # <out-dir> <script>
  local out="$1" script="$2"
  rm -rf "$out"; mkdir -p "$out"
  "${PODMAN[@]}" run --rm \
    -v "$REPO_ROOT":/src:ro -v "$REPO_ROOT/$out":/out -v "$KEY":/key:ro \
    -e TAURI_SIGNING_PRIVATE_KEY=/key -e TAURI_SIGNING_PRIVATE_KEY_PASSWORD= \
    "$UBUNTU" bash -c "$script"
}

# Cross-compile + NSIS-bundle one Windows target on the host (signed setup.exe).
build_windows() { # <triple> <out-dir>
  local triple="$1" out="$2"
  rm -rf "$out"; mkdir -p "$out"
  env PATH="$SHIM:$HOME/.cargo/bin:$PATH" RUSTC_WRAPPER= CARGO_INCREMENTAL=0 \
    TAURI_SIGNING_PRIVATE_KEY="$KEY" TAURI_SIGNING_PRIVATE_KEY_PASSWORD= \
    bun x tauri build --runner cargo-xwin --target "$triple" --bundles nsis
  cp -v "src-tauri/target/$triple/release/bundle/nsis/"*-setup.exe \
        "src-tauri/target/$triple/release/bundle/nsis/"*-setup.exe.sig "$out/"
}

LINUX_X64='set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf xdg-utils \
  build-essential curl git file ca-certificates pkg-config libssl-dev unzip
curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"; curl -fsSL https://bun.sh/install | bash; export PATH="$HOME/.bun/bin:$PATH"
git clone /src /build && cd /build && bun install --frozen-lockfile
bun x tauri build --bundles deb,rpm
mkdir -p /out && cp -v src-tauri/target/release/bundle/deb/*.deb src-tauri/target/release/bundle/rpm/*.rpm /out/'

LINUX_ARM='set -eux
export DEBIAN_FRONTEND=noninteractive
dpkg --add-architecture arm64
cat > /etc/apt/sources.list <<EOF
deb [arch=amd64] http://archive.ubuntu.com/ubuntu jammy main universe
deb [arch=amd64] http://archive.ubuntu.com/ubuntu jammy-updates main universe
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy main universe
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy-updates main universe
EOF
apt-get update
apt-get install -y --no-install-recommends \
  build-essential curl git file ca-certificates pkg-config patchelf unzip \
  gcc-aarch64-linux-gnu g++-aarch64-linux-gnu \
  libwebkit2gtk-4.1-dev:arm64 libgtk-3-dev:arm64 \
  libayatana-appindicator3-dev:arm64 librsvg2-dev:arm64
curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
. "$HOME/.cargo/env"; rustup target add aarch64-unknown-linux-gnu
curl -fsSL https://bun.sh/install | bash; export PATH="$HOME/.bun/bin:$PATH"
git clone /src /build && cd /build && bun install --frozen-lockfile
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
export PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_SYSROOT_DIR=/
export PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig
bun x tauri build --target aarch64-unknown-linux-gnu --bundles deb,rpm
mkdir -p /out && cp -v src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/deb/*.deb \
  src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/rpm/*.rpm /out/'

echo "==> Linux x86_64 (.deb + .rpm)"
run_container "build-out/ambient-ubuntu-22.04-x86_64" "$LINUX_X64"

echo "==> Linux aarch64 (.deb + .rpm) — cross-compiled (arm64 multiarch)"
run_container "build-out/ambient-ubuntu-22.04-arm-aarch64" "$LINUX_ARM"

echo "==> Arch x86_64 (.pkg.tar.zst) via makepkg"
mkdir -p build-out/ambient-arch-x86_64
scripts/build-arch-pkg.sh "$VERSION" \
  "$(find build-out/ambient-ubuntu-22.04-x86_64 -name '*.deb' -print -quit)" build-out/ambient-arch-x86_64

echo "==> Windows x86_64 (NSIS setup.exe)"
build_windows x86_64-pc-windows-msvc build-out/ambient-windows-latest-x86_64

echo "==> Windows aarch64 (NSIS setup.exe)"
build_windows aarch64-pc-windows-msvc build-out/ambient-windows-11-arm-aarch64

echo
echo "✓ Local build done (v$VERSION) — everything but macOS:"
find build-out -maxdepth 2 -type f \( -name '*.deb' -o -name '*.rpm' -o -name '*.pkg.tar.zst' -o -name '*-setup.exe' \) -printf '   %p\n'
echo
echo "Then: scripts/publish-local.sh $VERSION --ci-run <id>   (--ci-run folds in the CI macOS build)"
