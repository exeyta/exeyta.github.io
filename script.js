(function () {
  'use strict';

  var tabs = document.querySelectorAll('.tab');
  var panels = document.querySelectorAll('.panel');
  var modal = document.getElementById('panel-modal');
  var modalTitle = document.getElementById('panel-modal-title');
  var modalBody = document.getElementById('panel-modal-body');
  var modalDl = document.getElementById('panel-modal-dl');
  var modalCloses = document.querySelectorAll('[data-modal-close]');
  var easterEl = document.getElementById('easter');
  var yearEl = document.getElementById('year');
  var mobileMenuBtn = document.getElementById('mobile-menu');
  var mobilePanel = document.getElementById('mobile-panel');
  var mobileItems = document.querySelectorAll('.mobile-item[data-tab-link]');

  function showPanel(el) {
    if (!el) return;
    panels.forEach(function (p) {
      p.classList.remove('is-active');
      p.hidden = true;
      p.setAttribute('tabindex', '-1');
    });
    el.classList.add('is-active');
    el.hidden = false;
    el.setAttribute('tabindex', '0');
    el.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function activateTab(tab) {
    if (!tab) return;
    tabs.forEach(function (t) {
      t.classList.remove('is-active');
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '-1');
    });
    tab.classList.add('is-active');
    tab.setAttribute('aria-selected', 'true');
    tab.setAttribute('tabindex', '0');
    updateInk(tab);
  }

  function updateInk(tab) {
    var ink = document.querySelector('.tab-ink');
    var rail = document.querySelector('.tabs-rail');
    if (!ink || !rail || !tab) return;
    var rect = tab.getBoundingClientRect();
    var railRect = rail.getBoundingClientRect();
    ink.style.width = rect.width + 'px';
    ink.style.transform = 'translateX(' + (rect.left - railRect.left) + 'px)';
  }

  function moveFocus(dir) {
    var active = document.querySelector('.tab.is-active');
    var index = Array.prototype.indexOf.call(tabs, active);
    var next = (index + dir + tabs.length) % tabs.length;
    tabs[next].focus();
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var panel = document.getElementById(this.getAttribute('aria-controls'));
      activateTab(this);
      showPanel(panel);
    });
    tab.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
      else if (e.key === 'Home') { e.preventDefault(); tabs[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); tabs[tabs.length - 1].focus(); }
    });
  });

  if (mobileMenuBtn && mobilePanel) {
    mobileMenuBtn.addEventListener('click', function () {
      var expanded = mobileMenuBtn.getAttribute('aria-expanded') === 'true';
      mobileMenuBtn.setAttribute('aria-expanded', String(!expanded));
      mobilePanel.hidden = expanded;
    });
  }

  mobileItems.forEach(function (item) {
    item.addEventListener('click', function () {
      var panel = document.getElementById(this.getAttribute('data-tab-link'));
      var tab = document.querySelector('.tab[aria-controls="' + this.getAttribute('data-tab-link') + '"]');
      if (mobilePanel) mobilePanel.hidden = true;
      if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');
      if (panel && tab) {
        activateTab(tab);
        showPanel(panel);
      }
    });
  });

  function closeModals() {
    if (modal) { modal.hidden = true; modal.setAttribute('aria-modal', 'false'); }
    if (easterEl) { easterEl.hidden = true; easterEl.setAttribute('aria-modal', 'false'); }
    document.body.style.overflow = '';
  }

  var modalTriggers = document.querySelectorAll('[data-modal-open]');
  modalTriggers.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = this.getAttribute('data-modal-open');
      var panel = document.getElementById(target);
      var tab = document.querySelector('.tab[aria-controls="' + target + '"]');
      if (!panel || !tab) return;
      modalTitle.textContent = panel.getAttribute('data-panel') || '';
      var lead = panel.querySelector('p, .section-lead');
      modalBody.textContent = lead ? lead.textContent : '';
      modalDl.href = 'https://github.com/exeyta/exeyta-launcher/releases/latest/download/ExeytaSetup.exe';
      modal.hidden = false;
      modal.setAttribute('aria-modal', 'true');
      document.body.style.overflow = 'hidden';
      var closeBtn = modal.querySelector('[data-modal-close]');
      if (closeBtn) closeBtn.focus();
    });
  });
  modalCloses.forEach(function (btn) {
    btn.addEventListener('click', closeModals);
  });

  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target === modal.querySelector('.modal-bg')) closeModals();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModals();
  });

  var konami = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  var kIndex = 0;
  var hits = 0;
  var timer = 0;

  function openEaster() {
    if (easterEl) {
      easterEl.hidden = false;
      easterEl.setAttribute('aria-modal', 'true');
      document.body.style.overflow = 'hidden';
      var closeBtn = easterEl.querySelector('.easter-close');
      if (closeBtn) closeBtn.focus();
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.which === konami[kIndex]) {
      kIndex++;
      if (kIndex === konami.length) { kIndex = 0; openEaster(); }
    } else {
      kIndex = 0;
    }
    if (e.which === 54 || e.which === 102) {
      hits++;
      if (hits === 1) timer = setTimeout(function () { hits = 0; }, 2600);
      if (hits === 2) { clearTimeout(timer); hits = 0; openEaster(); }
    } else if (e.which === 55 || e.which === 103) {
      if (hits === 1) { clearTimeout(timer); hits = 0; openEaster(); }
      else { hits = 0; }
    }
  });

  function revealOnScroll() {
    var reveals = document.querySelectorAll('.reveal:not(.is-in)');
    var windowHeight = window.innerHeight;
    var revealPoint = 150;
    reveals.forEach(function (el) {
      if (el.getBoundingClientRect().top < windowHeight - revealPoint) {
        el.classList.add('is-in');
      }
    });
  }

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.addEventListener('scroll', revealOnScroll, { passive: true });
  }
  revealOnScroll();

  window.addEventListener('load', function () {
    var activeTab = document.querySelector('.tab.is-active');
    if (activeTab) {
      updateInk(activeTab);
      var activePanel = document.getElementById(activeTab.getAttribute('aria-controls'));
      if (activePanel) showPanel(activePanel);
    }
  });
  window.addEventListener('resize', function () {
    var activeTab = document.querySelector('.tab.is-active');
    if (activeTab) updateInk(activeTab);
  });

  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  document.documentElement.classList.remove('no-js');
  document.documentElement.classList.add('js-ready');
  document.body.classList.remove('hide-js');
})();