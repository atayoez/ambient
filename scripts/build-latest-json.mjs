// Build the release manifest at latest.json.
//
// Reads minisign signatures from the .sig files produced by tauri's
// signer (run inside tauri-action when TAURI_SIGNING_PRIVATE_KEY is
// set) and emits the dual-shape manifest the rest of the stack reads:
//
//   - `version` + `downloads.{macos,windows,windows-arm64,linux,
//     linux-arm64}` — what worker.js's /downloads/latest/<platform>
//     302 aliases resolve through. Keys match the worker's regex.
//
//   - `pub_date` + `platforms.{darwin,windows,linux}-{x86_64,aarch64}`
//     with `signature` + `url` — what tauri-plugin-updater calls
//     check() against.
//
// CLI:
//   node build-latest-json.mjs \
//     --version 0.7.0 \
//     --dmg-sig path/to/Ambient.dmg.sig \
//     --msi-x64-sig ... --msi-arm-sig ... \
//     --appimage-x64-sig ... --appimage-arm-sig ... \
//     --output /tmp/latest.json

import fs from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'dmg-sig': { type: 'string' },
    'msi-x64-sig': { type: 'string' },
    'msi-arm-sig': { type: 'string' },
    'appimage-x64-sig': { type: 'string' },
    'appimage-arm-sig': { type: 'string' },
    output: { type: 'string' },
  },
});

for (const k of [
  'version',
  'dmg-sig',
  'msi-x64-sig',
  'msi-arm-sig',
  'appimage-x64-sig',
  'appimage-arm-sig',
  'output',
]) {
  if (!values[k]) {
    console.error(`Missing required --${k}`);
    process.exit(1);
  }
}

const v = values.version;
const released = new Date().toISOString().slice(0, 10);
const pub_date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const base = 'https://ambient.oezcan.me/downloads';
const names = {
  dmg: `Ambient-${v}-macOS-aarch64.dmg`,
  msi_x64: `Ambient-${v}-Windows-x86_64.msi`,
  msi_arm: `Ambient-${v}-Windows-aarch64.msi`,
  app_x64: `Ambient-${v}-Linux-x86_64.AppImage`,
  app_arm: `Ambient-${v}-Linux-aarch64.AppImage`,
};
const read = (p) => fs.readFileSync(p, 'utf8').trim();

const manifest = {
  version: v,
  released,
  pub_date,
  notes: `Release v${v}`,
  downloads: {
    macos: `${base}/${names.dmg}`,
    windows: `${base}/${names.msi_x64}`,
    'windows-arm64': `${base}/${names.msi_arm}`,
    linux: `${base}/${names.app_x64}`,
    'linux-arm64': `${base}/${names.app_arm}`,
  },
  platforms: {
    'darwin-aarch64': {
      signature: read(values['dmg-sig']),
      url: `${base}/${names.dmg}`,
    },
    'windows-x86_64': {
      signature: read(values['msi-x64-sig']),
      url: `${base}/${names.msi_x64}`,
    },
    'windows-aarch64': {
      signature: read(values['msi-arm-sig']),
      url: `${base}/${names.msi_arm}`,
    },
    'linux-x86_64': {
      signature: read(values['appimage-x64-sig']),
      url: `${base}/${names.app_x64}`,
    },
    'linux-aarch64': {
      signature: read(values['appimage-arm-sig']),
      url: `${base}/${names.app_arm}`,
    },
  },
};

fs.writeFileSync(values.output, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${values.output}`);
