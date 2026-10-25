(function () {
  'use strict';

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // Мобильное меню
  var toggle = document.getElementById('nav-toggle');
  var drawer = document.getElementById('nav-drawer');

  function closeDrawer() {
    if (!toggle || !drawer) return;
    drawer.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Открыть меню');
  }

  if (toggle && drawer) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      drawer.hidden = open;
      toggle.setAttribute('aria-expanded', String(!open));
      toggle.setAttribute('aria-label', open ? 'Открыть меню' : 'Закрыть меню');
    });

    drawer.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeDrawer();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 760) closeDrawer();
    });
  }

  // Пасхалка: Konami-код или двойное нажатие 6, затем 7
  var easter = document.getElementById('easter');
  var konami = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  var seq = 0;
  var digits = [];
  var resetTimer = 0;

  function openEaster() {
    if (!easter) return;
    easter.hidden = false;
    document.body.style.overflow = 'hidden';
    var closeBtn = easter.querySelector('[data-easter-close]');
    if (closeBtn) closeBtn.focus();
  }

  function closeEaster() {
    if (!easter) return;
    easter.hidden = true;
    document.body.style.overflow = '';
  }

  if (easter) {
    easter.addEventListener('click', function (e) {
      if (e.target === easter || e.target.closest('[data-easter-close]')) closeEaster();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeEaster();
      closeDrawer();
      return;
    }

    if (e.keyCode === konami[seq]) {
      seq += 1;
      if (seq === konami.length) {
        seq = 0;
        openEaster();
      }
    } else {
      seq = 0;
    }

    if (e.key === '6' || e.key === '7') {
      digits.push(e.key);
      if (digits.length > 2) digits = digits.slice(-2);
      clearTimeout(resetTimer);
      resetTimer = setTimeout(function () { digits = []; }, 1500);
      if (digits.join('') === '67') {
        digits = [];
        openEaster();
      }
    }
  });
})();
