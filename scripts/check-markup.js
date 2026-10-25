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

const tabs = count(/class="tab(?:[ "]|$)/g);
const panels = count(/role="tabpanel"/g) || count(/class="panel(?:[ "]|$)/g);
const panelDivs = count(/class="panel(?:[ "]|$)/g);
console.log(`tabs=${tabs} tabpanels=${panels} panels=${panelDivs}`);
if (tabs !== panelDivs) {
  failed = true;
  console.log('FAIL tab/panel counts must match');
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
const openPanels = count(/class="panel[^"]*\bis-active\b[^"]*"/g);
const hiddenPanels = count(/class="panel[^"]*\bhidden\b[^"]*"/g);
console.log(`panels open on load=${openPanels} hidden on load=${hiddenPanels}`);
if (openPanels !== 1 || hiddenPanels !== panels - 1) {
  failed = true;
  console.log('FAIL exactly one panel must be open and the rest hidden on load');
}

// modal shells must be inert on load (class "hidden" present on the shell itself)
for (const id of ['easter', 'panel-modal']) {
  const tag = (html.match(new RegExp(`<div[^>]*\\bid="${id}"[^>]*>`)) || [''])[0];
  if (!tag) {
    failed = true;
    console.log(`FAIL modal #${id} not found`);
    continue;
  }
  const classAttr = (tag.match(/class="([^"]*)"/) || [, ''])[1];
  if (!/\bhidden\b/.test(classAttr)) {
    failed = true;
    console.log(`FAIL modal #${id} is missing the class "hidden" on load`);
  }
  if (!/\shidden[ >]/.test(tag + ' ')) {
    failed = true;
    console.log(`FAIL modal #${id} is missing the boolean hidden attribute`);
  }
  console.log(`OK   modal #${id} starts hidden`);
}

// the body must never start out hidden: JS is an enhancement, not a gate
const bodyTag = (html.match(/<body[^>]*>/) || [''])[0];
if (/\bhide-js\b/.test(bodyTag)) {
  failed = true;
  console.log('FAIL <body> still carries hide-js — the page would be blank without JS');
}

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
process.exit(failed ? 1 : 0);
