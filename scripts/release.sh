#!/usr/bin/env bash
# scripts/release.sh — cut a release: changelog + version bump + tag + push.
# CI (.github/workflows/build.yml) takes it from there: the tag push runs the
# six-cell build matrix and the partial-aware publish job.
#
# Usage: bun run release <version> [--watch]   (e.g. bun run release 1.5.0)
#
# What it does:
#   1. Validates the version arg, a clean working tree, and gh auth
#   2. Promotes CHANGELOG.md's [Unreleased] section to [<VERSION>] — DATE
#      and seeds a fresh empty Unreleased scaffold on top
#   3. Bumps version in package.json, src-tauri/Cargo.toml,
#      src-tauri/Cargo.lock, src-tauri/tauri.conf.json
#   4. Commits "Release v<VERSION>", tags v<VERSION>, pushes commit + tag
#   5. With --watch: follows the CI run to completion in the terminal
#
# Nothing is built or published on this machine. To re-run only the
# publish step for a finished CI run (e.g. after a GitHub outage):
#   scripts/publish.sh <version> --run <run-id>
# To rebuild one platform:  gh workflow run build.yml -f targets=<cell> -f publish=true
#
# History: pre-0.7 a ~430-line bash script built everything locally; 0.7–1.2
# ran a CI matrix; 1.2–1.4 split into local Linux/Windows + CI macOS when the
# Actions budget bit. GitHub now hosts arm64 Linux/Windows and Intel macOS
# runners for private repos, so 1.5 returns to one native matrix in CI, gated
# to tag pushes so main pushes stay cheap.

set -euo pipefail

VERSION="${1:-}"
WATCH=0
for arg in "$@"; do [[ "$arg" == "--watch" ]] && WATCH=1; done
if [[ -z "$VERSION" || "$VERSION" == "--"* ]]; then
  echo "Usage: $0 <version> [--watch]   (e.g. $0 1.5.0)" >&2
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

CURRENT_VERSION="$(bun -e "console.log(require('./package.json').version)")"
if [[ "$VERSION" == "$CURRENT_VERSION" ]]; then
  echo "Version $VERSION is already the current version. Pick a new one." >&2
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION already exists. Pick a new version or delete the tag first:" >&2
  echo "  git tag -d v$VERSION && git push --delete origin v$VERSION" >&2
  exit 1
fi

# The push makes vX.Y.Z public and starts a CI run that publishes on its own,
# so the only preflight that matters here is being able to talk to GitHub.
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated (gh auth login)." >&2; exit 1; }

echo "==> Releasing v$VERSION (was $CURRENT_VERSION)"

# --- 1. Promote CHANGELOG's [Unreleased] section --------------------

bun -e "
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
bun -e "
  const fs = require('fs');
  const f = './package.json';
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.version = '$VERSION';
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
"

# src-tauri/tauri.conf.json
bun -e "
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

echo "==> Pushing main + tag — CI builds all six platforms and publishes"
git push origin main "v$VERSION"

cat <<EOF

✓ Tagged v$VERSION and pushed. CI is building + publishing:
    gh run list --workflow build.yml --limit 1
    gh run watch                       # follow it
  Release:  https://github.com/atayoez/ambient/releases/tag/v$VERSION
  A cell that fails doesn't block the others; rebuild it alone and attach it with
    gh workflow run build.yml -f targets=<cell> -f publish=true
EOF

if [[ "$WATCH" -eq 1 ]]; then
  # The tag run may take a few seconds to appear.
  sleep 8
  run_id="$(gh run list --workflow build.yml --branch "v$VERSION" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)"
  if [[ -n "$run_id" ]]; then
    gh run watch "$run_id" --exit-status
  else
    echo "(could not find the CI run yet — use: gh run list --workflow build.yml)"
  fi
fi
