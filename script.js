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
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  function settle(el) {
    var i = parseInt(el.style.getPropertyValue('--i'), 10) || 0;
    window.setTimeout(function () {
      el.classList.add('is-settled');
    }, 780 + i * 80);
  }

  if (!('IntersectionObserver' in window) || reduced) {
    reveals.forEach(function (el) {
      el.classList.add('is-in', 'is-settled');
    });
  } else {
    var ioFired = false;
    var io = new IntersectionObserver(
      function (entries) {
        ioFired = true;
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          io.unobserve(el);
          el.classList.add('is-in');
          settle(el);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
    /* safety net: if IntersectionObserver never delivers anything (broken env),
       content must never stay hidden */
    window.setTimeout(function () {
      if (ioFired) return;
      reveals.forEach(function (el) {
        el.classList.add('is-in', 'is-settled');
      });
    }, 3000);
  }

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
     Easter egg: 5 clicks on the site icon → full-screen «67»
     ====================================================================== */
  (function easterEgg() {
    var brandMark = document.querySelector('.brand-mark');
    var easter = document.getElementById('easter');
    if (!brandMark || !easter) return;

    var closeBtn = easter.querySelector('.easter-close');
    var noteLink = easter.querySelector('.easter-note a');
    var hits = 0;
    var timer = 0;

    function openEgg() {
      hits = 0;
      window.clearTimeout(timer);
      easter.classList.add('is-on');
      body.classList.add('egg-open');
      if (closeBtn) {
        try {
          closeBtn.focus({ preventScroll: true });
        } catch (err) {
          closeBtn.focus();
        }
      }
    }

    function closeEgg() {
      if (!easter.classList.contains('is-on')) return;
      easter.classList.remove('is-on');
      body.classList.remove('egg-open');
      var home = brandMark.closest('a');
      if (home) {
        try {
          home.focus({ preventScroll: true });
        } catch (err) {
          /* ignore */
        }
      }
    }

    brandMark.addEventListener('click', function (e) {
      hits += 1;
      window.clearTimeout(timer);
      if (hits >= 5) {
        e.preventDefault();
        openEgg();
        return;
      }
      timer = window.setTimeout(function () {
        hits = 0;
      }, 2600);
    });

    if (closeBtn) closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeEgg();
    });

    easter.addEventListener('click', function (e) {
      if (noteLink && e.target && e.target.closest && e.target.closest('a')) return;
      closeEgg();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') closeEgg();
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