/* Headless render check: loads index.html in Chrome over the DevTools Protocol
   and asserts the page actually paints visible content. Guards against the
   "blank page" class of bugs caused by unclosed CSS rules or a JS-gated body.
   No third-party dependencies — uses Node's built-in fetch and WebSocket.
   Usage: node scripts/test-render.js   (run from the repo root) */
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8'
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function findChrome() {
  const candidates = [
    path.join(process.env['PROGRAMFILES'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  throw new Error('Chrome or Edge not found');
}

async function waitForDevtools(port, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('DevTools endpoint never came up');
}

let failed = false;
const check = (name, ok, extra) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};


async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const pageTarget = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  const pending = new Map();
  const events = [];
  let msgId = 0;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  const evaluate = async (body) => {
    const res = await send('Runtime.evaluate', {
      expression: `(() => { ${body} })()`,
      returnByValue: true,
      awaitPromise: true
    });
    const ex = res.exceptionDetails;
    if (ex) throw new Error((ex.exception && ex.exception.description) || ex.text || 'evaluate failed');
    return res.result.value;
  };

  return { ws, send, evaluate, events };
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const port = 9333;
  const userDataDir = path.join(os.tmpdir(), 'exeyta-render-' + Date.now());

  const chrome = spawn(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { chrome.kill(); } catch (_) { /* ignore */ }
    try { server.close(); } catch (_) { /* ignore */ }
  };

  try {
    await waitForDevtools(port);
    const { ws, send, evaluate, events } = await connect(port);

    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
    });

    await send('Page.navigate', { url: base });

    for (let i = 0; i < 120; i++) {
      const ready = await evaluate('return document.readyState;');
      if (ready === 'complete') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 500));

    const consoleErrors = events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => (e.params.args || []).map((a) => a.value || a.description || '').join(' '));
    const badResponses = events
      .filter((e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400)
      .map((e) => `${e.params.response.status} ${e.params.response.url}`);

    check('no failed network requests', badResponses.length === 0, badResponses.join(', '));
    check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

    // The hero heading must be painted with a real box.
    const hero = await evaluate(`
      const el = document.querySelector('.hero-title');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { w: Math.round(r.width), h: Math.round(r.height),
               visibility: s.visibility, display: s.display, opacity: s.opacity };
    `);
    check('hero title exists', Boolean(hero));
    if (hero) {
      check('hero title has non-zero box', hero.w > 0 && hero.h > 0, `${hero.w}x${hero.h}`);
      check('hero title is visible',
        hero.visibility === 'visible' && hero.display !== 'none' && hero.opacity !== '0');
    }

    // Exactly one panel visible; the rest must be display:none.
    const panels = await evaluate(`
      return [...document.querySelectorAll('.panel')].map((p) => {
        const s = getComputedStyle(p);
        return { id: p.id, shown: s.display !== 'none' && s.visibility !== 'hidden' };
      });
    `);
    const shown = panels.filter((p) => p.shown);
    check('exactly one panel is visible on load', shown.length === 1,
      `visible=${shown.map((p) => p.id).join(',')} of ${panels.length}`);
    check('the visible panel is panel-home', shown.length === 1 && shown[0].id === 'panel-home');

    // Header must sit above the content and keep its items on one row.
    const layout = await evaluate(`
      const header = document.querySelector('.header').getBoundingClientRect();
      const title = document.querySelector('.hero-title').getBoundingClientRect();
      const brand = document.querySelector('.brand').getBoundingClientRect();
      const tabs = document.querySelector('.tabs-rail').getBoundingClientRect();
      const cta = document.querySelector('.header-actions .btn').getBoundingClientRect();
      return {
        headerHeight: Math.round(header.height),
        heroTop: Math.round(title.top),
        sameRow: Math.abs(brand.top - tabs.top) < 12 && Math.abs(brand.top - cta.top) < 12
      };
    `);
    check('header is 80px tall', layout.headerHeight === 80, `${layout.headerHeight}px`);
    check('brand, tabs and CTA sit on one row', layout.sameRow);
    check('hero sits below the header', layout.heroTop > 80, `heroTop=${layout.heroTop}`);

    // Modals must be inert on load.
    const modals = await evaluate(`
      return ['easter', 'panel-modal'].map((id) => {
        const el = document.getElementById(id);
        return { id, display: el ? getComputedStyle(el).display : 'missing' };
      });
    `);
    for (const m of modals) check(`modal #${m.id} is hidden`, m.display === 'none', m.display);

    // Switching tabs must swap panels.
    const tabSwitch = await evaluate(`
      const tab = [...document.querySelectorAll('.tab')]
        .find((t) => t.getAttribute('aria-controls') === 'panel-download');
      tab.click();
      return {
        downloadShown: getComputedStyle(document.getElementById('panel-download')).display !== 'none',
        homeHidden: getComputedStyle(document.getElementById('panel-home')).display === 'none'
      };
    `);
    check('clicking "Скачать" shows panel-download', tabSwitch.downloadShown);
    check('clicking "Скачать" hides panel-home', tabSwitch.homeHidden);

    // No page-level horizontal overflow.
    const overflow = await evaluate(
      'return document.documentElement.scrollWidth - document.documentElement.clientWidth;'
    );
    check('no horizontal overflow', overflow <= 1, `overflow=${overflow}px`);

    // The hero artwork must have decoded with real dimensions.
    const img = await evaluate(`
      const el = document.querySelector('.hero-mock img');
      return el ? { complete: el.complete, w: el.naturalWidth, h: el.naturalHeight } : null;
    `);
    check('hero image loaded', Boolean(img) && img.complete && img.w > 0 && img.h > 0,
      img ? `${img.w}x${img.h}` : 'missing');

    ws.close();
  } finally {
    cleanup();
  }

  console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

