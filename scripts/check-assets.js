/* Brace/paren balance + selector sanity for style.css and a live check that
   every id/selector script.js depends on exists in index.html.
   Usage: node scripts/check-assets.js   (run from the repo root) */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const css = read('style.css');
const js = read('script.js');
const html = read('index.html');

let failed = false;
const fail = (msg) => {
  failed = true;
  console.log('FAIL ' + msg);
};

/* --- CSS: strip comments and strings, then count braces --- */
const cssStripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"[^"\n]*"|'[^'\n]*'/g, '');
const openBraces = (cssStripped.match(/\{/g) || []).length;
const closeBraces = (cssStripped.match(/\}/g) || []).length;
console.log(`css braces open=${openBraces} close=${closeBraces}`);
if (openBraces !== closeBraces) fail('unbalanced CSS braces');

const openParens = (cssStripped.match(/\(/g) || []).length;
const closeParens = (cssStripped.match(/\)/g) || []).length;
console.log(`css parens open=${openParens} close=${closeParens}`);
if (openParens !== closeParens) fail('unbalanced CSS parentheses');

/* --- CSS: the classes the new feature needs must be defined --- */
const requiredCss = [
  '.tabs', '.tab-rail', '.tab-ink', '.tab ', '.panel', '.panel.is-active',
  '.is-leaving', '.link-chip', '.hero-more', '.modal ', '.modal.is-on',
  '.modal-card', '.modal-close', '.modal-bg', '.modal-mesh', '.modal-body',
  '.modal-actions', '.visually-hidden', 'body.modal-open'
];
for (const sel of requiredCss) {
  if (!css.includes(sel)) fail(`style.css is missing ${sel.trim()}`);
}

/* --- JSON blocks inside script.js must parse --- */
const literalNames = ['modalMeta'];
for (const name of literalNames) {
  const re = new RegExp('var ' + name + ' = (\\{[\\s\\S]*?\\n  \\});');
  const m = js.match(re);
  if (!m) {
    fail(`script.js is missing the ${name} literal`);
    continue;
  }
  try {
    const value = new Function('return (' + m[1] + ')')();
    console.log(`OK   script.js ${name} parses (${Object.keys(value).length} keys)`);
  } catch (err) {
    fail(`script.js ${name} does not parse: ${err.message}`);
  }
}

/* array literals: installSteps etc. */
const arrayNames = ['installSteps'];
for (const name of arrayNames) {
  const re = new RegExp('var ' + name + ' = (\\[[\\s\\S]*?\\n  \\]);');
  const m = js.match(re);
  if (!m) {
    fail(`script.js is missing the ${name} literal`);
    continue;
  }
  try {
    const value = new Function('return (' + m[1] + ')')();
    console.log(`OK   script.js ${name} parses (${value.length} items)`);
  } catch (err) {
    fail(`script.js ${name} does not parse: ${err.message}`);
  }
}

/* --- every getElementById / data hook used by script.js must exist in HTML --- */
const ids = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
for (const id of [...new Set(ids)]) {
  if (!new RegExp(`id="${id}"`).test(html)) fail(`script.js wants #${id}, not found in index.html`);
}

const hooks = [
  ['data-tabs', /data-tabs/],
  ['role="tab"', /role="tab"/],
  ['role="tabpanel"', /role="tabpanel"/],
  ['data-tab-link', /data-tab-link/],
  ['data-modal-open', /data-modal-open/],
  ['data-modal-close', /data-modal-close/],
  ['.modal-card', /class="modal-card/],
  ['.tab-ink', /class="tab-ink"/]
];
for (const [name, re] of hooks) {
  if (!re.test(html)) fail(`index.html is missing hook ${name}`);
}

/* --- all .reveal / [data-hero] stagger indices must be numeric --- */
const stagger = [...html.matchAll(/--i:([^";]+)/g)].map((m) => m[1].trim());
const badStagger = stagger.filter((v) => !/^\d+$/.test(v));
if (badStagger.length) fail(`non-numeric stagger values: ${badStagger.join(', ')}`);
console.log(`stagger indices found: ${stagger.length}`);

/* --- links and anchors that must not have been renamed --- */
const mustKeep = [
  'https://github.com/exeyta/exeyta-launcher/releases/latest/download/ExeytaSetup.exe',
  'https://t.me/exeyta',
  'https://github.com/exeyta/exeyta-launcher',
  'https://t.me/ouroptions',
  'assets/launcher-ui.svg',
  'assets/favicon.svg',
  'id="features"',
  'id="editor"',
  'id="download"'
];
for (const needle of mustKeep) {
  if (!html.includes(needle)) fail(`index.html lost: ${needle}`);
}

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
process.exit(failed ? 1 : 0);
