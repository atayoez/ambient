// Wallpaper backdrop + UI tint engine.
//
// A full-page fixed backdrop renders one of N "wallpapers" behind the
// whole site, mirroring the app's pattern types — mesh gradients, dot
// grids, diagonal stripes, scattered geometric shapes, and emoji walls —
// all as pure CSS / data-URI backgrounds (no image files: they scale to
// any viewport and crossfade on the GPU). The prev/next arrows cycle
// them; each publishes a tint colour onto :root (--tint-r/g/b) that every
// liquid-glass surface reads, so cycling re-tints the whole UI.
//
// Motion is strictly user-driven — no autoplay — matching the app's
// minimal-chrome stance.

(function () {
  'use strict';

  // --- helpers -------------------------------------------------------

  // #rrggbb → rgba() at the given alpha.
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substr(0, 2), 16);
    var g = parseInt(h.substr(2, 2), 16);
    var b = parseInt(h.substr(4, 2), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
  }

  function svgUrl(svg) {
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  // --- per-type background builders ---------------------------------
  // Each returns { color, image, size, position } — the four background
  // longhands apply() writes onto the layer. Mesh/blobs default to
  // size:auto position:center; tiled types set an explicit tile.

  var MESH_SPOTS = [
    [22, 28, 58], [80, 18, 52], [70, 74, 62], [24, 80, 54], [50, 46, 44],
  ];

  function mesh(wp) {
    var image = MESH_SPOTS.map(function (s, i) {
      var c = wp.colors[i % wp.colors.length];
      return 'radial-gradient(' + s[2] + '% ' + s[2] + '% at ' +
        s[0] + '% ' + s[1] + '%, ' + c + ' 0%, transparent 68%)';
    }).join(', ');
    return { color: wp.base, image: image, size: 'auto', position: 'center' };
  }

  function dots(wp) {
    var c = wp.colors;
    // Two soft colour blobs for depth, then a staggered two-tone dot grid.
    var image = [
      'radial-gradient(62% 62% at 24% 26%, ' + rgba(c[2] || c[0], 0.5) + ' 0%, transparent 70%)',
      'radial-gradient(62% 62% at 80% 82%, ' + rgba(c[1] || c[0], 0.5) + ' 0%, transparent 70%)',
      'radial-gradient(circle at 50% 50%, ' + c[0] + ' 0 16%, transparent 18%)',
      'radial-gradient(circle at 50% 50%, ' + (c[3] || c[1] || c[0]) + ' 0 16%, transparent 18%)',
    ].join(', ');
    return {
      color: wp.base,
      image: image,
      size: 'auto, auto, 62px 62px, 62px 62px',
      position: 'center, center, 0 0, 31px 31px',
    };
  }

  function stripes(wp) {
    var c = wp.colors;
    var image = [
      'radial-gradient(90% 70% at 50% 0%, ' + rgba(c[0], 0.4) + ' 0%, transparent 72%)',
      'repeating-linear-gradient(54deg, ' +
        rgba(c[1], 0.92) + ' 0 30px, ' +
        rgba(c[2] || c[0], 0.92) + ' 30px 60px, ' +
        rgba(c[3] || c[1], 0.88) + ' 60px 90px)',
    ].join(', ');
    return { color: wp.base, image: image, size: 'auto', position: 'center' };
  }

  function geometric(wp) {
    var c = wp.colors;
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
      '<rect width="150" height="150" fill="' + wp.base + '"/>' +
      '<circle cx="34" cy="36" r="22" fill="' + c[0] + '"/>' +
      '<polygon points="112,16 136,60 88,60" fill="' + c[1] + '"/>' +
      '<rect x="92" y="92" width="42" height="42" rx="9" fill="' + (c[2] || c[0]) + '"/>' +
      '<polygon points="36,134 14,96 58,96" fill="' + (c[3] || c[1]) + '"/>' +
      '<circle cx="120" cy="120" r="6" fill="' + (c[4] || c[0]) + '"/>' +
      '</svg>';
    return { color: wp.base, image: svgUrl(svg), size: '190px 190px', position: 'center' };
  }

  function emoji(wp) {
    var e = wp.emojis || ['✨', '🌙', '💫'];
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">' +
      '<text x="38" y="52" font-size="42" text-anchor="middle" transform="rotate(-12 38 42)">' + e[0] + '</text>' +
      '<text x="112" y="64" font-size="40" text-anchor="middle" transform="rotate(10 112 54)">' + (e[1] || e[0]) + '</text>' +
      '<text x="78" y="120" font-size="44" text-anchor="middle" transform="rotate(-6 78 110)">' + (e[2] || e[0]) + '</text>' +
      '</svg>';
    // Emoji tile on top, soft colour blobs underneath for a tinted field.
    var image = [
      svgUrl(svg),
      'radial-gradient(70% 70% at 28% 24%, ' + rgba(wp.colors[0], 0.55) + ' 0%, transparent 72%)',
      'radial-gradient(70% 70% at 82% 84%, ' + rgba(wp.colors[1] || wp.colors[0], 0.5) + ' 0%, transparent 72%)',
    ].join(', ');
    return {
      color: wp.base,
      image: image,
      size: '168px 168px, auto, auto',
      position: 'center, center, center',
    };
  }

  var BUILDERS = {
    mesh: mesh, dots: dots, stripes: stripes, geometric: geometric, emoji: emoji,
  };

  // --- the wallpaper set --------------------------------------------
  // Mix of pattern types so the selector showcases what the app makes.
  // `tint` is the RGB the whole UI adopts while each is showing.

  var WALLPAPERS = [
    { name: 'Cosmic', type: 'mesh', base: '#0c0a1f', tint: [124, 92, 255],
      colors: ['#7c5cff', '#ec4899', '#fbbf24', '#5b8cff', '#a78bfa'] },
    { name: 'Ocean', type: 'mesh', base: '#04141d', tint: [56, 189, 248],
      colors: ['#38bdf8', '#0ea5e9', '#22d3ee', '#2563eb', '#67e8f9'] },
    { name: 'Confetti', type: 'dots', base: '#160b1c', tint: [244, 114, 182],
      colors: ['#f472b6', '#22d3ee', '#a78bfa', '#fbbf24', '#34d399'] },
    { name: 'Ribbon', type: 'stripes', base: '#1a0a14', tint: [251, 146, 60],
      colors: ['#fb923c', '#f43f5e', '#a855f7', '#fbbf24'] },
    { name: 'Forest', type: 'mesh', base: '#06140e', tint: [52, 211, 153],
      colors: ['#34d399', '#10b981', '#a3e635', '#14b8a6', '#86efac'] },
    { name: 'Mosaic', type: 'geometric', base: '#0d1018', tint: [129, 140, 248],
      colors: ['#818cf8', '#22d3ee', '#f472b6', '#fbbf24', '#34d399'] },
    { name: 'Bloom', type: 'emoji', base: '#160a18', tint: [244, 114, 182],
      colors: ['#f472b6', '#a78bfa'], emojis: ['🌸', '🌷', '✨'] },
    { name: 'Ember', type: 'stripes', base: '#170707', tint: [248, 113, 113],
      colors: ['#f87171', '#fb923c', '#fbbf24', '#ef4444'] },
    { name: 'Aurora', type: 'mesh', base: '#04130f', tint: [94, 234, 212],
      colors: ['#5eead4', '#34d399', '#818cf8', '#22d3ee', '#c4b5fd'] },
    { name: 'Cosmos', type: 'emoji', base: '#0a0a1f', tint: [124, 92, 255],
      colors: ['#7c5cff', '#5b8cff'], emojis: ['🌟', '🌙', '💫'] },
    { name: 'Polka', type: 'dots', base: '#04141d', tint: [56, 189, 248],
      colors: ['#38bdf8', '#22d3ee', '#67e8f9', '#2563eb'] },
    { name: 'Gold', type: 'mesh', base: '#15100a', tint: [251, 191, 36],
      colors: ['#fbbf24', '#f59e0b', '#fcd34d', '#b45309', '#fde68a'] },
  ];

  function build(wp) {
    return (BUILDERS[wp.type] || mesh)(wp);
  }

  // --- wiring --------------------------------------------------------

  function wire() {
    var root = document.documentElement;
    var layerEls = Array.prototype.slice.call(
      document.querySelectorAll('#wp-backdrop .wp-layer'),
    );
    var label = document.querySelector('[data-shot-label]');
    var prev = document.querySelector('.demo-prev');
    var next = document.querySelector('.demo-next');
    if (layerEls.length < 2 || !prev || !next) return;

    var index = 0;
    var active = 0;

    function apply(i) {
      index = ((i % WALLPAPERS.length) + WALLPAPERS.length) % WALLPAPERS.length;
      var wp = WALLPAPERS[index];
      var bg = build(wp);

      var incoming = (active + 1) % 2;
      var el = layerEls[incoming];
      el.style.backgroundColor = bg.color;
      el.style.backgroundImage = bg.image;
      el.style.backgroundSize = bg.size || 'auto';
      el.style.backgroundPosition = bg.position || 'center';
      el.style.backgroundRepeat = 'repeat';
      el.classList.add('is-active');
      layerEls[active].classList.remove('is-active');
      active = incoming;

      root.style.setProperty('--tint-r', wp.tint[0]);
      root.style.setProperty('--tint-g', wp.tint[1]);
      root.style.setProperty('--tint-b', wp.tint[2]);

      if (label) label.textContent = wp.name;
    }

    prev.addEventListener('click', function () { apply(index - 1); });
    next.addEventListener('click', function () { apply(index + 1); });

    var scroller = document.querySelector('.demo-scroller');
    if (scroller) {
      scroller.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') apply(index - 1);
        else if (e.key === 'ArrowRight') apply(index + 1);
      });
    }

    apply(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
