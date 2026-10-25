const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const arg = process.argv[2] || '';
const url = arg ? arg : 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
const isRemote = /^https?:/i.test(url);

function findBrowser() {
  const list = [
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')
  ];
  for (const bin of list) if (bin && fs.existsSync(bin)) return bin;
  throw new Error('Chrome или Edge не найдены');
}

let failed = false;
const check = (name, ok, extra) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
};

function connect(browser, port) {
  return (async () => {
    for (let i = 0; i < 120; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch (e) {}
      await new Promise((r) => setTimeout(r, 100));
    }

    const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
      .find((t) => t.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    const events = [];
    let id = 0;

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    };
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    const send = (method, params) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params: params || {} }));
    });

    const evaluate = async (body) => {
      const res = await send('Runtime.evaluate', {
        expression: `(() => { ${body} })()`,
        returnByValue: true,
        awaitPromise: true
      });
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        throw new Error((d.exception && d.exception.description) || d.text || 'ошибка evaluate');
      }
      return res.result.value;
    };

    return { ws, events, send, evaluate };
  })();
}

(async () => {
  const port = 9340;
  const chrome = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(os.tmpdir(), 'exeyta-' + Date.now())}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const { ws, events, send, evaluate } = await connect(chrome, port);

    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.enable');
    if (isRemote) await send('Network.setCacheDisabled', { cacheDisabled: true });

    // ---------- десктоп 1440 ----------
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
    });
    await send('Page.navigate', { url });

    for (let i = 0; i < 200; i++) {
      if (await evaluate('return document.readyState;') === 'complete') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 700));

    const bad = events
      .filter((e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400)
      .map((e) => `${e.params.response.status} ${e.params.response.url}`);
    check('нет битых запросов', bad.length === 0, bad.join(', '));

    const consoleErrors = events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => (e.params.args || []).map((a) => a.value || a.description || '').join(' '));
    check('нет ошибок в консоли', consoleErrors.length === 0, consoleErrors.join(' | '));

    const overflow = await evaluate(`
      const d = document.documentElement;
      return { doc: d.scrollWidth, win: d.clientWidth };
    `);
    check('нет горизонтальной прокрутки', overflow.doc <= overflow.win + 1,
      `${overflow.doc} > ${overflow.win}`);

    const hero = await evaluate(`
      const h1 = document.querySelector('h1');
      const box = h1.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(h1).lineHeight) || box.height;
      return { w: Math.round(box.width), h: Math.round(box.height), lines: Math.round(box.height / lh) };
    `);
    check('h1 отрисован', hero.w > 0 && hero.h > 0, `${hero.w}x${hero.h}`);
    check('h1 не больше трёх строк', hero.lines > 0 && hero.lines <= 3, `${hero.lines} строк`);

    const header = await evaluate(`
      const h = document.querySelector('.site-header').getBoundingClientRect();
      const logo = document.querySelector('.logo').getBoundingClientRect();
      const cta = document.querySelector('.header-cta .btn').getBoundingClientRect();
      return { height: Math.round(h.height), sameRow: Math.abs(logo.top - cta.top) < 20 };
    `);
    check('шапка в одну строку', header.sameRow && header.height <= 72, `${header.height}px`);

    const shot = await evaluate(`
      const img = document.querySelector('.hero-shot img');
      return { complete: img.complete, w: img.naturalWidth, h: img.naturalHeight };
    `);
    check('скриншот лаунчера загрузился', shot.complete && shot.w > 0, `${shot.w}x${shot.h}`);


    const sections = await evaluate(`
      return ['features', 'screens', 'install', 'faq'].map((id) => {
        const el = document.getElementById(id);
        if (!el) return { id, ok: false, h: 0 };
        return { id, ok: el.getBoundingClientRect().height > 100,
                 h: Math.round(el.getBoundingClientRect().height) };
      });
    `);
    for (const item of sections) check(`секция #${item.id} отрисована`, item.ok, item.h + 'px');

    const hidden = await evaluate(`
      return {
        easter: getComputedStyle(document.getElementById('easter')).display,
        drawer: getComputedStyle(document.getElementById('nav-drawer')).display
      };
    `);
    check('пасхалка скрыта при загрузке', hidden.easter === 'none', hidden.easter);
    check('меню скрыто на десктопе', hidden.drawer === 'none', hidden.drawer);

    const faq = await evaluate(`
      const first = document.querySelector('.faq-list details');
      const before = first.open;
      first.querySelector('summary').click();
      const after = first.open;
      first.open = false;
      return { before, after };
    `);
    check('вопрос в FAQ раскрывается', faq.before === false && faq.after === true);

    const easterWorks = await evaluate(`
      const el = document.getElementById('easter');
      el.hidden = false;
      const shown = getComputedStyle(el).display !== 'none';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const closed = getComputedStyle(el).display === 'none';
      return { shown, closed };
    `);
    check('пасхалка открывается', easterWorks.shown);
    check('Escape закрывает пасхалку', easterWorks.closed);

    const invisible = await evaluate(`
      for (const d of document.querySelectorAll('.faq-list details')) d.open = true;
      const els = [...document.querySelectorAll('.faq-list p, .check-list, .steps h3, .feature p')];
      return els.filter((el) => {
        const s = getComputedStyle(el);
        return s.visibility === 'hidden' || parseFloat(s.opacity) === 0;
      }).length;
    `);
    check('нет невидимого контента', invisible === 0, `${invisible} скрыто`);


    // ---------- мобильный 390 ----------
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    await send('Page.navigate', { url });
    await new Promise((r) => setTimeout(r, 900));

    const mobile = await evaluate(`
      const nav = getComputedStyle(document.querySelector('.nav')).display;
      const toggle = getComputedStyle(document.querySelector('.nav-toggle')).display;
      const d = document.documentElement;
      return { nav, toggle, over: d.scrollWidth - d.clientWidth };
    `);
    check('навигация скрыта на мобильном', mobile.nav === 'none', mobile.nav);
    check('кнопка меню видна на мобильном', mobile.toggle !== 'none', mobile.toggle);
    check('на мобильном нет прокрутки вбок', mobile.over <= 1, `перелив ${mobile.over}px`);

    const menu = await evaluate(`
      const btn = document.getElementById('nav-toggle');
      const drawer = document.getElementById('nav-drawer');
      btn.click();
      const opened = !drawer.hidden;
      btn.click();
      return { opened, closed: drawer.hidden };
    `);
    check('мобильное меню открывается', menu.opened);
    check('мобильное меню закрывается', menu.closed);

    const tapTargets = await evaluate(`
      const els = [...document.querySelectorAll('.nav-toggle, .header-cta .btn, .faq-list summary')];
      return els.filter((el) => el.getBoundingClientRect().height < 32).length;
    `);
    check('элементы управления не мельче 32px', tapTargets === 0, `${tapTargets} мелких`);

    ws.close();
  } finally {
    try { chrome.kill(); } catch (e) {}
  }

  console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: OK');
  process.exitCode = failed ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
