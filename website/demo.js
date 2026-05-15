// Sneak-peek demo controller.
//
// Renders a simplified Patterns canvas matching the app's
// src/lib/patterns.ts algorithm (mesh / geometric / dots / stripes),
// and wires the 5 tab buttons + palette / pattern-type selectors.

(function () {
  'use strict';

  // --- Cosmic / Sunset / Ocean / Pastel palettes (matches the app's
  // PRESET_PALETTES table). ---
  var PALETTES = {
    cosmic: ['#0c0a1f', '#7c5cff', '#ec4899', '#fbbf24', '#f1ecff'],
    sunset: ['#1f0e3d', '#7b2cbf', '#e94560', '#ff9f1c', '#fcd34d'],
    ocean:  ['#011627', '#0e2954', '#2e8bc0', '#5fd3bc', '#bfffcc'],
    pastel: ['#fdf2f8', '#fbcfe8', '#c7d2fe', '#a7f3d0', '#fef3c7'],
  };

  // --- State ----------------------------------------------------------
  var state = {
    type: 'mesh',
    palette: 'cosmic',
    seed: Math.floor(Math.random() * 1e6),
  };

  // --- Seeded RNG (LCG, same shape as the app's seededRandom) --------
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s / 0x100000000;
    };
  }

  function hexToRgba(hex, a) {
    var m = hex.replace('#', '');
    var r = parseInt(m.slice(0, 2), 16);
    var g = parseInt(m.slice(2, 4), 16);
    var b = parseInt(m.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function halton(i, base) {
    var f = 1 / base;
    var r = 0;
    var n = i;
    while (n > 0) {
      r += f * (n % base);
      n = Math.floor(n / base);
      f /= base;
    }
    return r;
  }

  // --- Renderers ------------------------------------------------------

  function renderMesh(ctx, w, h, colors, seed) {
    var rand = rng(seed);
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    var layers = Math.max(10, colors.length * 3);
    var seedOffset = Math.floor(rand() * 1000);
    for (var i = 0; i < layers; i++) {
      var color = colors[(i + 1) % colors.length];
      var cx = (halton(i + 1 + seedOffset, 2) * 1.2 - 0.1) * w;
      var cy = (halton(i + 1 + seedOffset, 3) * 1.2 - 0.1) * h;
      var radius = (0.35 + rand() * 0.4) * Math.max(w, h);
      var alpha = 0.55 + rand() * 0.35;
      var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, hexToRgba(color, alpha));
      grad.addColorStop(0.5, hexToRgba(color, alpha * 0.4));
      grad.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
    // Subtle blur via filter pass; matches the app's mesh look.
    ctx.filter = 'blur(' + Math.round(Math.max(w, h) * 0.012) + 'px)';
    ctx.drawImage(ctx.canvas, 0, 0);
    ctx.filter = 'none';
  }

  function renderGeometric(ctx, w, h, colors, seed) {
    var rand = rng(seed);
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    var palette = colors.slice(1).length > 0 ? colors.slice(1) : colors;
    var scale = Math.max(w, h) / 1920;
    var baseSize = 50 * scale;
    var count = Math.round(60 * scale * scale);
    for (var i = 0; i < count; i++) {
      var color = palette[Math.floor(rand() * palette.length)];
      var x = rand() * w;
      var y = rand() * h;
      var s = baseSize * (0.5 + rand() * 1.5);
      var shape = Math.floor(rand() * 3);
      var alpha = 0.55 + rand() * 0.45;
      ctx.fillStyle = hexToRgba(color, alpha);
      if (shape === 0) {
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === 1) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rand() * Math.PI * 2);
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.moveTo(x, y - s);
        ctx.lineTo(x - s * 0.866, y + s * 0.5);
        ctx.lineTo(x + s * 0.866, y + s * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function renderDots(ctx, w, h, colors, seed) {
    var rand = rng(seed);
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    var palette = colors.slice(1).length > 0 ? colors.slice(1) : colors;
    var density = 18;
    var spacing = Math.max(w, h) / density;
    var baseR = spacing * 0.32;
    var row = 0;
    for (var y = spacing / 2; y < h; y += spacing, row++) {
      var stagger = (row % 2) * spacing * 0.5;
      for (var x = stagger - spacing; x < w + spacing; x += spacing) {
        var jx = x + (rand() - 0.5) * spacing * 0.2;
        var jy = y + (rand() - 0.5) * spacing * 0.2;
        var r = Math.max(2, baseR * (0.85 + rand() * 0.35));
        var color = palette[Math.floor(rand() * palette.length)];
        var grad = ctx.createRadialGradient(jx, jy, 0, jx, jy, r);
        grad.addColorStop(0, color);
        grad.addColorStop(0.85, color);
        grad.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(jx - r, jy - r, r * 2, r * 2);
      }
    }
  }

  function renderStripes(ctx, w, h, colors, seed) {
    var rand = rng(seed);
    ctx.fillStyle = colors[0];
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    var rot = -Math.PI / 6 + (rand() - 0.5) * 0.5;
    ctx.rotate(rot);
    var diag = Math.sqrt(w * w + h * h) * 1.1;
    var scale = Math.max(w, h) / 1920;
    var baseW = 80 * scale;
    var x = -diag;
    var i = 0;
    while (x < diag) {
      var stripeW = Math.max(2, baseW * (0.6 + rand() * 0.8));
      var color = colors[i % colors.length];
      ctx.fillStyle = color;
      ctx.fillRect(x - 1, -diag, stripeW + 2, diag * 2);
      x += stripeW;
      i++;
    }
    ctx.restore();
  }

  var RENDERERS = {
    mesh: renderMesh,
    geometric: renderGeometric,
    dots: renderDots,
    stripes: renderStripes,
  };

  // --- Render driver --------------------------------------------------

  function render() {
    var canvas = document.getElementById('demo-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    // DPR-aware sizing — keep the canvas sharp on retina without
    // recomputing on every render.
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.round(rect.width * dpr);
    var h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    var colors = PALETTES[state.palette] || PALETTES.cosmic;
    var fn = RENDERERS[state.type] || renderMesh;
    fn(ctx, w, h, colors, state.seed);
  }

  // --- Tabs -----------------------------------------------------------

  function wireTabs() {
    var tabs = document.querySelectorAll('.demo-tab');
    var panels = document.querySelectorAll('.demo-tab-panel');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab');
        tabs.forEach(function (t) {
          t.classList.toggle('active', t === tab);
        });
        panels.forEach(function (p) {
          p.classList.toggle('active', p.getAttribute('data-panel') === target);
        });
        // Re-render canvas if returning to Patterns — sizes may have
        // changed while the panel was hidden.
        if (target === 'patterns') render();
      });
    });
  }

  function wireTypeList() {
    var rows = document.querySelectorAll('#demo-type-list .demo-type-row');
    rows.forEach(function (row) {
      row.addEventListener('click', function () {
        rows.forEach(function (r) {
          r.classList.toggle('active', r === row);
        });
        state.type = row.getAttribute('data-type') || 'mesh';
        state.seed = Math.floor(Math.random() * 1e6);
        render();
      });
    });
  }

  function wirePresets() {
    var buttons = document.querySelectorAll('#demo-presets button');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        state.palette = btn.getAttribute('data-palette') || 'cosmic';
        render();
      });
    });
  }

  function wireReroll() {
    var btn = document.getElementById('demo-reroll');
    if (!btn) return;
    btn.addEventListener('click', function () {
      state.seed = Math.floor(Math.random() * 1e6);
      render();
    });
  }

  function wireApply() {
    var btn = document.getElementById('demo-apply');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // In the real app this sets the wallpaper. In the demo, scroll
      // to the Pricing section so visitors can convert from the
      // "wait that's the button I'd click" beat.
      var pricing = document.getElementById('pricing');
      if (pricing) pricing.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // --- Bootstrapping --------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    wireTabs();
    wireTypeList();
    wirePresets();
    wireReroll();
    wireApply();
    render();
    // Re-render on window resize so the canvas stays sharp.
    window.addEventListener('resize', render, { passive: true });
  });
})();
