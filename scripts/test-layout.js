/* Layout smoke test: verifies that switching tabs actually swaps the visible
   content and that nothing from the hidden panels leaks into the active one.
   Usage: node scripts/test-layout.js   (run from the repo root) */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

let failed = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('OK   ' + name);
  else {
    failed++;
    console.log('FAIL ' + name + (extra ? ' → ' + extra : ''));
  }
};

const dom = new JSDOM(html, { url: 'https://exeyta.github.io/' });
const { document } = dom.window;
const q = (s) => document.querySelector(s);
const qa = (s) => Array.from(document.querySelectorAll(s));

/* 1. every tab must point at a real panel and vice versa */
const tabIds = qa('[role="tab"]').map((b) => b.id);
const panelIds = qa('[role="tabpanel"]').map((p) => p.id);
check('4 tabs and 4 panels', tabIds.length === 4 && panelIds.length === 4);
qa('[role="tab"]').forEach((btn) => {
  const target = btn.getAttribute('aria-controls');
  check(btn.id + ' → #' + target + ' exists', !!document.getElementById(target));
  check(btn.id + ' has a visible label', btn.textContent.trim().length > 0);
});
qa('[role="tabpanel"]').forEach((panel) => {
  const owner = panel.getAttribute('aria-labelledby');
  check(panel.id + ' is labelled by an existing tab', !!document.getElementById(owner));
  check(panel.id + ' is keyboard reachable', panel.getAttribute('tabindex') === '0');
});

/* 2. only the home panel is open, and it is the first one */
check('exactly one panel is open on load', qa('.panel:not([hidden])').length === 1);
check('the open panel is Главная', q('.panel:not([hidden])').id === 'panel-home');
check('Главная is the first tab', tabIds[0] === 'tab-home');

/* 3. the original anchors still exist inside their panels */
check('#features lives in panel-features', q('#panel-features #features') !== null);
check('#editor lives in panel-editor', q('#panel-editor #editor') !== null);
check('#download lives in panel-download', q('#panel-download #download') !== null);

/* 4. every id in the document is unique */
const ids = qa('[id]').map((el) => el.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
check('all element ids are unique', dupes.length === 0, dupes.join(', '));

/* 5. modals start hidden and are real dialogs */
qa('.modal').forEach((m) => {
  check(m.id + ' starts hidden', m.hasAttribute('hidden'));
  check(m.id + ' is a modal dialog', m.getAttribute('role') === 'dialog' && m.getAttribute('aria-modal') === 'true');
  check(m.id + ' is labelled', !!document.getElementById(m.getAttribute('aria-labelledby')));
  check(m.id + ' has a close control', !!m.querySelector('[data-modal-close]'));
});

/* 6. the CSS drives panel visibility rather than markup only */
check('CSS hides [hidden] panels', /\.panel\[hidden\]\s*\{\s*display:\s*none/.test(css));
check('CSS animates the incoming panel', /@keyframes panelIn/.test(css));
check('CSS animates the outgoing panel', /@keyframes panelOut/.test(css));
check('CSS positions the tab indicator', /\.tab-ink[\s\S]{0,600}?translate3d\(var\(--tab-x/.test(css));
check('CSS has a scroll lock for modals', /body\.modal-open\s*\{\s*overflow:\s*hidden/.test(css));
check('reduced motion disables panel animations', /prefers-reduced-motion[\s\S]*?\.panel\.is-active/.test(css));

/* 7. SVG assets untouched */
check('launcher-ui.svg referenced exactly once', (html.match(/assets\/launcher-ui\.svg/g) || []).length === 1);
check('favicon unchanged', html.includes('assets/favicon.svg'));
check('inline skin-mock SVG kept', q('svg.skin-mock') !== null);
check('no raster images were introduced', qa('img').length === 1);

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
process.exit(failed ? 1 : 0);
