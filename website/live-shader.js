// Live wallpaper backdrop — the real thing.
//
// The GLSL comes from shaders.gen.js (window.AMBIENT_SHADERS), GENERATED
// from the app's src/lib/shaders.ts by scripts/gen-shaders.ts — the SAME
// fragment shaders the desktop app runs as live wallpapers, rendered
// full-bleed behind the whole site so the homepage literally *is* a live
// wallpaper. This file is only the runner + curated presets; it carries no
// shader source of its own (the old hand-copied GLSL drifted from the app).
// It autoplays through a curated set of patterns, crossfades on switch, and
// publishes each one's tint onto :root so every liquid-glass surface
// re-tints to match.
//
// Progressive enhancement: if WebGL2 is unavailable or the visitor prefers
// reduced motion, this bails and the static CSS backdrop (wallpapers.js)
// shows instead — so the page is never blank and never forces motion.

(function () {
  'use strict';

  var reduce =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- GLSL (generated bundle) --------------------------------------

  var GEN = window.AMBIENT_SHADERS;
  if (!GEN) return; // bundle missing → the static CSS backdrop stays

  var VERT = GEN.vert;
  var FRAG = GEN.frags;
  var MAX_COLORS = GEN.maxColors;
  var MATRIX_CHARSET = GEN.matrixCharset;

  function matrixSlots(text) {
    var out = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var n = 0;
    var chars = (text || '').toUpperCase();
    for (var i = 0; i < chars.length && n < 15; i++) {
      var idx = MATRIX_CHARSET.indexOf(chars.charAt(i));
      if (idx >= 0) out[n++] = idx;
    }
    out[15] = n;
    return out;
  }

  // ---- curated presets (palette + type + knobs) ---------------------
  // base is u_colors[0] (background); colors[] are the foreground palette.
  // knobs: [p1, p2, p3] meaning per type (see shaders.ts header).

  var PRESETS = [
    { name: 'Aurora', type: 'aurora', tint: [94, 234, 212], size: 80,
      base: '#04130f', colors: ['#5eead4', '#34d399', '#818cf8', '#22d3ee', '#c4b5fd'], p: [6, 0.55, 0.6] },
    { name: 'Silk', type: 'waves', tint: [56, 189, 248], size: 80,
      base: '#04141d', colors: ['#38bdf8', '#0ea5e9', '#22d3ee', '#2563eb', '#67e8f9'], p: [9, 0.62, 0.5] },
    { name: 'Ember', type: 'flow', tint: [248, 113, 113], size: 90,
      base: '#170707', colors: ['#f87171', '#fb923c', '#fbbf24', '#ef4444'], p: [7, 0.6, 0.5] },
    { name: 'Bloom', type: 'flower', tint: [244, 114, 182], size: 92,
      base: '#160a18', colors: ['#f472b6', '#a78bfa', '#fbbf24', '#fb7185'], p: [8, 0.6, 0] },
    { name: 'Bokeh', type: 'bokeh', tint: [129, 140, 248], size: 70,
      base: '#0a0a1f', colors: ['#818cf8', '#c4b5fd', '#f472b6', '#67e8f9', '#fcd34d'], p: [30, 0, 0] },
    { name: 'Forest', type: 'waves', tint: [52, 211, 153], size: 80,
      base: '#06140e', colors: ['#34d399', '#10b981', '#a3e635', '#14b8a6', '#86efac'], p: [8, 0.55, 0.45] },
    { name: 'Tide', type: 'aurora', tint: [56, 189, 248], size: 80,
      base: '#04141d', colors: ['#38bdf8', '#22d3ee', '#67e8f9', '#2563eb', '#a5f3fc'], p: [7, 0.6, 0.5] },
    // New in 1.3 — the Matrix rains the app's name; the CRT card hums.
    { name: 'Matrix', type: 'matrix', tint: [61, 214, 140], size: 80,
      base: '#04120a', colors: ['#3dd68c', '#a3f7bf', '#1f8a5b'], p: [42, 0.55, 0.45], text: 'AMBIENT' },
    { name: 'CRT Test', type: 'crt', tint: [148, 163, 184], size: 80,
      base: '#000000', colors: ['#94a3b8'], p: [0.6, 0.35, 0.3] },
    // Emoji isn't a shader — rendered as a drifting tiled DOM layer (see
    // buildEmoji / the #wp-emoji crossfade), so the live backdrop showcases
    // the app's emoji walls too, not just the generative shaders.
    { name: 'Blossom', type: 'emoji', tint: [244, 114, 182],
      base: '#160a18', colors: ['#f472b6', '#a78bfa'], emojis: ['🌸', '🌷', '✨'] },
    { name: 'Cosmos', type: 'emoji', tint: [124, 92, 255],
      base: '#0a0a1f', colors: ['#7c5cff', '#5b8cff'], emojis: ['🌟', '🌙', '💫'] },
  ];

  function hexRgb(hex) {
    var h = hex.replace('#', '');
    return [
      parseInt(h.substr(0, 2), 16) / 255,
      parseInt(h.substr(2, 2), 16) / 255,
      parseInt(h.substr(4, 2), 16) / 255,
    ];
  }

  // ---- engine -------------------------------------------------------

  function start() {
    var backdrop = document.getElementById('wp-backdrop');
    if (!backdrop) return false;

    var canvas = document.createElement('canvas');
    canvas.id = 'wp-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      premultipliedAlpha: false,
    });
    if (!gl) return false; // no WebGL2 → leave the CSS backdrop in place

    backdrop.appendChild(canvas);
    // Signal the static engine to stand down — the live canvas owns the
    // backdrop + the prev/next arrows now.
    window.__AMBIENT_LIVE__ = true;

    // Emoji preset layer: emoji isn't a shader, so emoji presets render here
    // (tiled emoji wall over colour blobs) and go() crossfades it with the GL
    // canvas. Mirrors wallpapers.js's emoji() look.
    var emojiLayer = document.createElement('div');
    emojiLayer.id = 'wp-emoji';
    emojiLayer.setAttribute('aria-hidden', 'true');
    backdrop.appendChild(emojiLayer);

    function rgba(hex, a) {
      var h = hex.replace('#', '');
      return 'rgba(' + parseInt(h.substr(0, 2), 16) + ',' + parseInt(h.substr(2, 2), 16) +
        ',' + parseInt(h.substr(4, 2), 16) + ',' + a + ')';
    }
    function buildEmoji(wp) {
      var e = wp.emojis || ['✨', '🌙', '💫'];
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
        '<text x="38" y="52" font-size="42" text-anchor="middle" transform="rotate(-12 38 42)">' + e[0] + '</text>' +
        '<text x="112" y="64" font-size="40" text-anchor="middle" transform="rotate(10 112 54)">' + (e[1] || e[0]) + '</text>' +
        '<text x="78" y="120" font-size="44" text-anchor="middle" transform="rotate(-6 78 110)">' + (e[2] || e[0]) + '</text>' +
        '</svg>';
      emojiLayer.style.backgroundColor = wp.base;
      emojiLayer.style.backgroundImage = [
        'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")',
        'radial-gradient(70% 70% at 28% 24%, ' + rgba(wp.colors[0], 0.55) + ' 0%, transparent 72%)',
        'radial-gradient(70% 70% at 82% 84%, ' + rgba(wp.colors[1] || wp.colors[0], 0.5) + ' 0%, transparent 72%)',
      ].join(', ');
      emojiLayer.style.backgroundSize = '168px 168px, auto, auto';
    }

    var MAX_DIM = 2200; // cap internal resolution for fill-rate
    var MIN_FRAME_MS = 1000 / 32; // ~32fps is plenty for a background

    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    var program = null;
    var activeType = null;
    var u = {};
    var colorBuf = new Float32Array(MAX_COLORS * 3);
    var UNI = ['u_resolution', 'u_time', 'u_colors', 'u_colorCount', 'u_seed', 'u_size', 'u_p1', 'u_p2', 'u_p3', 'u_t0', 'u_t1', 'u_t2', 'u_t3'];

    function compile(kind, src) {
      var s = gl.createShader(kind);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error('compile: ' + log);
      }
      return s;
    }

    function buildProgram(type) {
      var frag = FRAG[type];
      if (!frag) return false;
      var vs = compile(gl.VERTEX_SHADER, VERT);
      var fs = compile(gl.FRAGMENT_SHADER, frag);
      var p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, 'a_pos');
      gl.linkProgram(p);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        var log = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error('link: ' + log);
      }
      if (program) gl.deleteProgram(program);
      program = p;
      activeType = type;
      u = {};
      for (var i = 0; i < UNI.length; i++) u[UNI[i]] = gl.getUniformLocation(p, UNI[i]);
      return true;
    }

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(rect.width * dpr));
      var h = Math.max(1, Math.round(rect.height * dpr));
      var lo = Math.max(w, h);
      if (lo > MAX_DIM) {
        var s = MAX_DIM / lo;
        w = Math.max(1, Math.round(w * s));
        h = Math.max(1, Math.round(h * s));
      }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    var index = 0;
    var seed = 7;

    function applyPreset(i, publishTint) {
      index = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
      var wp = PRESETS[index];
      seed = 7 + index * 13;
      if (wp.type === 'emoji') {
        buildEmoji(wp);
        current = wp;
      } else {
        try {
          if (wp.type !== activeType) buildProgram(wp.type);
        } catch (e) {
          return;
        }
        var list = [wp.base].concat(wp.colors);
        var last = list[list.length - 1];
        for (var k = 0; k < MAX_COLORS; k++) {
          var c = hexRgb(list[k] || last);
          colorBuf[k * 3] = c[0];
          colorBuf[k * 3 + 1] = c[1];
          colorBuf[k * 3 + 2] = c[2];
        }
        current = wp;
        current._count = Math.min(list.length, MAX_COLORS);
      }
      if (publishTint !== false) {
        var root = document.documentElement;
        root.style.setProperty('--tint-r', wp.tint[0]);
        root.style.setProperty('--tint-g', wp.tint[1]);
        root.style.setProperty('--tint-b', wp.tint[2]);
        var label = document.querySelector('[data-shot-label]');
        if (label) label.textContent = wp.name;
      }
    }

    var current = null;

    function render(timeSec) {
      if (!current || current.type === 'emoji') return; // emoji = DOM layer, not GL
      if (!program) return;
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.u_resolution, canvas.width, canvas.height);
      gl.uniform1f(u.u_time, timeSec);
      gl.uniform3fv(u.u_colors, colorBuf);
      gl.uniform1i(u.u_colorCount, current._count);
      gl.uniform1f(u.u_seed, seed);
      gl.uniform1f(u.u_size, current.size || 80);
      gl.uniform1f(u.u_p1, current.p[0]);
      gl.uniform1f(u.u_p2, current.p[1]);
      gl.uniform1f(u.u_p3, current.p[2]);
      var ts = matrixSlots(current.type === 'matrix' ? current.text : '');
      gl.uniform4f(u.u_t0, ts[0], ts[1], ts[2], ts[3]);
      gl.uniform4f(u.u_t1, ts[4], ts[5], ts[6], ts[7]);
      gl.uniform4f(u.u_t2, ts[8], ts[9], ts[10], ts[11]);
      gl.uniform4f(u.u_t3, ts[12], ts[13], ts[14], ts[15]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var startMs = -1;
    var lastMs = -1;
    var raf = 0;
    function frame(now) {
      if (startMs < 0) startMs = now;
      if (lastMs < 0 || now - lastMs >= MIN_FRAME_MS) {
        lastMs = now;
        render((now - startMs) / 1000);
      }
      raf = requestAnimationFrame(frame);
    }

    // Crossfade by briefly dropping the canvas opacity through the swap.
    var fadeTimer = 0;
    function go(i) {
      canvas.style.opacity = '0';
      emojiLayer.style.opacity = '0';
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(function () {
        applyPreset(i, true);
        if (current && current.type === 'emoji') {
          emojiLayer.style.opacity = '1';
        } else {
          render(lastMs > 0 ? (lastMs - startMs) / 1000 : 0);
          canvas.style.opacity = '1';
        }
      }, 420);
    }

    // Autoplay + manual controls share one timer.
    var auto = 0;
    function schedule() {
      clearInterval(auto);
      if (reduce) return;
      auto = setInterval(function () { go(index + 1); }, 13000);
    }

    var prev = document.querySelector('.demo-prev');
    var next = document.querySelector('.demo-next');
    if (prev) prev.addEventListener('click', function () { go(index - 1); schedule(); });
    if (next) next.addEventListener('click', function () { go(index + 1); schedule(); });
    var scroller = document.querySelector('.demo-scroller');
    if (scroller) {
      scroller.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { go(index - 1); schedule(); }
        else if (e.key === 'ArrowRight') { go(index + 1); schedule(); }
      });
    }

    // Pause the RAF loop when the tab is hidden (battery + GPU).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      } else if (!reduce && !raf) {
        lastMs = -1;
        raf = requestAnimationFrame(frame);
      }
    });

    applyPreset(0, true);
    if (reduce) {
      render(0); // one frozen frame
    } else {
      raf = requestAnimationFrame(frame);
      schedule();
    }
    return true;
  }

  function boot() {
    try {
      start();
    } catch (e) {
      // Any failure → the static CSS backdrop remains. Never blank.
      window.__AMBIENT_LIVE__ = false;
      if (window.console) console.warn('[live-shader] disabled:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
