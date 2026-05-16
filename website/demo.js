// Sneak-peek gallery controller.
//
// Crossfades between PNG screenshots captured from the live app — one
// per tab. The .active class is mirrored between matching
// .demo-tab[data-tab] and .demo-shot[data-shot] elements; opacity
// transition lives in styles.css.

(function () {
  'use strict';

  function wireTabs() {
    var tabs = document.querySelectorAll('.demo-tab');
    var shots = document.querySelectorAll('.demo-shot');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-tab');
        tabs.forEach(function (t) {
          t.classList.toggle('active', t === tab);
        });
        shots.forEach(function (s) {
          s.classList.toggle('active', s.getAttribute('data-shot') === target);
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', wireTabs);
})();
