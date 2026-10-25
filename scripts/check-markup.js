/* Quick structural sanity check for the landing page.
   Usage: node scripts/check-markup.js   (run from the repo root) */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const count = (re) => (html.match(re) || []).length;
const pairs = [
  ['div', /<div\b/g, /<\/div>/g],
  ['section', /<section\b/g, /<\/section>/g],
  ['article', /<article\b/g, /<\/article>/g],
  ['svg', /<svg\b/g, /<\/svg>/g],
  ['button', /<button\b/g, /<\/button>/g],
  ['ul', /<ul\b/g, /<\/ul>/g],
  ['p', /<p\b/g, /<\/p>/g]
];

let failed = false;

for (const [name, open, close] of pairs) {
  const a = count(open);
  const b = count(close);
  const ok = a === b;
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} <${name}> open=${a} close=${b}`);
}

const tabs = count(/role="tab"/g);
const panels = count(/role="tabpanel"/g);
const panelDivs = count(/class="panel(?:\s|")/g);
console.log(`tabs=${tabs} tabpanels=${panels} panels=${panelDivs}`);
if (tabs !== panels || tabs !== panelDivs) {
  failed = true;
  console.log('FAIL tab/tabpanel/panel counts must match');
}

// every aria-controls must resolve to an existing id, and vice versa
const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
for (const id of controls) {
  const found = new RegExp(`id="${id}"`).test(html);
  if (!found) {
    failed = true;
    console.log(`FAIL aria-controls="${id}" has no matching id`);
  }
}

const labelledBy = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
for (const id of labelledBy) {
  const found = new RegExp(`id="${id}"`).test(html);
  if (!found) {
    failed = true;
    console.log(`FAIL aria-labelledby="${id}" has no matching id`);
  }
}

// exactly one panel must ship as open (Главная), the rest start hidden
const openPanels = count(/class="panel is-active"/g);
const hiddenPanels = count(/class="panel"[^>]*hidden/g);
console.log(`panels open on load=${openPanels} hidden on load=${hiddenPanels}`);
if (openPanels !== 1 || hiddenPanels !== panels - 1) {
  failed = true;
  console.log('FAIL exactly one panel must be open and the rest hidden on load');
}

// the animated-gradient helper must be re-applied to the modal title
if (!/class="grad" id="panel-modal-title"/.test(html)) {
  failed = true;
  console.log('FAIL modal title is missing the .grad class');
}

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
process.exit(failed ? 1 : 0);
