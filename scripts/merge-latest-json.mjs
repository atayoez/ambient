// Merge a new partial release into the LIVE latest.json. Used by
// scripts/publish-local.sh. Starts from the currently-served manifest and
// only rewrites the platforms we actually rebuilt (passed via $HAVE_JSON,
// tab-separated `key\tpath` lines), so any platform we didn't build keeps
// pointing at the previous release and the updater feed never breaks.
//
// Usage: node merge-latest-json.mjs <live.json> <out.json>
// Env:   VERSION, RELEASED, PUB_DATE, HAVE_JSON
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
const n = {
  dmg: `Ambient-${v}-macOS-aarch64.dmg`,
  macos_up: `Ambient-${v}-macOS-aarch64.app.tar.gz`,
  msi: `Ambient-${v}-Windows-x86_64-setup.exe`,
  msi_arm: `Ambient-${v}-Windows-aarch64-setup.exe`,
  appimage: `Ambient-${v}-Linux-x86_64.AppImage`,
  appimage_arm: `Ambient-${v}-Linux-aarch64.AppImage`,
};
const url = (name) => `${base}/${name}`;
const sig = (k) => fs.readFileSync(have.get(k), 'utf8').trim();

out.version = v;
out.released = process.env.RELEASED;
out.pub_date = process.env.PUB_DATE;
out.notes = `Release v${v}`;
out.downloads = out.downloads || {};
out.platforms = out.platforms || {};

const dl = [
  ['macos', 'macos', n.dmg],
  ['windows', 'windows', n.msi],
  ['windows_arm', 'windows-arm64', n.msi_arm],
  ['linux_appimage', 'linux-appimage', n.appimage],
  ['linux_appimage_arm', 'linux-appimage-arm64', n.appimage_arm],
];
const kept = [];
for (const [haveKey, dlKey, name] of dl) {
  if (have.has(haveKey)) out.downloads[dlKey] = url(name);
  else kept.push(dlKey);
}
// Linux switched from deb/rpm/pacman to AppImage — drop any legacy keys the
// live manifest still carries so the feed doesn't serve stale package links.
for (const k of ['linux-deb', 'linux-deb-arm64', 'linux-rpm', 'linux-rpm-arm64', 'linux-pacman']) {
  delete out.downloads[k];
}
// Updater platform entries (signature + url): only the signed ones.
if (have.has('macos_sig')) out.platforms['darwin-aarch64'] = { signature: sig('macos_sig'), url: url(n.macos_up) };
if (have.has('windows_sig')) out.platforms['windows-x86_64'] = { signature: sig('windows_sig'), url: url(n.msi) };
if (have.has('windows_arm_sig')) out.platforms['windows-aarch64'] = { signature: sig('windows_arm_sig'), url: url(n.msi_arm) };

fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${outPath} as v${v}. Kept previous release for: ${kept.join(', ') || '(none)'}`);
