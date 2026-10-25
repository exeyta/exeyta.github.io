/* ==========================================================================
   Exeyta Launcher — "Sunset Protocol" motion layer
   One shared rAF loop, GPU-only writes, pausable canvas, reduced-motion safe.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;

  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var fineMQ = window.matchMedia('(pointer: fine)');
  var reduced = reduceMQ.matches;
  var fine = fineMQ.matches;

  if (reduceMQ.addEventListener) {
    reduceMQ.addEventListener('change', function (e) {
      reduced = e.matches;
      if (reduced) stopLoop();
    });
  }
  if (fineMQ.addEventListener) {
    fineMQ.addEventListener('change', function (e) {
      fine = e.matches;
      if (!fine) resetMagnetics();
    });
  }

  /* --- weak device detection ------------------------------------------- */
  var cores = navigator.hardwareConcurrency || 4;
  var dpr = window.devicePixelRatio || 1;
  var lite = cores <= 2 || dpr > 3 || (cores <= 4 && dpr >= 2);
  if (lite) root.classList.add('lite');

  /* the motion layer is alive → CSS safety net for .reveal is not needed */
  root.classList.add('js-ready');

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function on(el, type, fn, opts) {
    if (el) el.addEventListener(type, fn, opts || false);
  }

  /* --- current year ----------------------------------------------------- */
  var year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());

  /* --- scroll reveal (one shot, staggered) ------------------------------ */
  var reveals = [];

  function settle(el) {
    var i = parseInt(el.style.getPropertyValue('--i'), 10) || 0;
    window.setTimeout(function () {
      el.classList.add('is-settled');
    }, 780 + i * 80);
  }

  function markVisible(el) {
    el.classList.add('is-in');
    settle(el);
  }

  var io = null;

  function revealWatch() {
    /* re-scan on every panel switch: hidden panels keep their nodes, but only
       the newly shown one has to be observed/played */
    reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

    if (!('IntersectionObserver' in window) || reduced) {
      reveals.forEach(function (el) {
        el.classList.add('is-in', 'is-settled');
      });
      return;
    }

    if (!io) {
      var ioFired = false;
      io = new IntersectionObserver(
        function (entries) {
          ioFired = true;
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var el = entry.target;
            io.unobserve(el);
            markVisible(el);
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
      );
      /* safety net: if IntersectionObserver never delivers anything (broken
         environment), content must never stay hidden */
      window.setTimeout(function () {
        if (ioFired) return;
        reveals.forEach(function (el) {
          el.classList.add('is-in', 'is-settled');
        });
      }, 3000);
    }

    reveals.forEach(function (el) {
      if (el.classList.contains('is-in')) return;
      io.observe(el);
    });
  }

  revealWatch();

  /* --- header state, scroll progress, scroll-linked parallax ------------- */
  var header = document.querySelector('.header');
  var progressBar = document.querySelector('.scroll-progress i');
  var scrollQueued = false;

  function applyScroll() {
    scrollQueued = false;
    var y = window.scrollY || window.pageYOffset || 0;

    if (header) header.classList.toggle('is-scrolled', y > 8);

    if (progressBar) {
      var max = (root.scrollHeight - window.innerHeight) || 1;
      var p = clamp(y / max, 0, 1);
      progressBar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }

    if (!reduced) root.style.setProperty('--sy', String(Math.round(Math.min(4000, y))));
  }

  on(window, 'scroll', function () {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(applyScroll);
  }, { passive: true });

  applyScroll();

  /* --- mobile menu ------------------------------------------------------ */
  var burger = document.querySelector('.burger');
  var menu = document.getElementById('mobile-menu');

  function setMenu(open) {
    if (!burger || !menu) return;
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    menu.classList.toggle('is-open', open);
  }

  on(burger, 'click', function () {
    setMenu(burger.getAttribute('aria-expanded') !== 'true');
  });

  on(menu, 'click', function (e) {
    if (e.target && e.target.closest && e.target.closest('a')) setMenu(false);
  });

  on(document, 'keydown', function (e) {
    if (e.key === 'Escape') setMenu(false);
  });

  on(document, 'click', function (e) {
    if (!menu || !menu.classList.contains('is-open')) return;
    if (e.target && e.target.closest && e.target.closest('.header')) return;
    setMenu(false);
  });

  on(window, 'resize', function () {
    if (window.innerWidth > 900) setMenu(false);
  }, { passive: true });

  /* ======================================================================
     Shared rAF loop: tilt, magnetic pull, card parallax, aurora, glow
     ====================================================================== */
  var pointer = { x: -9999, y: -9999, active: false };
  var rafId = 0;
  var running = false;
  var lastActivity = 0;

  var hero = document.querySelector('.hero');
  var stage = document.querySelector('.stage');
  var tiltEl = document.getElementById('shot-tilt');
  var aurora = document.querySelector('.aurora');
  var glow = document.querySelector('.cursor-glow');

  var tilt = { x: 0, y: 0, tx: 0, ty: 0, on: false };
  var auroraPos = { x: 0, y: 0 };
  var glowPos = { x: 0, y: 0 };
  var magneticEls = Array.prototype.slice.call(document.querySelectorAll('.magnetic'));
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var cardState = [];

  function resetMagnetics() {
    magneticEls.forEach(function (el) {
      el.style.translate = '0px 0px';
    });
  }

  function resetCards() {
    cardState.forEach(function (s) {
      s.tx = 0;
      s.ty = 0;
      s.active = false;
    });
  }

  function touch() {
    lastActivity = performance.now();
    startLoop();
  }

  function startLoop() {
    if (running || reduced || document.hidden) return;
    running = true;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* pointer tracking ---------------------------------------------------- */
  on(window, 'pointermove', function (e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') touch();
  }, { passive: true });

  on(document.documentElement, 'pointerleave', function () {
    pointer.active = false;
    tilt.on = false;
    tilt.tx = 0;
    tilt.ty = 0;
    resetMagnetics();
    if (glow) glow.classList.remove('is-on');
    touch();
  });

  on(window, 'blur', function () {
    pointer.active = false;
    resetMagnetics();
    if (glow) glow.classList.remove('is-on');
    touch();
  });

  /* 3D tilt target over the hero ---------------------------------------- */
  if (hero) {
    on(hero, 'pointerenter', function () {
      tilt.on = true;
      touch();
    });
    on(hero, 'pointerleave', function () {
      tilt.on = false;
      tilt.tx = 0;
      tilt.ty = 0;
      touch();
    });
    on(hero, 'pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      var nx = (e.clientX - r.left) / r.width - 0.5;
      var ny = (e.clientY - r.top) / r.height - 0.5;
      tilt.tx = clamp(-ny * 9, -7, 7);
      tilt.ty = clamp(nx * 15, -12, 12);
      touch();
    }, { passive: true });
  }

  /* cards: cursor light + parallax -------------------------------------- */
  cards.forEach(function (card) {
    var s = { el: card, x: 0, y: 0, tx: 0, ty: 0, active: false, px: 0, py: 0 };
    cardState.push(s);

    on(card, 'pointerenter', function (e) {
      if (e.pointerType === 'touch') return;
      s.active = true;
      touch();
    });

    on(card, 'pointermove', function () {
      s.active = true;
      touch();
    }, { passive: true });

    on(card, 'pointerleave', function () {
      s.active = false;
      s.tx = 0;
      s.ty = 0;
      touch();
    });
  });

  /* main tick ----------------------------------------------------------- */
  var EPS = 0.02;

  function tick(now) {
    rafId = requestAnimationFrame(tick);

    var k = lite ? 0.2 : 0.13;
    var busy = false;
    var mx = pointer.active ? pointer.x : -9999;
    var my = pointer.active ? pointer.y : -9999;

    /* --- 3D tilt --- */
    if (tiltEl) {
      tilt.x += (tilt.tx - tilt.x) * k;
      tilt.y += (tilt.ty - tilt.y) * k;
      if (Math.abs(tilt.tx - tilt.x) > EPS || Math.abs(tilt.ty - tilt.y) > EPS) busy = true;
      if (tilt.x !== 0 || tilt.y !== 0 || tilt.on) {
        tiltEl.style.transform =
          'rotateX(' + (4 + tilt.x).toFixed(3) + 'deg) rotateY(' + (-8 + tilt.y).toFixed(3) + 'deg)';
      }
    }

    /* --- magnetic buttons (reads first, writes after) --- */
    var i;
    var rects = [];
    if (pointer.active) {
      for (i = 0; i < magneticEls.length; i++) {
        rects.push(magneticEls[i].getBoundingClientRect());
      }
    }

    for (i = 0; i < magneticEls.length; i++) {
      var el = magneticEls[i];
      var r = rects[i];
      var tx = 0;
      var ty = 0;

      if (r && pointer.active && fine && !reduced && r.width > 0) {
        var near =
          mx > r.left - 30 && mx < r.right + 30 && my > r.top - 30 && my < r.bottom + 30;
        if (near) {
          var cx = r.left + r.width / 2;
          var cy = r.top + r.height / 2;
          tx = clamp((mx - cx) * 0.16, -6, 6);
          ty = clamp((my - cy) * 0.2, -6, 6);
        }
      }
      var cur = el._mag || (el._mag = { x: 0, y: 0 });
      cur.x += (tx - cur.x) * 0.18;
      cur.y += (ty - cur.y) * 0.18;
      if (Math.abs(tx - cur.x) > EPS || Math.abs(ty - cur.y) > EPS) busy = true;
      el.style.translate = cur.x.toFixed(2) + 'px ' + cur.y.toFixed(2) + 'px';
    }

    /* --- cards: light spot + parallax --- */
    for (i = 0; i < cardState.length; i++) {
      var s = cardState[i];
      if (!s.active && Math.abs(s.x) < 0.05 && Math.abs(s.y) < 0.05 && s.tx === 0 && s.ty === 0) {
        if (s.x !== 0 || s.y !== 0) {
          s.x = 0;
          s.y = 0;
          s.el.style.translate = '0px 0px';
        }
        continue;
      }

      var cr = s.el.getBoundingClientRect();
      if (cr.width > 0) {
        var lx = clamp(mx - cr.left, 0, cr.width);
        var ly = clamp(my - cr.top, 0, cr.height);
        if (s.active) {
          s.el.style.setProperty('--x', lx.toFixed(1) + 'px');
          s.el.style.setProperty('--y', ly.toFixed(1) + 'px');
          s.tx = clamp(((mx - cr.left) / cr.width - 0.5) * 20, -10, 10);
          s.ty = clamp(((my - cr.top) / cr.height - 0.5) * 16, -8, 8);
        }
      }

      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
      if (Math.abs(s.tx - s.x) > EPS || Math.abs(s.ty - s.y) > EPS) busy = true;
      s.el.style.translate = s.x.toFixed(2) + 'px ' + s.y.toFixed(2) + 'px';
    }

    /* --- aurora follows the cursor (CSS transition adds inertia) --- */
    if (aurora && pointer.active && fine && !reduced && !lite) {
      var gx = ((mx / window.innerWidth) - 0.5) * 56;
      var gy = ((my / window.innerHeight) - 0.5) * 40;
      if (Math.abs(gx - auroraPos.x) > 0.6 || Math.abs(gy - auroraPos.y) > 0.6) {
        auroraPos.x = gx;
        auroraPos.y = gy;
        aurora.style.setProperty('--gx', gx.toFixed(1) + 'px');
        aurora.style.setProperty('--gy', gy.toFixed(1) + 'px');
        busy = true;
      }
    }

    /* --- desktop cursor glow --- */
    if (glow && fine && !reduced && !lite) {
      if (pointer.active) {
        glowPos.x += (mx - glowPos.x) * 0.14;
        glowPos.y += (my - glowPos.y) * 0.14;
        glow.style.transform =
          'translate3d(' + glowPos.x.toFixed(1) + 'px,' + glowPos.y.toFixed(1) + 'px,0)';
        if (!glow.classList.contains('is-on')) glow.classList.add('is-on');
        busy = true;
      } else if (glow.classList.contains('is-on')) {
        glow.classList.remove('is-on');
      }
    }

    /* stop when everything settled and the pointer is idle */
    if (!busy && now - lastActivity > 1400) {
      running = false;
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  on(document, 'visibilitychange', function () {
    if (document.hidden) stopLoop();
    else touch();
  });

  /* ======================================================================
     Section tabs — one panel at a time, starts on «Главная»
     ====================================================================== */
  var tabsRoot = document.querySelector('[data-tabs]');
  var tabButtons = [];
  var panels = [];
  var tabInk = null;
  var activeIndex = 0;
  var tabSettleTimer = 0;

  if (tabsRoot) {
    tabButtons = Array.prototype.slice.call(tabsRoot.querySelectorAll('[role="tab"]'));
    tabInk = tabsRoot.querySelector('.tab-ink');
    panels = tabButtons
      .map(function (btn) {
        return document.getElementById(btn.getAttribute('aria-controls'));
      })
      .filter(Boolean);
  }

  var TAB_COUNT = tabButtons.length;

  /* gradient indicator follows the active tab; measured after layout so it
     never lands on a stale position when the rail scrolls horizontally */
  function moveInk() {
    if (!tabsRoot || !tabInk || !tabButtons.length) return;
    var rail = tabsRoot.querySelector('.tab-rail');
    var btn = tabButtons[activeIndex];
    if (!rail || !btn) return;
    var railRect = rail.getBoundingClientRect();
    var btnRect = btn.getBoundingClientRect();
    var pad = (railRect.height - btnRect.height) / 2;
    tabsRoot.style.setProperty('--tab-x', (btnRect.left - railRect.left - pad).toFixed(2) + 'px');
    tabsRoot.style.setProperty('--tab-w', btnRect.width.toFixed(2) + 'px');
    rail.classList.add('is-measured');
  }

  /* on narrow screens the rail is a swipeable strip — keep the tab in view */
  function onInkMoved() {
    var rail = tabsRoot && tabsRoot.querySelector('.tab-rail');
    if (!rail || rail.scrollWidth <= rail.clientWidth + 2) return;
    var target = tabButtons[activeIndex];
    if (!target || !rail.scrollTo) return;
    rail.scrollTo({
      left: Math.max(0, target.offsetLeft - rail.clientWidth / 2 + target.offsetWidth / 2),
      behavior: reduced ? 'auto' : 'smooth'
    });
  }

  function showPanel(index, opts) {
    if (!panels.length) return;
    var next = clamp(index, 0, panels.length - 1);
    var options = opts || {};
    var changed = next !== activeIndex || options.force;

    activeIndex = next;

    tabButtons.forEach(function (btn, i) {
      var active = i === next;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
      btn.tabIndex = active ? 0 : -1;
    });

    panels.forEach(function (panel, i) {
      if (i === next) {
        panel.classList.remove('is-leaving');
        panel.hidden = false;
        /* restart the entrance animation on every switch */
        panel.classList.remove('is-active');
        void panel.offsetWidth;
        panel.classList.add('is-active');
      } else {
        panel.hidden = true;
        panel.classList.remove('is-active', 'is-leaving');
      }
    });

    moveInk();
    onInkMoved();

    /* reveals inside a freshly shown panel start hidden until observed */
    if (changed) revealWatch();

    if (options.scroll && tabsRoot) {
      var top = tabsRoot.getBoundingClientRect().top + (window.scrollY || 0);
      window.scrollTo({ top: Math.max(0, top - 12), behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  /* the outgoing panel leaves first (short GPU-only exit), then the new one enters */
  function switchPanel(index, opts) {
    if (!panels.length) return;
    var next = clamp(index, 0, panels.length - 1);
    var current = panels[activeIndex];

    if (next === activeIndex || !current || reduced) {
      showPanel(next, opts);
      return;
    }

    window.clearTimeout(tabSettleTimer);
    current.classList.add('is-leaving');
    tabSettleTimer = window.setTimeout(function () {
      showPanel(next, opts);
    }, 150);
  }


  function tabIndexOf(panel) {
    var id = panel && panel.id;
    for (var i = 0; i < panels.length; i++) {
      if (panels[i].id === id) return i;
    }
    return -1;
  }

  function tabIndexOfHash(hash) {
    if (!hash || hash.charAt(0) !== '#') return -1;
    var key = hash.slice(1);
    if (key === 'top' || key === 'main') return 0;
    var el = document.getElementById(key);
    if (!el) return -1;
    var panel = el.closest ? el.closest('.panel') : null;
    return panel ? tabIndexOf(panel) : -1;
  }

  if (panels.length) {
    /* click + roving-keyboard control on the tablist */
    tabButtons.forEach(function (btn, i) {
      on(btn, 'click', function () {
        switchPanel(i, { scroll: (window.scrollY || 0) > 40 });
      });

      on(btn, 'keydown', function (e) {
        var key = e.key;
        var delta = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
        var target = null;

        if (delta) target = (i + delta + TAB_COUNT) % TAB_COUNT;
        else if (key === 'Home') target = 0;
        else if (key === 'End') target = TAB_COUNT - 1;
        else return;

        e.preventDefault();
        tabButtons[target].focus();
        switchPanel(target, { scroll: false });
      });
    });

    /* header, hero and mobile-menu links activate the matching tab */
    on(document, 'click', function (e) {
      var link = e.target && e.target.closest && e.target.closest('[data-tab-link]');
      if (!link) return;
      var index = tabIndexOf(document.getElementById(link.getAttribute('data-tab-link')));
      if (index < 0) return;
      e.preventDefault();
      switchPanel(index, { scroll: true, replaceHash: true });
      /* the same link may live inside a dialog — close it so the tab is visible */
      var hostModal = link.closest ? link.closest('.modal') : null;
      if (hostModal) closeModalShell(hostModal, true);
    });

    /* deep links: #panel-editor works directly, and so does the old #editor */
    on(window, 'hashchange', function () {
      var index = tabIndexOfHash(window.location.hash);
      if (index >= 0) switchPanel(index, { scroll: true });
    });

    var startIndex = tabIndexOfHash(window.location.hash);
    showPanel(startIndex >= 0 ? startIndex : 0, { force: true });

    /* the rail is a horizontally scrollable strip on narrow screens */
    on(window, 'resize', function () {
      moveInk();
    }, { passive: true });

    if ('ResizeObserver' in window) {
      new ResizeObserver(moveInk).observe(tabButtons[0]);
    }

    /* webfonts land after first paint → re-measure once they are ready */
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(moveInk);
    }
    window.setTimeout(moveInk, 240);
  }


  /* ======================================================================
     Modals — one shell for section dialogs and the easter egg
     ====================================================================== */
  var openModal = null;
  var lastFocus = null;
  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusables(scope) {
    if (!scope) return [];
    return Array.prototype.slice.call(scope.querySelectorAll(FOCUSABLE)).filter(function (el) {
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
    });
  }

  function openModalById(el) {
    if (!el || openModal === el) return;
    if (openModal) closeModalShell(openModal, false);

    lastFocus = document.activeElement;
    el.hidden = false;
    el.classList.add('is-on');
    body.classList.add('modal-open');
    openModal = el;

    var first = el.querySelector('[data-modal-close]') || focusables(el)[0];
    if (first && first.focus) {
      try {
        first.focus({ preventScroll: true });
      } catch (err) {
        first.focus();
      }
    }
    touch();
  }

  function closeModalShell(el, restoreFocus) {
    if (!el || !el.classList.contains('is-on')) return;
    el.classList.remove('is-on');
    body.classList.remove('modal-open');
    if (el.id === 'easter') body.classList.remove('egg-open');
    if (openModal === el) openModal = null;

    /* keep the node out of the a11y tree once the exit finished */
    window.setTimeout(function () {
      if (!el.classList.contains('is-on')) el.hidden = true;
    }, 420);

    if (restoreFocus !== false) {
      var back = lastFocus;
      lastFocus = null;
      if (back && back.focus) {
        try {
          back.focus({ preventScroll: true });
        } catch (err) {
          /* ignore */
        }
      }
    }
  }

  /* section modal content is derived from the panels so they stay the source */
  var modalMeta = {
    'panel-features': { eyebrow: 'Возможности', title: 'Всё для игры — в одном окне' },
    'panel-editor': { eyebrow: 'Редактор скинов', title: 'Редактор скина без лишнего' },
    'panel-download': { eyebrow: 'Установка', title: 'Как поставить лаунчер' }
  };

  var installSteps = [
    'Скачай ExeytaSetup.exe — установщик берётся с последнего релиза GitHub.',
    'Запусти установщик и дождись конца распаковки — шкала доходит ровно до 100%.',
    'Открой Exeyta Launcher, укажи папку с игрой и объём оперативной памяти.',
    'Выбери версию и нажми «Играть» — дальше лаунчер всё сделает сам.'
  ];

  var panelModal = document.getElementById('panel-modal');
  var panelModalTitle = document.getElementById('panel-modal-title');
  var panelModalBody = document.getElementById('panel-modal-body');

  function buildPanelModal(id) {
    if (!panelModal || !panelModalBody) return;
    var meta = modalMeta[id] || { eyebrow: 'Раздел', title: 'Раздел' };
    var eyebrow = panelModal.querySelector('.modal-eyebrow');

    if (panelModalTitle) {
      panelModalTitle.textContent = meta.title;
      /* restart the animated gradient after the title changed */
      panelModalTitle.classList.remove('grad');
      window.requestAnimationFrame(function () {
        panelModalTitle.classList.add('grad');
      });
    }
    if (eyebrow) eyebrow.textContent = meta.eyebrow;

    panelModalBody.textContent = '';

    if (id === 'panel-download') {
      var intro = document.createElement('p');
      intro.textContent = 'Четыре шага — и лаунчер готов к запуску.';
      panelModalBody.appendChild(intro);

      var list = document.createElement('ul');
      installSteps.forEach(function (text) {
        var li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
      });
      panelModalBody.appendChild(list);
      return;
    }

    var source = document.getElementById(id);
    var copy = source ? source.querySelector('.section-lead, .editor-copy > p') : null;
    var lead = document.createElement('p');
    lead.textContent = copy
      ? copy.textContent.trim()
      : 'Подробности — во вкладке «' + meta.eyebrow + '».';
    panelModalBody.appendChild(lead);

    var anchor = document.createElement('p');
    var link = document.createElement('a');
    link.href = '#' + id;
    link.setAttribute('data-tab-link', id);
    link.textContent = 'Открыть вкладку целиком';
    anchor.appendChild(link);
    panelModalBody.appendChild(anchor);
  }

  on(document, 'click', function (e) {
    var opener = e.target && e.target.closest && e.target.closest('[data-modal-open]');
    if (!opener) return;
    e.preventDefault();
    var id = opener.getAttribute('data-modal-open');
    if (modalMeta[id] || id === 'panel-modal') {
      buildPanelModal(id);
      openModalById(panelModal);
    } else {
      openModalById(document.getElementById(id));
    }
  });

  on(document, 'click', function (e) {
    var closer = e.target && e.target.closest && e.target.closest('[data-modal-close]');
    if (closer) {
      var scope = closer.closest('.modal');
      if (scope) {
        e.preventDefault();
        closeModalShell(scope, true);
      }
      return;
    }

    /* a click on the backdrop itself closes the dialog */
    if (!openModal) return;
    var card = openModal.querySelector('.modal-card');
    if (card && card.contains(e.target)) return;
    if (openModal.contains(e.target)) closeModalShell(openModal, true);
  });

  on(document, 'keydown', function (e) {
    if (!openModal) return;

    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      closeModalShell(openModal, true);
      return;
    }

    if (e.key !== 'Tab') return;

    /* focus stays inside the dialog while it is open */
    var items = focusables(openModal);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  (function easterEgg() {
    var brandMark = document.querySelector('.brand-mark');
    var easter = document.getElementById('easter');
    if (!brandMark || !easter) return;

    var noteLink = easter.querySelector('.easter-note a');
    var hits = 0;
    var timer = 0;

    brandMark.addEventListener('click', function (e) {
      hits += 1;
      window.clearTimeout(timer);
      if (hits >= 5) {
        e.preventDefault();
        hits = 0;
        body.classList.add('egg-open');
        openModalById(easter);
        return;
      }
      timer = window.setTimeout(function () {
        hits = 0;
      }, 2600);
    });

    if (noteLink) noteLink.addEventListener('click', function (e) {
      e.stopPropagation();
    });
  })();

  /* ======================================================================
     Background particles (≤60, paused when the tab is hidden)
     ====================================================================== */
  (function particles() {
    var canvas = document.getElementById('particles');
    if (!canvas) return;
    if (reduced) {
      canvas.style.display = 'none';
      return;
    }
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;

    var W = 0;
    var H = 0;
    var dots = [];
    var raf = 0;
    var running = false;
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var colors = ['255,138,61', '255,77,109', '166,120,255', '77,225,255', '255,210,168'];

    function seed() {
      var max = lite ? 26 : 60;
      var n = Math.max(14, Math.min(max, Math.round(W / 26)));
      dots.length = 0;
      for (var i = 0; i < n; i++) {
        dots.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: 0.5 + Math.random() * 1.5,
          vx: (Math.random() - 0.5) * 0.16,
          vy: -0.04 - Math.random() * 0.16,
          c: colors[(Math.random() * colors.length) | 0],
          a: 0.16 + Math.random() * 0.4,
          ph: Math.random() * Math.PI * 2,
          sp: 0.5 + Math.random() * 1.1
        });
      }
    }

    function resize() {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      if (!W || !H) return;
      canvas.width = Math.round(W * ratio);
      canvas.height = Math.round(H * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      seed();
    }

    function frame(t) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        d.x += d.vx;
        d.y += d.vy;
        if (d.y < -8) {
          d.y = H + 8;
          d.x = Math.random() * W;
        }
        if (d.x < -8) d.x = W + 8;
        else if (d.x > W + 8) d.x = -8;

        var tw = d.a * (0.55 + 0.45 * Math.sin(t * 0.001 * d.sp + d.ph));
        ctx.globalAlpha = tw;
        ctx.fillStyle = 'rgba(' + d.c + ',1)';
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, 6.2831853);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function start() {
      if (running || reduced) return;
      running = true;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    var resizeTimer = 0;
    on(window, 'resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 180);
    }, { passive: true });

    on(document, 'visibilitychange', function () {
      if (document.hidden) stop();
      else start();
    });

    resize();
    start();
  })();

  /* pointer events with touch only: no magnetic / glow ------------------- */
  if (!fine) resetMagnetics();
})();