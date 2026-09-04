// Download UX: one card for the visitor's detected platform up top; the
// other two stay inside the "Other platforms" disclosure unless opened.
// This script:
//   1. Detects OS + CPU, moves that OS's card into the primary slot, and
//      pre-selects its dropdown(s).
//   2. Composes each card's button href from its dropdown(s), mapping the
//      choice to a /downloads/latest/<key> alias the Worker resolves.
//   3. Shows the macOS/Windows code-signing note only when the offered
//      download is actually macOS or Windows (hidden for a Linux primary
//      with the disclosure closed — native packages don't trip Gatekeeper
//      / SmartScreen).
//
// No-JS fallback: macOS is the primary card in the markup, Windows + Linux
// live in the disclosure (a native <details>), and the note shows by
// default (macOS is the primary). Every button has a working default href.
//
// Download keys (must match scripts/merge-latest-json.mjs + the Worker):
//   macos · macos-intel · windows · windows-arm64 ·
//   linux-appimage · linux-appimage-arm64

(function () {
  'use strict';

  var $ = function (id) {
    return document.getElementById(id);
  };

  // Apple Silicon vs Intel can't be read from the UA (Safari reports
  // "Intel Mac OS X" on both). Chromium exposes the GPU vendor through
  // WebGL — "Apple M2" / "Apple GPU" vs "Intel Iris" / "AMD Radeon" — so
  // use that when it's unambiguous, else default to Apple Silicon (every
  // Mac sold since late 2020) and let the dropdown correct it.
  function macArch() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      var info = gl && gl.getExtension('WEBGL_debug_renderer_info');
      var renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      if (/Intel|AMD|Radeon/i.test(renderer) && !/Apple M\d/i.test(renderer)) return 'x86_64';
    } catch (e) {
      /* fall through */
    }
    return 'aarch64';
  }

  function parseUserAgent(ua) {
    if (/Mac|iPhone|iPad/.test(ua)) return { os: 'macos', arch: macArch() };
    if (/Windows|Win64|WOW64/.test(ua)) {
      return { os: 'windows', arch: /ARM64|aarch64/i.test(ua) ? 'aarch64' : 'x86_64' };
    }
    if (/Linux|X11|CrOS/.test(ua)) {
      return { os: 'linux', arch: /aarch64|arm64|armv8/i.test(ua) ? 'aarch64' : 'x86_64' };
    }
    return null;
  }

  async function detect() {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try {
        var hints = await navigator.userAgentData.getHighEntropyValues([
          'architecture',
          'platform',
        ]);
        var p = (hints.platform || '').toLowerCase();
        var a = (hints.architecture || '').toLowerCase();
        var os = null;
        if (p.indexOf('mac') !== -1) os = 'macos';
        else if (p.indexOf('win') !== -1) os = 'windows';
        else if (p.indexOf('linux') !== -1 || p.indexOf('chrom') !== -1) os = 'linux';
        if (os === 'macos') return { os: os, arch: macArch() };
        if (os) return { os: os, arch: a === 'arm' ? 'aarch64' : 'x86_64' };
      } catch (e) {
        /* fall through */
      }
    }
    return parseUserAgent(navigator.userAgent || '');
  }

  function setHref(id, key) {
    var el = $(id);
    if (el) el.setAttribute('href', '/downloads/latest/' + key);
  }

  function wireWindows() {
    var sel = $('dl-win-arch');
    if (!sel) return;
    var update = function () {
      setHref('dl-windows', sel.value);
    };
    sel.addEventListener('change', update);
    update();
  }

  // macOS ships two builds: `macos` (Apple Silicon) and `macos-intel`.
  function wireMac() {
    var sel = $('dl-mac-arch');
    if (!sel) return;
    var update = function () {
      setHref('dl-macos', sel.value);
    };
    sel.addEventListener('change', update);
    update();
  }

  // Linux ships a single self-installing AppImage per arch.
  function linuxKey(arch) {
    return arch === 'aarch64' ? 'linux-appimage-arm64' : 'linux-appimage';
  }

  function wireLinux() {
    var arch = $('dl-lin-arch');
    if (!arch) return;
    var update = function () { setHref('dl-linux', linuxKey(arch.value)); };
    arch.addEventListener('change', update);
    update();
  }

  function primaryOS() {
    var slot = $('dl-primary-slot');
    var card = slot && slot.querySelector('.dl-card');
    return card ? card.getAttribute('data-os') : 'macos';
  }

  function updateNote() {
    var note = $('dl-note');
    if (!note) return;
    var others = $('dl-others');
    var open = !!(others && others.open);
    // The note is the macOS/Windows "unsigned app" warning. Show it when
    // the offered download is mac/windows: i.e. the primary card is one of
    // those, or the disclosure (which holds the other two, always
    // including mac+windows) is open. Hidden only when Linux is primary
    // and the disclosure is closed.
    note.hidden = primaryOS() === 'linux' && !open;
  }

  function promote(os) {
    var card = $('dl-card-' + os);
    var primary = $('dl-primary-slot');
    var others = $('dl-others-slot');
    if (!card || !primary || !others) return;
    if (card.parentElement === primary) return; // already up top (macOS)
    var current = primary.querySelector('.dl-card'); // displaced (macOS)
    primary.appendChild(card);
    if (current) others.appendChild(current);
  }

  function applyDetection(detected) {
    if (!detected) return;
    if (detected.os === 'macos') {
      var m = $('dl-mac-arch');
      if (m) {
        m.value = detected.arch === 'x86_64' ? 'macos-intel' : 'macos';
        m.dispatchEvent(new Event('change'));
      }
    } else if (detected.os === 'windows') {
      var w = $('dl-win-arch');
      if (w) {
        w.value = detected.arch === 'aarch64' ? 'windows-arm64' : 'windows';
        w.dispatchEvent(new Event('change'));
      }
    } else if (detected.os === 'linux') {
      var la = $('dl-lin-arch');
      if (la) {
        la.value = detected.arch === 'aarch64' ? 'aarch64' : 'x86_64';
        la.dispatchEvent(new Event('change'));
      }
    }
    promote(detected.os);
  }

  document.addEventListener('DOMContentLoaded', async function () {
    wireMac();
    wireWindows();
    wireLinux();
    var others = $('dl-others');
    if (others) others.addEventListener('toggle', updateNote);
    var detected = await detect();
    applyDetection(detected);
    updateNote();
  });
})();
