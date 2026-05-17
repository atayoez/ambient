// Hero-demo backdrop scroller.
//
// Crossfades between PNG screenshots captured from the live app —
// one per app tab. Driven by the prev/next arrows in the
// liquid-glass .demo-scroller pill; the visible shot is whichever
// .demo-shot has .active. Opacity transition lives in styles.css.

(function () {
  'use strict';

  // Order mirrors the app's tab order so prev/next feels like a
  // walkthrough rather than random shuffle.
  var SHOTS = [
    { id: 'patterns', label: 'Patterns' },
    { id: 'sources',  label: 'Sources'  },
    { id: 'generate', label: 'Generate' },
    { id: 'library',  label: 'Library'  },
  ];

  function wireScroller() {
    var stage = document.querySelector('.hero-demo-bg .demo-stage');
    var label = document.querySelector('[data-shot-label]');
    var prev = document.querySelector('.demo-prev');
    var next = document.querySelector('.demo-next');
    if (!stage || !prev || !next) return;

    var shots = Array.prototype.slice.call(stage.querySelectorAll('.demo-shot'));
    var index = 0;

    function show(i) {
      index = ((i % SHOTS.length) + SHOTS.length) % SHOTS.length;
      var current = SHOTS[index];
      shots.forEach(function (s) {
        s.classList.toggle('active', s.getAttribute('data-shot') === current.id);
      });
      if (label) label.textContent = current.label;
    }

    prev.addEventListener('click', function () { show(index - 1); });
    next.addEventListener('click', function () { show(index + 1); });
  }

  document.addEventListener('DOMContentLoaded', wireScroller);
})();
