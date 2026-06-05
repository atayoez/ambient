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
// Download keys (must match build-latest-json.mjs + the Worker):
//   macos · windows · windows-arm64 ·
//   linux-deb[-arm64] · linux-rpm[-arm64] · linux-pacman (x86_64 only)

(function () {
  'use strict';

  var $ = function (id) {
    return document.getElementById(id);
  };

  function parseUserAgent(ua) {
    if (/Mac|iPhone|iPad/.test(ua)) return { os: 'macos', arch: 'aarch64' };
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

  function linuxKey(format, arch) {
    if (format === 'pacman') return 'linux-pacman'; // x86_64 only
    return arch === 'aarch64' ? 'linux-' + format + '-arm64' : 'linux-' + format;
  }

  function wireLinux() {
    var fmt = $('dl-lin-format');
    var arch = $('dl-lin-arch');
    if (!fmt || !arch) return;
    var armOpt = arch.querySelector('option[value="aarch64"]');
    var update = function () {
      var isPacman = fmt.value === 'pacman'; // Arch ships x86_64 only
      if (armOpt) armOpt.disabled = isPacman;
      if (isPacman && arch.value === 'aarch64') arch.value = 'x86_64';
      setHref('dl-linux', linuxKey(fmt.value, arch.value));
    };
    fmt.addEventListener('change', update);
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
    if (detected.os === 'windows') {
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
    wireWindows();
    wireLinux();
    var others = $('dl-others');
    if (others) others.addEventListener('toggle', updateNote);
    var detected = await detect();
    applyDetection(detected);
    updateNote();
  });
})();
