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
  deb: `Ambient-${v}-Linux-x86_64.deb`,
  deb_arm: `Ambient-${v}-Linux-aarch64.deb`,
  rpm: `Ambient-${v}-Linux-x86_64.rpm`,
  rpm_arm: `Ambient-${v}-Linux-aarch64.rpm`,
  pacman: `Ambient-${v}-Linux-x86_64.pkg.tar.zst`,
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
  ['linux_deb', 'linux-deb', n.deb],
  ['linux_deb_arm', 'linux-deb-arm64', n.deb_arm],
  ['linux_rpm', 'linux-rpm', n.rpm],
  ['linux_rpm_arm', 'linux-rpm-arm64', n.rpm_arm],
  ['linux_pacman', 'linux-pacman', n.pacman],
];
const kept = [];
for (const [haveKey, dlKey, name] of dl) {
  if (have.has(haveKey)) out.downloads[dlKey] = url(name);
  else kept.push(dlKey);
}
// Updater platform entries (signature + url): only the signed ones.
if (have.has('macos_sig')) out.platforms['darwin-aarch64'] = { signature: sig('macos_sig'), url: url(n.macos_up) };
if (have.has('windows_sig')) out.platforms['windows-x86_64'] = { signature: sig('windows_sig'), url: url(n.msi) };
if (have.has('windows_arm_sig')) out.platforms['windows-aarch64'] = { signature: sig('windows_arm_sig'), url: url(n.msi_arm) };

fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${outPath} as v${v}. Kept previous release for: ${kept.join(', ') || '(none)'}`);
