#!/usr/bin/env bash
# scripts/appimage-fixup.sh — post-process a Tauri-built AppImage in place.
#
# The AppImage is built on Ubuntu 22.04 (oldest glibc we support), so
# linuxdeploy bundles 22.04's libwayland 1.20. The host's EGL driver (Mesa
# 24.1+, NVIDIA egl-wayland) is NOT bundled and calls libwayland 1.23+ API
# (wl_display_create_queue_with_name, wl_proxy_get_queue); with the old copy
# loaded first, WebKit's GPU path fails and the window stays black. Every
# Wayland host has libwayland, and its ABI is backward compatible, so we drop
# the bundled copies and let the host's be used.
#
# Also points .DirIcon at the bundled icon relatively: the bundler writes an
# absolute symlink into the build machine's AppDir, which is dangling on
# every user's machine (AppImageLauncher / Gear Lever show no icon).
#
# Re-signs the updater signature (.sig) when TAURI_SIGNING_PRIVATE_KEY is
# set, since the file's bytes change.
#
# Needs: squashfs-tools (unsquashfs/mksquashfs) and the AppImage runnable on
# this machine (same CPU arch) to read its runtime offset.
#
# Usage: scripts/appimage-fixup.sh path/to/App.AppImage

set -euo pipefail

img="$(realpath "$1")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# A type-2 AppImage is the runtime ELF followed by a squashfs image.
offset="$("$img" --appimage-offset)"
head -c "$offset" "$img" > "$work/runtime"
unsquashfs -no-progress -d "$work/root" -o "$offset" "$img" > /dev/null

removed=$(find "$work/root/usr/lib" -maxdepth 1 -name 'libwayland-*.so*' -print -delete | wc -l)
echo "appimage-fixup: removed $removed bundled libwayland file(s)"

if [ -L "$work/root/.DirIcon" ]; then
  ln -sfn "$(basename "$(readlink "$work/root/.DirIcon")")" "$work/root/.DirIcon"
fi
[ -e "$work/root/.DirIcon" ] || { echo "appimage-fixup: .DirIcon does not resolve" >&2; exit 1; }

mksquashfs "$work/root" "$work/fs" -comp zstd -b 131072 -root-owned -noappend -no-progress > /dev/null
cat "$work/runtime" "$work/fs" > "$work/out"
chmod 755 "$work/out"
mv "$work/out" "$img"

if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  rm -f "$img.sig"
  bun x tauri signer sign "$img" > /dev/null
  [ -s "$img.sig" ] || { echo "appimage-fixup: re-signing failed" >&2; exit 1; }
  echo "appimage-fixup: re-signed $(basename "$img").sig"
fi
