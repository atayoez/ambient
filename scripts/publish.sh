#!/usr/bin/env bash
# scripts/publish.sh — publish a release from a set of built cells: rename to
# the release naming, merge latest.json, upload to R2, cut / update the GitHub
# release. PARTIAL-AWARE: it publishes whatever cells are present and leaves
# every other platform pointing at the previous release in latest.json, so a
# cell that failed to build never breaks the updater feed.
#
# Normally run by the `publish` job in .github/workflows/build.yml. Runnable
# locally too, e.g. to re-publish a finished CI run:
#
#   scripts/publish.sh [version] [--run <run-id>] [--from <dir>]
#
#   --run <id>   download that build.yml run's `ambient-*` artifacts first
#   --from <dir> where the cell dirs live (default: dist/)
#
# Expected layout (build.yml's artifact names, one dir per matrix cell):
#   <dir>/ambient-linux-x86_64/     *.AppImage(.sig)
#   <dir>/ambient-linux-aarch64/    *.AppImage(.sig)
#   <dir>/ambient-windows-x86_64/   *-setup.exe(.sig)
#   <dir>/ambient-windows-aarch64/  *-setup.exe(.sig)
#   <dir>/ambient-macos-x86_64/     *.dmg  *.app.tar.gz(.sig)
#   <dir>/ambient-macos-aarch64/    *.dmg  *.app.tar.gz(.sig)
#
# Env: CLOUDFLARE_API_TOKEN (or a logged-in wrangler), CLOUDFLARE_ACCOUNT_ID
# (defaults below), GH_TOKEN / gh auth for the release.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO_ROOT"

# Version defaults to package.json (the release commit carries the bump); a
# numeric positional arg overrides it.
VERSION="$(bun -e "console.log(require('./package.json').version)")"
RUN_ID=""
SRC="dist"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)  RUN_ID="${2:?--run needs a run id}"; shift 2;;
    --from) SRC="${2:?--from needs a directory}"; shift 2;;
    [0-9]*) VERSION="$1"; shift;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-848c6419822ef3e91b6f66d69ebe63eb}"
WRANGLER="bunx wrangler@4"
CELLS=(linux-x86_64 linux-aarch64 windows-x86_64 windows-aarch64 macos-x86_64 macos-aarch64)

if [[ -n "$RUN_ID" ]]; then
  echo "==> Downloading artifacts from build.yml run $RUN_ID into $SRC/"
  # Wipe stale cell dirs first: filenames carry the version, so a leftover
  # from an older run would be picked up by the `find | head -1` below and
  # shipped under the new names.
  for c in "${CELLS[@]}"; do rm -rf "$SRC/ambient-$c"; done
  mkdir -p "$SRC"
  gh run download "$RUN_ID" --dir "$SRC" --pattern 'ambient-*' || echo "   (no artifacts downloaded; continuing partial)"
fi

# Start the rename staging dir EMPTY: the upload + GH-release globs match
# `Ambient-*`, so a previous release's renamed artifacts left here would be
# re-uploaded and attached to this version's release. Wipe, don't merge.
OUT="$SRC/renamed"; rm -rf "$OUT"; mkdir -p "$OUT"

# Nothing to sign here: every cell is built with the updater key in CI, so
# the .sig files arrive next to their bundles.

# Rename present artifacts to the release convention + remember which we
# have. HAVE keys feed merge-latest-json.mjs: `<cell>` = the download,
# `<cell>_sig` = its updater signature, `<cell>_up` = the macOS updater
# tarball (the .dmg is the download, the .app.tar.gz is what the updater
# installs — Tauri never signs the .dmg).
declare -A HAVE
stage() { # <cell> <glob> <release-name> <have-key>
  local dir="$SRC/ambient-$1" f
  f=$(find "$dir" -name "$2" 2>/dev/null | head -1 || true)
  [[ -n "$f" && -f "$f" ]] || return 0
  cp "$f" "$OUT/$3"; HAVE[$4]="$OUT/$3"; echo "   have $4 -> $3"
}
echo "==> Staging present cells from $SRC/"
for cell in "${CELLS[@]}"; do
  os="${cell%-*}"; arch="${cell##*-}"
  case "$os" in
    linux)
      stage "$cell" '*.AppImage'     "Ambient-$VERSION-Linux-$arch.AppImage"     "$cell"
      stage "$cell" '*.AppImage.sig' "Ambient-$VERSION-Linux-$arch.AppImage.sig" "${cell}_sig";;
    windows)
      stage "$cell" '*-setup.exe'     "Ambient-$VERSION-Windows-$arch-setup.exe"     "$cell"
      stage "$cell" '*-setup.exe.sig' "Ambient-$VERSION-Windows-$arch-setup.exe.sig" "${cell}_sig";;
    macos)
      stage "$cell" '*.dmg'            "Ambient-$VERSION-macOS-$arch.dmg"            "$cell"
      stage "$cell" '*.app.tar.gz'     "Ambient-$VERSION-macOS-$arch.app.tar.gz"     "${cell}_up"
      stage "$cell" '*.app.tar.gz.sig' "Ambient-$VERSION-macOS-$arch.app.tar.gz.sig" "${cell}_sig";;
  esac
done
if [[ ${#HAVE[@]} -eq 0 ]]; then
  echo "Nothing to publish: no cell artifacts under $SRC/ambient-*/." >&2
  exit 1
fi

# Merge latest.json: start from the LIVE manifest, bump only what we rebuilt.
echo "==> Building latest.json (merged with live)"
# Read it from the bucket, not the public URL: the site answers 403 to
# GitHub-hosted runners, which failed the v1.5.0 tag run.
$WRANGLER r2 object get "ambient-releases/latest.json" --file="$OUT/live.json" --remote
HAVE_JSON=$(for k in "${!HAVE[@]}"; do printf '%s\t%s\n' "$k" "${HAVE[$k]}"; done)
PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" RELEASED="$(date -u +%Y-%m-%d)" \
VERSION="$VERSION" HAVE_JSON="$HAVE_JSON" bun scripts/merge-latest-json.mjs \
  "$OUT/live.json" "$OUT/latest.json"

echo "==> Release notes"
bun scripts/extract-changelog.mjs --version "$VERSION" --output "$OUT/notes.md" || echo "Release v$VERSION" > "$OUT/notes.md"

echo "==> Uploading present artifacts + latest.json to R2"
ct() { case "$1" in *.dmg) echo application/x-apple-diskimage;; *.app.tar.gz) echo application/gzip;;
  *-setup.exe) echo application/x-msdownload;; *.AppImage) echo application/x-executable;;
  *.json) echo application/json;; *) echo application/octet-stream;; esac; }
for f in "$OUT"/Ambient-* "$OUT/latest.json"; do
  [[ -f "$f" ]] || continue
  $WRANGLER r2 object put "ambient-releases/$(basename "$f")" --file="$f" --content-type="$(ct "$f")" --remote
done

echo "==> GitHub release v$VERSION"
ASSETS=(); for f in "$OUT"/Ambient-*; do [[ "$f" == *.sig ]] || ASSETS+=("$f"); done
if gh release view "v$VERSION" >/dev/null 2>&1; then
  gh release upload "v$VERSION" --clobber "${ASSETS[@]}"
  gh release edit "v$VERSION" --draft=false --latest --title "v$VERSION" --notes-file "$OUT/notes.md"
else
  gh release create "v$VERSION" --latest --title "v$VERSION" --notes-file "$OUT/notes.md" "${ASSETS[@]}"
fi
echo; echo "✓ v$VERSION published (${!HAVE[*]}). Live: https://ambient.oezcan.me/downloads/latest.json"
