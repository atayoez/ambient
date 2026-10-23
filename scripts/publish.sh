#!/usr/bin/env bash
# scripts/publish.sh — publish a release from a set of built cells: rename to
# the release naming and cut / update the GitHub release. PARTIAL-AWARE: it
# publishes whatever cells are present, so a cell that failed to build never
# blocks the others from shipping; rebuild it alone and re-run to attach it.
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
#   <dir>/ambient-linux-x86_64/     *.AppImage
#   <dir>/ambient-linux-aarch64/    *.AppImage
#   <dir>/ambient-windows-x86_64/   *-setup.exe
#   <dir>/ambient-windows-aarch64/  *-setup.exe
#   <dir>/ambient-macos-x86_64/     *.dmg
#   <dir>/ambient-macos-aarch64/    *.dmg
#
# Env: GH_TOKEN / gh auth for the release.

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

# Start the rename staging dir EMPTY: the GH-release glob matches
# `Ambient-*`, so a previous release's renamed artifacts left here would be
# attached to this version's release. Wipe, don't merge.
OUT="$SRC/renamed"; rm -rf "$OUT"; mkdir -p "$OUT"

# Rename present artifacts to the release convention + remember which we
# have.
declare -A HAVE
stage() { # <cell> <glob> <release-name>
  local dir="$SRC/ambient-$1" f
  f=$(find "$dir" -name "$2" 2>/dev/null | head -1 || true)
  [[ -n "$f" && -f "$f" ]] || return 0
  cp "$f" "$OUT/$3"; HAVE[$1]="$OUT/$3"; echo "   have $1 -> $3"
}
echo "==> Staging present cells from $SRC/"
for cell in "${CELLS[@]}"; do
  os="${cell%-*}"; arch="${cell##*-}"
  case "$os" in
    linux)   stage "$cell" '*.AppImage'  "Ambient-$VERSION-Linux-$arch.AppImage";;
    windows) stage "$cell" '*-setup.exe' "Ambient-$VERSION-Windows-$arch-setup.exe";;
    macos)   stage "$cell" '*.dmg'       "Ambient-$VERSION-macOS-$arch.dmg";;
  esac
done
if [[ ${#HAVE[@]} -eq 0 ]]; then
  echo "Nothing to publish: no cell artifacts under $SRC/ambient-*/." >&2
  exit 1
fi

echo "==> Release notes"
bun scripts/extract-changelog.mjs --version "$VERSION" --output "$OUT/notes.md" || echo "Release v$VERSION" > "$OUT/notes.md"

echo "==> GitHub release v$VERSION"
ASSETS=("$OUT"/Ambient-*)
if gh release view "v$VERSION" >/dev/null 2>&1; then
  gh release upload "v$VERSION" --clobber "${ASSETS[@]}"
  gh release edit "v$VERSION" --draft=false --latest --title "v$VERSION" --notes-file "$OUT/notes.md"
else
  gh release create "v$VERSION" --latest --title "v$VERSION" --notes-file "$OUT/notes.md" "${ASSETS[@]}"
fi
echo; echo "✓ v$VERSION published (${!HAVE[*]}): https://github.com/atayoez/ambient/releases/tag/v$VERSION"
