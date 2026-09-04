// Merge a new (possibly partial) release into the LIVE latest.json. Used by
// scripts/publish.sh. Starts from the currently-served manifest and only
// rewrites the platforms we actually rebuilt (passed via $HAVE_JSON,
// tab-separated `key\tpath` lines), so any platform we didn't build keeps
// pointing at the previous release and the updater feed never breaks.
//
// Usage: node merge-latest-json.mjs <live.json> <out.json>
// Env:   VERSION, RELEASED, PUB_DATE, HAVE_JSON
//
// HAVE keys are the matrix cell names from build.yml / publish.sh:
//   <cell>      the user-facing download (dmg / setup.exe / AppImage)
//   <cell>_sig  its minisign updater signature
//   <cell>_up   (macOS only) the .app.tar.gz the updater installs
import fs from 'node:fs';

const [, , livePath, outPath] = process.argv;
const v = process.env.VERSION;
const base = 'https://ambient.oezcan.me/downloads';
const out = JSON.parse(fs.readFileSync(livePath, 'utf8'));

const have = new Map();
for (const line of (process.env.HAVE_JSON || '').split('\n')) {
  if (!line.trim()) continue;
  const [k, p] = line.split('\t');
  have.set(k, p);
}
const url = (name) => `${base}/${name}`;
const sig = (k) => fs.readFileSync(have.get(k), 'utf8').trim();

// One row per matrix cell:
//   dl        key(s) in `downloads` (what the site + /downloads/latest/<key>
//             aliases read; the first is canonical, the rest are aliases
//             kept for links already in the wild)
//   file      the download's release filename
//   platform  tauri-plugin-updater's `platforms` key (the app looks up
//             `<os>-<arch>` of the running build)
//   updater   the file the updater downloads (the .dmg isn't signed, so
//             macOS ships the .app.tar.gz; elsewhere it's the download)
const cells = [
  { cell: 'macos-aarch64', dl: ['macos'], file: `Ambient-${v}-macOS-aarch64.dmg`, platform: 'darwin-aarch64', updater: `Ambient-${v}-macOS-aarch64.app.tar.gz` },
  { cell: 'macos-x86_64', dl: ['macos-intel'], file: `Ambient-${v}-macOS-x86_64.dmg`, platform: 'darwin-x86_64', updater: `Ambient-${v}-macOS-x86_64.app.tar.gz` },
  { cell: 'windows-x86_64', dl: ['windows'], file: `Ambient-${v}-Windows-x86_64-setup.exe`, platform: 'windows-x86_64' },
  { cell: 'windows-aarch64', dl: ['windows-arm64'], file: `Ambient-${v}-Windows-aarch64-setup.exe`, platform: 'windows-aarch64' },
  { cell: 'linux-x86_64', dl: ['linux-appimage', 'linux'], file: `Ambient-${v}-Linux-x86_64.AppImage`, platform: 'linux-x86_64' },
  { cell: 'linux-aarch64', dl: ['linux-appimage-arm64', 'linux-arm64'], file: `Ambient-${v}-Linux-aarch64.AppImage`, platform: 'linux-aarch64' },
];

out.version = v;
out.released = process.env.RELEASED;
out.pub_date = process.env.PUB_DATE;
out.notes = `Release v${v}`;
out.downloads = out.downloads || {};
out.platforms = out.platforms || {};

const kept = [];
for (const c of cells) {
  if (!have.has(c.cell)) {
    kept.push(c.cell);
    continue;
  }
  for (const key of c.dl) out.downloads[key] = url(c.file);
  // Updater entry only when the signature made it — an unsigned build must
  // not be advertised to the in-app updater (it would reject it anyway).
  if (have.has(`${c.cell}_sig`)) {
    out.platforms[c.platform] = {
      signature: sig(`${c.cell}_sig`),
      url: url(c.updater || c.file),
    };
  }
}

// Linux switched from deb/rpm/pacman to AppImage — drop any legacy keys the
// live manifest still carries so the feed doesn't serve stale package links.
for (const k of ['linux-deb', 'linux-deb-arm64', 'linux-rpm', 'linux-rpm-arm64', 'linux-pacman']) {
  delete out.downloads[k];
}

fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${outPath} as v${v}. Kept previous release for: ${kept.join(', ') || '(none)'}`);
