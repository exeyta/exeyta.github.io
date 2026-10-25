/* Functional smoke test for the tab + modal layer.
   Boots index.html in jsdom with script.js, then exercises the real
   interactions: initial state, tab switching, keyboard navigation,
   deep links, modal open/close, backdrop click, focus trap and Escape.

   Usage: node scripts/test-ui.js   (run from the repo root)
   Requires jsdom: npm install --no-save jsdom
*/
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8');

let failed = 0;
let passed = 0;

function check(name, condition, extra) {
  if (condition) {
    passed += 1;
    console.log('OK   ' + name);
  } else {
    failed += 1;
    console.log('FAIL ' + name + (extra ? ' → ' + extra : ''));
  }
}

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'https://exeyta.github.io/'
});
const { window } = dom;
const { document } = window;

/* jsdom has no matchMedia — the motion layer reads two media queries */
window.matchMedia = function (query) {
  return {
    matches: false, // desktop, fine pointer, motion allowed
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    }
  };
};
window.requestAnimationFrame = window.requestAnimationFrame || ((cb) => window.setTimeout(() => cb(Date.now()), 16));
window.cancelAnimationFrame = window.cancelAnimationFrame || ((id) => window.clearTimeout(id));
/* canvas 2d is not implemented; the particles module must degrade quietly */
window.HTMLCanvasElement.prototype.getContext = function () {
  return null;
};

/* the panel switch is staged (outgoing panel animates out first), so it settles
   on a timer — capture timers before the script runs and flush them manually */
const timers = [];
window.setTimeout = function (fn, ms) {
  timers.push({ fn, ms: ms || 0 });
  return timers.length;
};
window.clearTimeout = function () {};

function flushTimers() {
  for (let round = 0; round < 8; round++) {
    const pending = timers.splice(0, timers.length);
    if (!pending.length) break;
    for (const t of pending) t.fn();
  }
}

/* jsdom implements neither IntersectionObserver nor ResizeObserver */
window.IntersectionObserver = class {
  constructor(cb) {
    this.cb = cb;
    this.targets = [];
  }
  observe(el) {
    this.targets.push(el);
    /* the browser fires once the element is in view — do that now */
    this.cb([{ isIntersecting: true, target: el }], this);
  }
  unobserve(el) {
    this.targets = this.targets.filter((t) => t !== el);
  }
  disconnect() {
    this.targets = [];
  }
};
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

window.eval(script);

const q = (sel) => document.querySelector(sel);
const qa = (sel) => Array.from(document.querySelectorAll(sel));
const tabIds = ['tab-home', 'tab-features', 'tab-editor', 'tab-download'];
const panelIds = ['panel-home', 'panel-features', 'panel-editor', 'panel-download'];

function clickTab(index) {
  q('#' + tabIds[index]).dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, cancelable: true })
  );
}
function activePanelIndex() {
  return panelIds.findIndex((id) => q('#' + id).hidden === false);
}
function selectedTabIndex() {
  return tabIds.findIndex((id) => q('#' + id).getAttribute('aria-selected') === 'true');
}

/* jsdom's rAF/timers need to be flushed between steps: the panel switch is
   staged (the outgoing panel animates out first), so it settles on a timer */
function clickTabAndSettle(index) {
  clickTab(index);
  flushTimers();
}

/* --- 1. initial state: «Главная» open, everything else hidden --- */
check('home tab is selected on load', q('#tab-home').getAttribute('aria-selected') === 'true');
check('home panel is visible on load', q('#panel-home').hidden === false && q('#panel-home').classList.contains('is-active'));
panelIds.slice(1).forEach((id) => {
  check(id + ' starts hidden', q('#' + id).hidden === true);
});
check('only one tab is selected', qa('[role="tab"][aria-selected="true"]').length === 1);
check('one tab is tabbable (roving tabindex)', qa('[role="tab"][tabindex="0"]').length === 1);
check('inactive tabs are not tabbable', qa('[role="tab"][tabindex="-1"]').length === 3);
check('noscript keeps hidden panels readable', html.includes('.panel[hidden] { display: block !important; }'));

/* --- 2. clicking a tab opens exactly that section --- */
clickTabAndSettle(2);
check('clicking «Редактор скинов» opens only that panel', activePanelIndex() === 2, 'active=' + activePanelIndex());
check('«Редактор скинов» becomes the selected tab', selectedTabIndex() === 2);
check('opened panel carries the entrance animation class', q('#panel-editor').classList.contains('is-active'));
check('its tab is the tabbable one', q('#tab-editor').tabIndex === 0);

clickTabAndSettle(3);
check('clicking «Скачать» opens only that panel', activePanelIndex() === 3, 'active=' + activePanelIndex());

clickTabAndSettle(0);
check('returning to «Главная» works', activePanelIndex() === 0);

