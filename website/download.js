// Platform-detected primary download.
//
// Picks one of {macos, windows, linux} × {x86_64, aarch64} based on the
// visitor's OS + CPU, and updates the primary download card to point at
// the right artifact. Detection order:
//   1. navigator.userAgentData.getHighEntropyValues  (Chromium-based,
//      gives accurate arch as 'arm' / 'x86')
//   2. navigator.userAgent  (UA string heuristics, less reliable for
//      ARM vs x64 on Windows because Safari/Firefox don't expose it)
//   3. Fallback: leave the HTML defaults (macOS) — the disclosure
//      widget below lets the visitor pick manually.
//
// Before applying an arch-specific URL the script also fetches
// /downloads/latest.json and confirms an artifact for that arch
// actually exists. Pre-0.4 the manifest has no -arm64 keys, so an
// ARM visitor gracefully falls back to the x86_64 build instead of
// landing on a 404.

(function () {
  'use strict';

  // Platform metadata. `glyph` is the inner SVG for the primary card's
  // icon (matches the existing dl-glyph paths from the previous 3-card
  // grid — apple silhouette, Windows 11 four-square, Tux).
  var APPLE_GLYPH =
    '<path d="M17.05 20.28c-.98.95-2.05.94-3.08.51-1.09-.46-2.09-.47-3.24 0-1.44.59-2.2.42-3.06-.51C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>';
  var WINDOWS_GLYPH =
    '<rect x="3" y="3" width="8" height="8" rx="0.5"/>' +
    '<rect x="13" y="3" width="8" height="8" rx="0.5"/>' +
    '<rect x="3" y="13" width="8" height="8" rx="0.5"/>' +
    '<rect x="13" y="13" width="8" height="8" rx="0.5"/>';
  var LINUX_GLYPH =
    '<path d="M12 1.5c-2.21 0-4 1.79-4 4 0 .82.25 1.58.67 2.21-.79.41-1.42 1.09-1.78 1.93l-.83 1.95C5.59 12.23 4.84 13.17 5 14c.27 1.43 1.42 2.5 2.84 2.83.74.18 1.45.51 2.01.99l.74.62v.06c-.07.13-.11.28-.11.43 0 .81.55 1.49 1.3 1.69-.05.1-.11.2-.17.3-.19.32-.43.61-.71.85-.04.04-.09.09-.13.13.3.12.62.18.95.18.55 0 1.07-.16 1.51-.44.31.27.74.44 1.2.44s.89-.17 1.2-.44c.44.28.96.44 1.51.44.33 0 .65-.06.95-.18-.04-.04-.09-.09-.13-.13-.28-.24-.52-.53-.71-.85-.06-.1-.12-.2-.17-.3.75-.2 1.3-.88 1.3-1.69 0-.15-.04-.3-.11-.43v-.06l.74-.62c.56-.48 1.27-.81 2.01-.99 1.42-.33 2.57-1.4 2.84-2.83.16-.83-.59-1.77-1.06-2.41l-.83-1.95c-.36-.84-.99-1.52-1.78-1.93.42-.63.67-1.39.67-2.21 0-2.21-1.79-4-4-4z"/>';

  // os → { glyph, label, archMeta, downloadKey, archDownloadKey }
  // downloadKey is the bare alias served by the Worker; archDownloadKey
  // is the arm64 alias when available.
  var PLATFORMS = {
    macos: {
      glyph: APPLE_GLYPH,
      label: 'macOS',
      arch_aarch64: { meta: 'Apple Silicon · .dmg', key: 'macos' },
      arch_x86_64:  { meta: 'Apple Silicon · .dmg', key: 'macos' },
    },
    windows: {
      glyph: WINDOWS_GLYPH,
      label: 'Windows',
      arch_aarch64: { meta: 'ARM64 · .msi', key: 'windows-arm64' },
      arch_x86_64:  { meta: 'x86_64 · .msi', key: 'windows' },
    },
    linux: {
      glyph: LINUX_GLYPH,
      label: 'Linux',
      arch_aarch64: { meta: 'aarch64 · .AppImage', key: 'linux-arm64' },
      arch_x86_64:  { meta: 'x86_64 · .AppImage', key: 'linux' },
    },
  };

  function parseUserAgent(ua) {
    if (/Mac|iPhone|iPad/.test(ua)) {
      // All shipping macOS targets are Apple Silicon; Safari on Apple
      // Silicon Macs still reports "Intel Mac OS X" in the UA for
      // compat, so we just default to aarch64 here.
      return { os: 'macos', arch: 'aarch64' };
    }
    if (/Windows|Win64|WOW64/.test(ua)) {
      var arch = /ARM64|aarch64/i.test(ua) ? 'aarch64' : 'x86_64';
      return { os: 'windows', arch: arch };
    }
    if (/Linux|X11|CrOS/.test(ua)) {
      var larch = /aarch64|arm64|armv8/i.test(ua) ? 'aarch64' : 'x86_64';
      return { os: 'linux', arch: larch };
    }
    return null;
  }

  async function detect() {
    // Modern API: Chromium-only, async, accurate.
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try {
        var hints = await navigator.userAgentData.getHighEntropyValues([
          'architecture',
          'platform',
        ]);
        var platformRaw = (hints.platform || '').toLowerCase();
        var archRaw = (hints.architecture || '').toLowerCase();
        var os = null;
        if (platformRaw.indexOf('mac') !== -1) os = 'macos';
        else if (platformRaw.indexOf('win') !== -1) os = 'windows';
        else if (platformRaw.indexOf('linux') !== -1) os = 'linux';
        else if (platformRaw.indexOf('chrom') !== -1) os = 'linux';
        if (os) {
          var arch = archRaw === 'arm' ? 'aarch64' : 'x86_64';
          return { os: os, arch: arch };
        }
      } catch (e) {
        // Fall through to UA parse.
      }
    }
    // Fallback: UA string heuristics.
    return parseUserAgent(navigator.userAgent || '');
  }

  async function getAvailableKeys() {
    try {
      var res = await fetch('/downloads/latest.json', { cache: 'no-store' });
      if (!res.ok) return null;
      var data = await res.json();
      if (data && data.downloads && typeof data.downloads === 'object') {
        return data.downloads;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function pickDownloadKey(detected, available) {
    if (!detected) return null;
    var entry = PLATFORMS[detected.os];
    if (!entry) return null;
    var primary = entry['arch_' + detected.arch];
    if (!primary) return null;

    // If the manifest is reachable, only return the arch-specific key
    // when an artifact for it actually exists. Otherwise fall back to
    // the bare x86_64 key. Pre-0.4 manifests don't carry -arm64 keys.
    if (available) {
      if (available[primary.key]) {
        return { ...primary, os: detected.os, arch: detected.arch };
      }
      var fallback = entry['arch_x86_64'];
      if (fallback && available[fallback.key]) {
        return { ...fallback, os: detected.os, arch: 'x86_64' };
      }
      return null;
    }
    // Manifest unreachable — return optimistic arch-specific key. If
    // it 404s the visitor can grab a fallback from the disclosure
    // list below.
    return { ...primary, os: detected.os, arch: detected.arch };
  }

  function applyToCard(picked) {
    if (!picked) return;
    var card = document.getElementById('dl-primary');
    var glyph = document.getElementById('dl-primary-glyph');
    var osEl = document.getElementById('dl-primary-os');
    var metaEl = document.getElementById('dl-primary-meta');
    if (!card || !glyph || !osEl || !metaEl) return;

    var entry = PLATFORMS[picked.os];
    if (!entry) return;
    glyph.innerHTML = entry.glyph;
    osEl.textContent = entry.label;
    metaEl.textContent = picked.meta;
    card.setAttribute('href', '/downloads/latest/' + picked.key);
    card.setAttribute('data-detected-os', picked.os);
    card.setAttribute('data-detected-arch', picked.arch);

    // The "builds aren't signed yet" note only applies to OSes whose
    // OS-level trust checks complain about unsigned binaries — that's
    // macOS Gatekeeper and Windows SmartScreen. Linux just runs the
    // AppImage; surfacing the warning to a Linux visitor is noise.
    var note = document.querySelector('.dl-note');
    if (note) {
      note.style.display = picked.os === 'linux' ? 'none' : '';
    }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    var detected = await detect();
    if (!detected) return;
    var available = await getAvailableKeys();
    var picked = pickDownloadKey(detected, available);
    applyToCard(picked);
  });
})();
