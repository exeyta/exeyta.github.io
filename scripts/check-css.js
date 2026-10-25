/* CSS sanity check: verifies brace balance and detects rules left unclosed
   (which silently kill every following rule in the file until the parser
   re-synchronises, producing a blank or half-styled page).
   Usage: node scripts/check-css.js   (run from the repo root) */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const lineStarts = [0];
for (let i = 0; i < css.length; i++) {
  if (css[i] === '\n') lineStarts.push(i + 1);
}
const lineOf = (offset) => {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

// Strip comments and string literals so braces inside them are ignored.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const problems = [];
const stack = []; // { selectorStart, selectorText, hasDeclaration, selectorOffset }

let atRuleDepth = 0;
let selectorStart = 0;

for (let i = 0; i < stripped.length; i++) {
  const ch = stripped[i];

  if (ch === '{') {
    // Everything from selectorStart to i is the prelude.
    let prelude = stripped.slice(selectorStart, i).trim();
    const isAtRule = prelude.startsWith('@');

    if (prelude === '') {
      problems.push(`line ${lineOf(i)}: opening brace with no selector (previous rule was left unclosed)`);
    } else if (isAtRule && /counters|media|supports|container|layer/.test(prelude) === false && /^@(keyframes|font-face|property|counter-style)/.test(prelude)) {
      // keyframes/font-face: the block holds nested rule blocks or declarations
      atRuleDepth++;
    }

    stack.push({
      prelude,
      offset: selectorStart,
      hasDeclaration: false,
      isAtRule,
      hasNestedBlock: false
    });
    selectorStart = i + 1;
    continue;
  }

  if (ch === '}') {
    const frame = stack.pop();
    if (!frame) {
      problems.push(`line ${lineOf(i)}: extra closing brace`);
      selectorStart = i + 1;
      continue;
    }
    // A block that contains neither declarations nor nested blocks is dead.
    if (!frame.hasDeclaration && !frame.hasNestedBlock) {
      problems.push(`line ${lineOf(frame.offset)}: rule "${frame.prelude.split('\n')[0].slice(0, 60)}" is empty`);
    }
    if (stack.length) stack[stack.length - 1].hasNestedBlock = true;
    selectorStart = i + 1;
    continue;
  }

  if (ch === ';' || ch === ':') {
    // ':' at top level of a declaration block means a property is present.
    if (stack.length) stack[stack.length - 1].hasDeclaration = true;
    continue;
  }

  if (ch === '\n' && !stack.length) {
    // Purely cosmetic at top level.
  }
}

for (const frame of stack) {
  problems.push(
    `line ${lineOf(frame.offset)}: unclosed rule "${frame.prelude.split('\n')[0].slice(0, 60)}"`
  );
}

if (problems.length === 0) {
  console.log(`OK   style.css: braces balanced, no empty or unclosed rules`);
  process.exit(0);
}

console.log(`FAIL ${problems.length} problem(s) in style.css:`);
for (const p of problems) console.log('  - ' + p);
process.exit(1);