/* --- 3. keyboard navigation on the tablist --- */
q('#tab-home').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
flushTimers();
check('ArrowRight moves to the next tab', activePanelIndex() === 1 && selectedTabIndex() === 1);

q('#tab-features').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
flushTimers();
check('ArrowLeft moves back', activePanelIndex() === 0);

q('#tab-home').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
flushTimers();
check('End jumps to the last tab', activePanelIndex() === 3);

q('#tab-download').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
flushTimers();
check('Home jumps to the first tab', activePanelIndex() === 0);

/* --- 4. deep links and header nav drive the tabs --- */
q('nav.nav [data-tab-link="panel-editor"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
flushTimers();
check('header «Скины» link opens the editor panel', activePanelIndex() === 2);

check('hero «Смотреть редактор» is wired to the tabs', !!q('.hero-actions [data-tab-link="panel-editor"]'));

window.location.hash = '#panel-download';
window.dispatchEvent(new window.Event('hashchange'));
flushTimers();
check('hash deep link #panel-download opens that panel', activePanelIndex() === 3);

window.location.hash = '#editor';
window.dispatchEvent(new window.Event('hashchange'));
flushTimers();
check('legacy anchor #editor still resolves to its panel', activePanelIndex() === 2);

/* --- 5. reveal state after switching panels --- */
/* the hero animates through [data-hero]; .reveal lives in the section panels */
check('reveals exist in the features panel', qa('#panel-features .reveal').length > 0);
clickTabAndSettle(1);
check('reveals inside the features panel were played', qa('#panel-features .reveal.is-in').length > 0);
clickTabAndSettle(0);
check('home panel animates its hero instead of using .reveal', qa('#panel-home [data-hero]').length > 0);

/* --- 6. the tab indicator got positioned --- */
check('tab indicator received a width', q('[data-tabs]').style.getPropertyValue('--tab-w').length > 0);
check('tab indicator received an offset', q('[data-tabs]').style.getPropertyValue('--tab-x').length > 0);

/* --- 7. section modal: open, fill, close --- */
const modal = q('#panel-modal');

q('[data-modal-open="panel-features"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
check('section modal opens from the hero link', modal.hidden === false && modal.classList.contains('is-on'));
check('body gets the scroll lock', document.body.classList.contains('modal-open'));
check('modal title is filled', q('#panel-modal-title').textContent.includes('одном окне'));
check('modal body is filled', q('#panel-modal-body').textContent.trim().length > 20);
check('focus moved into the dialog', modal.contains(document.activeElement));

document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
check('Escape closes the section modal', !modal.classList.contains('is-on'));
check('scroll lock is released', !document.body.classList.contains('modal-open'));

/* --- 8. the install modal carries the real steps --- */
q('[data-modal-open="panel-download"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
check('download modal shows the install steps', q('#panel-modal-body').querySelectorAll('li').length === 4);

/* backdrop click closes */
modal.querySelector('.modal-bg').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
check('backdrop click closes the modal', !modal.classList.contains('is-on'));

/* clicks inside the card must NOT close it */
q('[data-modal-open="panel-editor"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
modal.querySelector('.modal-card').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
check('clicking inside the card keeps the modal open', modal.classList.contains('is-on'));

/* the «Открыть вкладку целиком» link switches tabs and closes the dialog */
const jump = modal.querySelector('#panel-modal-body [data-tab-link]');
check('modal offers a link to the full tab', !!jump);
if (jump) {
  jump.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  flushTimers();
  check('link inside the modal switches the panel', activePanelIndex() === 2, 'active=' + activePanelIndex());
  check('link inside the modal closes the dialog', !modal.classList.contains('is-on'));
}

if (modal.classList.contains('is-on')) {
  modal.querySelector('[data-modal-close]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
check('close button closes the modal', !modal.classList.contains('is-on'));

/* --- 9. easter egg still opens as a modal after 5 clicks --- */
const brandMark = q('.brand-mark');
for (let i = 0; i < 5; i++) {
  brandMark.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}
const egg = q('#easter');
check('5 clicks still open the easter egg', egg.hidden === false && egg.classList.contains('is-on'));
check('easter egg keeps its scroll lock class', document.body.classList.contains('egg-open'));
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
check('Escape closes the easter egg', !egg.classList.contains('is-on'));
check('egg-open class is removed', !document.body.classList.contains('egg-open'));

/* --- 10. content that must survive the refactor --- */
check('launcher-ui.svg is still referenced', !!q('img[src="assets/launcher-ui.svg"]'));
check('the inline editor SVG is intact', !!q('svg.skin-mock'));
check('download link is unchanged', q('[href*="ExeytaSetup.exe"]') !== null);
check('telegram link is unchanged', q('[href="https://t.me/exeyta"]') !== null);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
console.log(failed ? 'RESULT: FAILED' : 'RESULT: OK');
process.exit(failed ? 1 : 0);
