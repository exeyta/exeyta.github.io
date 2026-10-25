/* Same render assertions as test-render.js, but pointed at the deployed site.
   Usage: node scripts/test-live.js [url]
   Defaults to https://exeyta.github.io/ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const target = process.argv[2] || 'https://exeyta.github.io/';

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
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' вЂ” ' + extra : ''}`);
};


(async () => {
  const port = 9334;
  const userDataDir = path.join(os.tmpdir(), 'exeyta-live-' + Date.now());
  const chrome = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900', 'about:blank'
  ], { stdio: 'ignore' });

  try {
    await waitForDevtools(port);
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

    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.navigate', { url: target });

    for (let i = 0; i < 200; i++) {
      const ready = await evaluate('return document.readyState;');
      if (ready === 'complete') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 800));

    const badResponses = events
      .filter((e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400)
      .map((e) => `${e.params.response.status} ${e.params.response.url}`);
    check('no failed network requests', badResponses.length === 0, badResponses.join(', '));

    const consoleErrors = events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => (e.params.args || []).map((a) => a.value || a.description || '').join(' '));
    check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

    const hero = await evaluate(`
      const el = document.querySelector('.hero-title');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { w: Math.round(r.width), h: Math.round(r.height), display: s.display, visibility: s.visibility };
    `);
    check('hero title rendered', Boolean(hero) && hero.w > 0 && hero.h > 0,
      hero ? `${hero.w}x${hero.h}` : 'missing');

    const cssState = await evaluate(`
      let rules = 0;
      for (const s of document.styleSheets) {
        try { rules += s.cssRules.length; } catch (e) { /* cross-origin */ }
      }
      return { rules };
    `);
    check('stylesheet parsed into rules', cssState.rules > 50, `${cssState.rules} rules`);

    const panels = await evaluate(`
      return [...document.querySelectorAll('.panel')].map((p) => {
        const s = getComputedStyle(p);
        return { id: p.id, shown: s.display !== 'none' && s.visibility !== 'hidden' };
      });
    `);
    const shown = panels.filter((p) => p.shown);
    check('exactly one panel visible', shown.length === 1,
      `visible=${shown.map((p) => p.id).join(',')} of ${panels.length}`);

    const layout = await evaluate(`
      const h = document.querySelector('.header').getBoundingClientRect();
      const t = document.querySelector('.hero-title').getBoundingClientRect();
      const b = document.querySelector('.brand').getBoundingClientRect();
      const tr = document.querySelector('.tabs-rail').getBoundingClientRect();
      return { headerHeight: Math.round(h.height), heroTop: Math.round(t.top),
               sameRow: Math.abs(b.top - tr.top) < 12 };
    `);
    check('header is one row and 80px tall', layout.headerHeight === 80 && layout.sameRow,
      `${layout.headerHeight}px`);
    check('hero sits below the header', layout.heroTop > 80, `heroTop=${layout.heroTop}`);

    const modals = await evaluate(`
      return ['easter', 'panel-modal'].map((id) => {
        const el = document.getElementById(id);
        return { id, display: el ? getComputedStyle(el).display : 'missing' };
      });
    `);
    for (const m of modals) check(`modal #${m.id} hidden`, m.display === 'none', m.display);

    const img = await evaluate(`
      const el = document.querySelector('.hero-mock img');
      return el ? { complete: el.complete, w: el.naturalWidth } : null;
    `);
    check('hero image loaded', Boolean(img) && img.complete && img.w > 0,
      img ? `${img.w}px wide` : 'missing');

    const overflow = await evaluate(
      'return document.documentElement.scrollWidth - document.documentElement.clientWidth;'
    );
    check('no horizontal overflow', overflow <= 1, `overflow=${overflow}px`);

    ws.close();
  } finally {
    try { chrome.kill(); } catch (_) { /* ignore */ }
  }

  console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
