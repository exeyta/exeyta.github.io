/* Проверка ассетов: баланс CSS, существование файлов, связки JS ↔ HTML. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(root, f));

const html = read('index.html');
const css = read('style.css');
const js = read('script.js');

let failed = false;
const check = (name, ok, extra) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

// --- CSS: баланс скобок и пустые правила ---
let depth = 0;
let bad = null;
for (let i = 0; i < css.length; i++) {
  if (css[i] === '{') depth++;
  else if (css[i] === '}') {
    depth--;
    if (depth < 0) { bad = i; break; }
  }
}
check('CSS: скобки сбалансированы', depth === 0 && bad === null,
  bad !== null ? `лишняя } на позиции ${bad}` : depth !== 0 ? `незакрытых блоков: ${depth}` : '');

const parens = (css.match(/\(/g) || []).length - (css.match(/\)/g) || []).length;
check('CSS: скобки в функциях сбалансированы', parens === 0, `разница ${parens}`);

// --- CSS: каждый класс из HTML должен иметь правило или быть служебным ---
const htmlClasses = new Set();
for (const m of html.matchAll(/class="([^"]+)"/g)) {
  m[1].trim().split(/\s+/).forEach((c) => c && htmlClasses.add(c));
}

const unstyled = [...htmlClasses].filter(
  (c) => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css)
);
check('все классы из HTML есть в CSS', unstyled.length === 0, unstyled.join(', '));

// --- CSS: каждый переменная темы используется и объявлена ---
const declared = new Set([...css.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
const used = new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]));
const undef = [...used].filter((v) => !declared.has(v));
check('CSS: нет ссылок на необъявленные переменные', undef.length === 0, undef.join(', '));

const unusedVars = [...declared].filter((v) => !used.has(v));
check('CSS: нет мёртвых переменных', unusedVars.length === 0, unusedVars.join(', '));

// --- Локальные файлы существуют ---
const localFiles = new Set();
for (const m of html.matchAll(/(?:src|href)="([^"#:][^"]*)"/g)) {
  const ref = m[1];
  if (/^(https?:|mailto:|\/\/)/.test(ref)) continue;
  localFiles.add(ref);
}
const missingFiles = [...localFiles].filter((f) => !exists(f));
check('все локальные файлы на месте', missingFiles.length === 0, missingFiles.join(', '));

// --- Связки JS ↔ HTML ---
const idsInHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const idsInJs = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
const missingIds = idsInJs.filter((id) => !idsInHtml.has(id));
check('все getElementById находят элемент', missingIds.length === 0, missingIds.join(', '));

const queried = [...js.matchAll(/querySelector(?:All)?\('([^']+)'\)/g)].map((m) => m[1]);
const orphanSelectors = queried.filter((sel) => {
  const cls = sel.match(/^\.([\w-]+)/);
  if (cls) return !new RegExp(`class="[^"]*\\b${cls[1]}\\b`).test(html);
  const attr = sel.match(/^\[([\w-]+)/);
  if (attr) {
    // атрибут может быть с якорем вроде [data-easter-close] или булевым [hidden]
    return !new RegExp(`\\b${attr[1]}(?:=|\\s|>)`).test(html);
  }
  return false;
});
check('селекторы в JS есть в HTML', orphanSelectors.length === 0, orphanSelectors.join(', '));

// --- Обязательные хуки стилей по смыслу ---
const hooks = [
  ['.hero', 'секция первого экрана'],
  ['.feature-grid', 'сетка возможностей'],
  ['.settings-card', 'превью настроек'],
  ['.steps', 'шаги установки'],
  ['.faq-list', 'список вопросов'],
  ['.site-footer', 'футер'],
  ['.easter', 'пасхалка'],
  ['.nav-toggle', 'кнопка меню']
];
for (const [sel, label] of hooks) {
  check(`CSS: ${sel} (${label})`, css.includes(sel + ' ') || css.includes(sel + '{') || css.includes(sel + ','));
}

// --- Ресурсы, на которые ссылаются соцсети, существуют ---
const ogImage = (html.match(/property="og:image" content="https:\/\/exeyta\.github\.io\/([^"]+)"/) || [])[1];
check('og:image указывает на существующий файл', Boolean(ogImage) && exists(ogImage), ogImage || 'нет');

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
process.exit(failed ? 1 : 0);
