// Download cards: three per-OS blocks (macOS / Windows / Linux). This
// script does two things:
//   1. Detects the visitor's OS + CPU and pre-selects the matching card's
//      dropdowns + highlights that card (so the common case is one click).
//   2. Recomputes each card's button href from its dropdown(s), mapping
//      the choice to a /downloads/latest/<key> alias the Worker resolves.
//
// Detection order: navigator.userAgentData.getHighEntropyValues
// (Chromium, accurate arch), then userAgent heuristics, then no-op (the
// HTML defaults to x86_64, and every control is manual anyway).
//
// Download keys (must match build-latest-json.mjs `downloads` + the
// Worker): macos · windows · windows-arm64 · linux · linux-arm64 ·
// linux-deb[-arm64] · linux-rpm[-arm64] · linux-pacman (x86_64 only).

(function () {
  'use strict';

  function parseUserAgent(ua) {
    if (/Mac|iPhone|iPad/.test(ua)) {
      // Shipping macOS target is Apple Silicon; Safari still reports
      // "Intel Mac OS X" in the UA for compat, so default to aarch64.
      return { os: 'macos', arch: 'aarch64' };
    }
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
        var platformRaw = (hints.platform || '').toLowerCase();
        var archRaw = (hints.architecture || '').toLowerCase();
        var os = null;
        if (platformRaw.indexOf('mac') !== -1) os = 'macos';
        else if (platformRaw.indexOf('win') !== -1) os = 'windows';
        else if (platformRaw.indexOf('linux') !== -1) os = 'linux';
        else if (platformRaw.indexOf('chrom') !== -1) os = 'linux';
        if (os) return { os: os, arch: archRaw === 'arm' ? 'aarch64' : 'x86_64' };
      } catch (e) {
        // fall through
      }
    }
    return parseUserAgent(navigator.userAgent || '');
  }

  function setHref(id, key) {
    var el = document.getElementById(id);
    if (el) el.setAttribute('href', '/downloads/latest/' + key);
  }

  // --- Windows: key is just the arch select value -----------------------
  function wireWindows() {
    var sel = document.getElementById('dl-win-arch');
    if (!sel) return;
    var update = function () {
      setHref('dl-windows', sel.value);
    };
    sel.addEventListener('change', update);
    update();
  }

  // --- Linux: compose key from {format, arch} ----------------------------
  function linuxKey(format, arch) {
    if (format === 'appimage') return arch === 'aarch64' ? 'linux-arm64' : 'linux';
    // deb / rpm have both arches; pacman is x86_64 only.
    if (format === 'pacman') return 'linux-pacman';
    return arch === 'aarch64' ? 'linux-' + format + '-arm64' : 'linux-' + format;
  }

  function wireLinux() {
    var fmt = document.getElementById('dl-lin-format');
    var arch = document.getElementById('dl-lin-arch');
    if (!fmt || !arch) return;
    var armOpt = arch.querySelector('option[value="aarch64"]');
    var update = function () {
      // Arch (pacman) only ships x86_64 — disable ARM64 while it's picked.
      var isPacman = fmt.value === 'pacman';
      if (armOpt) armOpt.disabled = isPacman;
      if (isPacman && arch.value === 'aarch64') arch.value = 'x86_64';
      setHref('dl-linux', linuxKey(fmt.value, arch.value));
    };
    fmt.addEventListener('change', update);
    arch.addEventListener('change', update);
    update();
  }

  function applyDetection(detected) {
    if (!detected) return;
    // Pre-select architecture on the relevant card.
    if (detected.os === 'windows') {
      var w = document.getElementById('dl-win-arch');
      if (w) w.value = detected.arch === 'aarch64' ? 'windows-arm64' : 'windows';
    } else if (detected.os === 'linux') {
      var la = document.getElementById('dl-lin-arch');
      if (la) la.value = detected.arch === 'aarch64' ? 'aarch64' : 'x86_64';
    }
    // Highlight the detected card (CSS adds a ring + "for your system").
    var card = document.getElementById('dl-card-' + detected.os);
    if (card) {
      card.classList.add('dl-card-detected');
      // Float it first so the obvious choice leads (CSS order).
      card.style.order = '-1';
    }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    wireWindows();
    wireLinux();
    var detected = await detect();
    applyDetection(detected);
    // Re-run wiring after detection set the selects, so hrefs match.
    var w = document.getElementById('dl-win-arch');
    if (w) w.dispatchEvent(new Event('change'));
    var lf = document.getElementById('dl-lin-format');
    if (lf) lf.dispatchEvent(new Event('change'));
  });
})();
