#!/usr/bin/env bash
# scripts/release.sh — prep + tag + push. CI handles the rest.
#
# Usage: bun run release <version>   (e.g. bun run release 0.7.0)
#
# What it does:
#   1. Validates the version arg + clean working tree
#   2. Promotes CHANGELOG.md's [Unreleased] section to [v<VERSION>] -
#      DATE and seeds a fresh empty Unreleased scaffold on top
#   3. Bumps version in package.json, src-tauri/Cargo.toml,
#      src-tauri/Cargo.lock, src-tauri/tauri.conf.json
#   4. Commits "Release v<VERSION>"
#   5. Tags v<VERSION>
#   6. Pushes commit + tag — the tag-push trigger in
#      .github/workflows/build.yml kicks off the 5-platform build
#      matrix, then the release job uploads artifacts to R2 + writes
#      latest.json + creates the GitHub release.
#
# Watch CI after: gh run watch (use the latest build.yml run).
#
# Pre-0.7 this script ran the whole release locally (downloading CI
# artifacts, building Linux x86_64 on the host, signing, uploading to
# R2, cutting the GH release). That was ~430 lines of bash. CI now
# owns all of that — this is just prep + tag + push.

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <version>   (e.g. $0 0.7.0)" >&2
  exit 1
fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be MAJOR.MINOR.PATCH (got: '$VERSION')" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Commit or stash first." >&2
  git status --short
  exit 1
fi

CURRENT_VERSION="$(node -e "console.log(require('./package.json').version)")"
if [[ "$VERSION" == "$CURRENT_VERSION" ]]; then
  echo "Version $VERSION is already the current version. Pick a new one." >&2
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION already exists. Pick a new version or delete the tag first:" >&2
  echo "  git tag -d v$VERSION && git push --delete origin v$VERSION" >&2
  exit 1
fi

echo "==> Releasing v$VERSION (was $CURRENT_VERSION)"

# --- 1. Promote CHANGELOG's [Unreleased] section --------------------

node --input-type=module -e "
  import fs from 'node:fs';
  const v = '$VERSION';
  const date = new Date().toISOString().slice(0, 10);
  let text = fs.readFileSync('./CHANGELOG.md', 'utf8');
  const re = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|\$)/;
  const m = text.match(re);
  if (!m) {
    console.error('Could not find ## [Unreleased] in CHANGELOG.md');
    process.exit(1);
  }
  const body = m[1].trim();
  const promotedHeader = '## [' + v + '] — ' + date;
  const promoted = body.length > 0
    ? promotedHeader + '\n\n' + body + '\n'
    : promotedHeader + '\n\n_No notable changes._\n';
  const freshUnreleased =
    '## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n' + promoted;
  text = text.replace(re, freshUnreleased);
  fs.writeFileSync('./CHANGELOG.md', text);
  console.log('    CHANGELOG.md updated.');
"

# --- 2. Bump manifests ----------------------------------------------

echo "==> Bumping version in manifests"

# package.json
node -e "
  const fs = require('fs');
  const f = './package.json';
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.version = '$VERSION';
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
"

# src-tauri/tauri.conf.json
node -e "
  const fs = require('fs');
  const f = './src-tauri/tauri.conf.json';
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.version = '$VERSION';
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
"

# src-tauri/Cargo.toml — replace only the FIRST `version = "..."`
# line (which is the [package] section's version, not a dep version).
awk -v v="$VERSION" '
  BEGIN { done = 0 }
  /^version[[:space:]]*=[[:space:]]*"[^"]+"/ && !done {
    print "version = \"" v "\""
    done = 1
    next
  }
  { print }
' src-tauri/Cargo.toml > src-tauri/Cargo.toml.tmp
mv src-tauri/Cargo.toml.tmp src-tauri/Cargo.toml

# Regenerate Cargo.lock so the version in the lock matches.
(cd src-tauri && cargo update --workspace --quiet)

# --- 3. Commit + tag + push -----------------------------------------

echo "==> Committing + tagging"
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock \
        src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"

echo "==> Pushing main + tag — CI takes over"
git push origin main "v$VERSION"

cat <<EOF

✓ Tagged v$VERSION and pushed.

  CI is now building all 5 platforms and publishing. Watch:
    https://github.com/atayozcan/ambient/actions

  Release will appear at:
    https://github.com/atayozcan/ambient/releases/tag/v$VERSION

  Manifest will land at:
    https://ambient.oezcan.me/downloads/latest.json
EOF
