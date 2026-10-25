/* Проверка структуры index.html: парность тегов, обязательные разделы, якоря. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = false;
const check = (name, ok, extra) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

// Без содержимого <script> и комментариев — иначе ложные срабатывания на символах внутри.
const markup = html
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');

const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

const stack = [];
const errors = [];
const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
let m;

while ((m = tagRe.exec(markup)) !== null) {
  const closing = m[1] === '/';
  const name = m[2].toLowerCase();
  const selfClosing = m[4] === '/';

  if (voids.has(name) || selfClosing) continue;

  if (!closing) {
    stack.push({ name, at: m.index });
  } else {
    const top = stack.pop();
    if (!top) {
      errors.push(`лишний </${name}> на позиции ${m.index}`);
    } else if (top.name !== name) {
      errors.push(`ожидался </${top.name}>, получен </${name}> на позиции ${m.index}`);
    }
  }
}

for (const left of stack) errors.push(`не закрыт <${left.name}>`);
check('теги парные', errors.length === 0, errors.slice(0, 5).join('; '));

// Обязательные секции и якоря
const requiredSections = ['features', 'screens', 'install', 'faq'];
for (const id of requiredSections) {
  check(`секция #${id} на месте`, new RegExp(`id="${id}"`).test(html));
}

// Каждая навигационная ссылка должна вести на существующий якорь
const navTargets = [...html.matchAll(/href="#([\w-]+)"/g)].map((x) => x[1]);
const missingAnchors = [...new Set(navTargets)].filter(
  (id) => id !== 'top' && !new RegExp(`id="${id}"`).test(html)
);
check('все якоря ссылок существуют', missingAnchors.length === 0, missingAnchors.join(', '));

// Один h1
const h1Count = (html.match(/<h1[\s>]/g) || []).length;
check('ровно один <h1>', h1Count === 1, `найдено ${h1Count}`);

// Эмодзи не должны попадать в интерфейс как иконки
const emoji = markup.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu) || [];
check('нет эмодзи в разметке', emoji.length === 0, emoji.slice(0, 5).join(' '));

// Ключи SEO на месте
const seoBits = [
  ['google-site-verification', /name="google-site-verification" content="[\w-]+"/],
  ['canonical', /rel="canonical" href="https:\/\/exeyta\.github\.io\/"/],
  ['og:title', /property="og:title"/],
  ['og:image', /property="og:image"/],
  ['twitter:card', /name="twitter:card"/],
  ['JSON-LD', /application\/ld\+json/],
  ['favicon', /rel="icon"/],
  ['viewport', /name="viewport"/],
  ['описание', /name="description" content="[^"]{50,}"/]
];
for (const [label, rx] of seoBits) {
  check(`SEO: ${label}`, rx.test(html));
}

// Пасхалка скрыта по умолчанию
check('пасхалка скрыта', /id="easter"[^>]*hidden/.test(html));

// Мобильное меню скрыто по умолчанию
check('меню скрыто', /id="nav-drawer"[^>]*hidden/.test(html));

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
process.exit(failed ? 1 : 0);
