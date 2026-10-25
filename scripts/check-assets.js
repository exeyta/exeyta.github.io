/* Live checks that every asset, id and hook script.js / index.html depend on
   actually exists, plus CSS brace balance.
   Usage: node scripts/check-assets.js   (run from the repo root) */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));

const css = read('style.css');
const js = read('script.js');
const html = read('index.html');

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log('FAIL ' + msg);
};

/* --- CSS: strip comments and strings, then count braces and parens --- */
const cssStripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"\n]*"|'[^'\n]*'/g, '');
const openBraces = (cssStripped.match(/\{/g) || []).length;
const closeBraces = (cssStripped.match(/\}/g) || []).length;
console.log(`css braces open=${openBraces} close=${closeBraces}`);
if (openBraces !== closeBraces) fail('unbalanced CSS braces');

const openParens = (cssStripped.match(/\(/g) || []).length;
const closeParens = (cssStripped.match(/\)/g) || []).length;
console.log(`css parens open=${openParens} close=${closeParens}`);
if (openParens !== closeParens) fail('unbalanced CSS parentheses');

/* --- files referenced by index.html must exist on disk --- */
const refs = [...html.matchAll(/(?:href|src)="(?!#|https?:|mailto:|tel:)([^"?]+)"/g)].map((m) => m[1]);
for (const ref of [...new Set(refs)]) {
  if (!exists(ref)) fail(`index.html references missing file: ${ref}`);
}
console.log(`local asset references checked: ${[...new Set(refs)].length}`);

/* --- CSS classes the markup actually uses must be styled --- */
const requiredCss = [
  '.header', '.header-inner', '.brand', '.tabs-rail', '.tab', '.tab-ink',
  '.panel', '.panel.is-active', '.section', '.hero', '.hero-title', '.hero-mock',
  '.btn', '.btn-primary', '.btn-ghost', '.card', '.modal', '.modal-card',
  '.modal-bg', '.modal-body', '.modal-actions', '.easter', '.easter-card',
  '.footer', '.visually-hidden', '.mobile-panel', '.editor-pane'
];
for (const sel of requiredCss) {
  if (!css.includes(sel)) fail(`style.css is missing ${sel}`);
}

/* --- every id referenced by script.js must exist in index.html --- */
const ids = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
for (const id of [...new Set(ids)]) {
  if (!new RegExp(`id="${id}"`).test(html)) fail(`script.js wants #${id}, not found in index.html`);
}
console.log(`script.js id references checked: ${[...new Set(ids)].length}`);

/* --- markup hooks script.js queries must be present --- */
const hooks = [
  ['class="tab', /class="tab/],
  ['class="panel', /class="panel/],
  ['data-tab-link', /data-tab-link=/],
  ['data-modal-open', /data-modal-open=/],
  ['data-modal-close', /data-modal-close/],
  ['class="tab-ink', /class="tab-ink"/]
];
for (const [name, re] of hooks) {
  if (!re.test(html)) fail(`index.html is missing hook ${name}`);
}

/* --- SEO surface must not regress --- */
const mustKeep = [
  'https://github.com/exeyta/exeyta-launcher/releases/latest/download/ExeytaSetup.exe',
  'https://t.me/exeyta',
  'https://github.com/exeyta/exeyta-launcher',
  'https://t.me/ouroptions',
  'assets/launcher-ui.svg',
  'assets/favicon.svg',
  'rel="canonical" href="https://exeyta.github.io/"',
  'name="google-site-verification"',
  'application/ld+json',
  'property="og:title"'
];
for (const needle of mustKeep) {
  if (!html.includes(needle)) fail(`index.html lost: ${needle}`);
}

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
process.exit(failed ? 1 : 0);

