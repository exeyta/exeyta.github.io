"use strict";
/* Huwy Wallet — серверный режим: Supabase (аккаунты, балансы) + ЮMoney (оплата).
   HTML+CSS+JS, библиотеки только с CDN. Без Node.js, без сборки, без демо-режима. */
const CFG = window.HUWY_CONFIG;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const norm = (s) => (s || "").trim();
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("ru-RU");

const READY = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
  CFG.SUPABASE_URL.startsWith("http") && window.supabase);
const sb = READY ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

const validAddr = (a) => /^HUWY-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{8}$/.test(a);

/* ================= цена (индикатор для графика) ================= */
function genPrice(seed) {
  const pts = []; let v = 0.10, s = seed || 7;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < 180; i++) { v = Math.max(0.02, v + (rnd() - 0.48) * 0.008); pts.push(v); }
  return pts;
}
let priceHist = genPrice(Date.now() % 100000);
const price = () => priceHist[priceHist.length - 1];
setInterval(() => {
  const l = priceHist[priceHist.length - 1];
  priceHist.push(Math.max(0.02, l + (Math.random() - 0.48) * 0.006));
  priceHist.shift();
  if (!$("#dashView").classList.contains("hidden")) { renderRate(); drawChart(); }
}, 3000);

/* ================= helpers ================= */
function msg(err, ok) {
  const e = $("#actErr"), o = $("#actOk");
  e.hidden = !err; o.hidden = !ok;
  if (err) e.textContent = err;
  if (ok) o.textContent = ok;
}
function authErr(t) { const e = $("#authErr"); e.hidden = !t; if (t) e.textContent = t; }
function rpcErr(e) {
  const m = (e && e.message) || "";
  if (m.includes("login_taken")) return "Такой логин уже занят";
  if (m.includes("funds")) return "Недостаточно средств";
  if (m.includes("no_rcpt")) return "Получатель не найден";
  if (m.includes("bad_amount")) return "Неверная сумма";
  if (m.includes("rate")) return "Слишком часто. Подожди немного";
  if (m.includes("self")) return "Нельзя отправить самому себе";
  if (m.includes("denied")) return "Неверный админ-пароль";
  if (m.includes("locked")) return "Админка временно заблокирована (перебор)";
  if (m.includes("auth")) return "Войди снова";
  return "Ошибка сервера. Попробуй позже";
}

async function getMe() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data, error } = await sb.from("huwy_profiles").select("*").eq("user_id", user.id).single();
  if (error) return null;
  return { login: data.login, address: data.address, bal: Number(data.balance), email: data.email, uid: user.id };
}
async function getHist() {
  const me = await getMe(); if (!me) return [];
  const { data } = await sb.from("huwy_tx").select("*").eq("user_id", me.uid).order("t", { ascending: false }).limit(100);
  return (data || []).map((t) => ({ kind: t.kind, amt: Number(t.amt), note: t.note, t: new Date(t.t).getTime() }));
}

/* ================= вкладки ================= */
$$(".tab").forEach((b) => (b.onclick = () => {
  $$(".tab").forEach((x) => x.classList.remove("active")); b.classList.add("active");
  $("#loginForm").classList.toggle("hidden", b.dataset.tab !== "login");
  $("#registerForm").classList.toggle("hidden", b.dataset.tab !== "register");
}));
$$(".seg-btn").forEach((b) => (b.onclick = () => showView(b.dataset.view)));
function showView(name) {
  $$(".seg-btn").forEach((x) => x.classList.toggle("active", x.dataset.view === name));
  $$(".view").forEach((v) => v.classList.add("hidden"));
  $("#view-" + name).classList.remove("hidden");
  if (name === "hist") renderHist();
  if (name === "scan") initScanner(); else stopScanner();
}

/* ================= регистрация / вход ================= */
/* Входа по email нет: только логин + пароль. Supabase Auth внутри использует
   технический email вида логин@huwy.local — пользователь его не видит.
   Поэтому Confirm email в Dashboard должен быть ВЫКЛЮЧЕН. */
const FAKE_MAIL = (login) => login.toLowerCase() + "@huwy.local";

$("#registerForm").onsubmit = async (e) => {
  e.preventDefault(); authErr("");
  if (!READY) return authErr("Нет связи с сервером: вставь SUPABASE_ANON_KEY в assets/js/config.js.");
  const f = new FormData(e.target);
  const login = norm(f.get("login")).toLowerCase(), pw = f.get("password");
  if (login.length < 3) return authErr("Логин минимум 3 символа");
  if (!/^[a-zA-Z0-9_а-яА-ЯёЁ-]{3,24}$/.test(login)) return authErr("Только буквы, цифры, _ и -");
  if (pw.length < 6) return authErr("Пароль минимум 6 символов");
  const { data, error } = await sb.auth.signUp({ email: FAKE_MAIL(login), password: pw, options: { data: { login } } });
  if (error) return authErr(rpcErr(error));
  if (!data.session) return authErr("Аккаунт создан, но вход не выполнен: выключи Confirm email в Dashboard (Authentication) и войди.");
  render();
};
$("#loginForm").onsubmit = async (e) => {
  e.preventDefault(); authErr("");
  if (!READY) return authErr("Нет связи с сервером: вставь SUPABASE_ANON_KEY в assets/js/config.js.");
  const f = new FormData(e.target);
  const login = norm(f.get("login")).toLowerCase(), pw = f.get("password");
  const { error } = await sb.auth.signInWithPassword({ email: FAKE_MAIL(login), password: pw });
  if (error) return authErr("Неверный логин или пароль");
  const me = await getMe();
  if (!me) return authErr("Профиль ещё создаётся, подожди 5 секунд и войди снова");
  render();
};
$("#logoutBtn").onclick = async () => { stopScanner(); await sb.auth.signOut(); render(); };

/* ================= перевод ================= */
$("#sendForm").onsubmit = async (e) => {
  e.preventDefault(); msg("");
  const f = new FormData(e.target);
  const to = norm(f.get("to")).toUpperCase(), amt = parseFloat(f.get("amount")), memo = norm(f.get("memo"));
  if (!validAddr(to)) return msg("Неверный формат адреса");
  if (!(amt > 0)) return msg("Сумма должна быть > 0");
  const { data, error } = await sb.rpc("huwy_transfer", { p_to: to, p_amt: amt, p_memo: memo });
  if (error) return msg(rpcErr(error));
  render(); e.target.reset();
  msg("", "Отправлено " + fmt(amt) + " HUWY → " + data);
};

/* ================= пополнение через ЮMoney ================= */
function depCalc() {
  const v = parseFloat(new FormData($("#depForm")).get("rub")) || 0;
  $("#depPrev").textContent = "Будет начислено ≈ " + fmt(v * CFG.RATE) + " HUWY";
}
$("#depForm").rub.addEventListener("input", depCalc);
$("#depForm").onsubmit = async (e) => {
  e.preventDefault(); msg("");
  const rub = Math.min(15000, Math.max(10, parseFloat(new FormData(e.target).get("rub")) || 0));
  if (!(rub >= 10)) return msg("Минимум 10 ₽");
  const me = await getMe();
  if (!me) return msg("Войди снова");
  const ptype = (new FormData(e.target).get("ptype")) || "PC";
  const successURL = location.origin + location.pathname + "?pay=success";
  const q = new URLSearchParams({
    receiver: CFG.YOOMONEY_WALLET, "quickpay-form": "button",
    targets: "Huwy Wallet: пополнение " + rub + " RUB",
    paymentType: String(ptype), sum: String(rub),
    label: me.address, successURL
  });
  location.href = "https://yoomoney.ru/quickpay/confirm.xml?" + q.toString();
};

/* ================= трейдинг (исход решает сервер) ================= */
$("#tradeForm").onsubmit = async (e) => {
  e.preventDefault(); msg("");
  const amt = Math.floor(parseFloat(new FormData(e.target).get("amount")));
  if (!(amt >= 1)) return msg("Минимум 1 HUWY");
  const entry = price();
  $("#tradeStatus").textContent = "Позиция открыта: " + fmt(amt) + " HUWY @ " + entry.toFixed(4) + " ₽. Жди 15 сек...";
  setTimeout(async () => {
    const { data, error } = await sb.rpc("huwy_trade", { p_amt: amt });
    if (error) { render(); return msg(rpcErr(error)); }
    $("#tradeStatus").textContent = data.win
      ? "WIN! Выплата " + fmt(Number(data.payout)) + " HUWY"
      : "LOSS. Ставка сгорела.";
    render();
  }, CFG.TRADE_WAIT_MS);
};

/* ================= сканер ================= */
let qrScanner = null;
async function initScanner() {
  if (typeof Html5Qrcode === "undefined") { $("#scanHint").textContent = "Сканер недоступен офлайн — вставь адрес вручную."; return; }
  if (qrScanner) return;
  try {
    qrScanner = new Html5Qrcode("qrReader");
    await qrScanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (txt) => {
      const a = norm(txt).toUpperCase();
      if (validAddr(a)) { $("#sendForm").to.value = a; showView("send"); msg("", "Адрес подставлен из QR"); stopScanner(); }
    });
  } catch (err) { $("#scanHint").textContent = "Нет доступа к камере: " + err; }
}
async function stopScanner() { try { if (qrScanner) { await qrScanner.stop(); await qrScanner.clear(); } } catch {} qrScanner = null; }
$("#scanForm").onsubmit = (e) => {
  e.preventDefault();
  const a = norm(new FormData(e.target).get("addr")).toUpperCase();
  if (a && !validAddr(a)) return msg("Похоже, адрес неверный, но подставляю как есть");
  $("#sendForm").to.value = a; showView("send"); msg("", a ? "Адрес подставлен в перевод" : "");
};

/* ================= админ (пароль проверяет сервер) ================= */
$("#adminForm").onsubmit = async (e) => {
  e.preventDefault(); msg("");
  const f = new FormData(e.target);
  const address = norm(f.get("address")).toUpperCase(), amt = parseFloat(f.get("amount")), pass = f.get("pass");
  if (!(amt > 0)) return msg("Сумма > 0");
  const { data, error } = await sb.rpc("huwy_admin_issue", { p_address: address, p_amt: amt, p_pass: pass });
  e.target.pass.value = ""; // не держать пароль в DOM
  if (error) return msg(rpcErr(error));
  render(); msg("", "Выдано " + fmt(amt) + " HUWY → " + data);
};

/* ================= QR / график / прочее ================= */
function drawQR(text) {
  const box = $("#qrBox"); box.innerHTML = "";
  if (typeof QRCode !== "undefined") new QRCode(box, { text, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  else box.textContent = text;
}
let tf = 1;
$$("[data-tf]").forEach((b) => (b.onclick = () => {
  $$("[data-tf]").forEach((x) => x.classList.remove("active")); b.classList.add("active");
  tf = +b.dataset.tf; drawChart();
}));
function drawChart() {
  const cv = $("#chart"); if (!cv) return;
  const c = cv.getContext("2d"), W = cv.width, H = cv.height;
  const pts = priceHist.slice(-60 * tf);
  const mn = Math.min(...pts), mx = Math.max(...pts), rg = (mx - mn) || 1;
  c.clearRect(0, 0, W, H);
  c.strokeStyle = "#26314a"; c.fillStyle = "#93a0bb"; c.font = "11px monospace";
  for (let g = 0; g < 4; g++) {
    const y = 10 + (g * (H - 20)) / 3;
    c.beginPath(); c.moveTo(40, y); c.lineTo(W - 6, y); c.stroke();
    c.fillText((mx - (rg * g) / 3).toFixed(4), 2, y + 3);
  }
  c.beginPath();
  pts.forEach((p, i) => {
    const x = 40 + (i * (W - 46)) / (pts.length - 1), y = 10 + (1 - (p - mn) / rg) * (H - 20);
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.strokeStyle = pts[pts.length - 1] >= pts[0] ? "#6ee7a8" : "#ff7a7a";
  c.lineWidth = 2; c.stroke();
}
$("#copyBtn").onclick = async () => {
  try { await navigator.clipboard.writeText($("#userAddr").textContent); msg("", "Адрес скопирован"); }
  catch { msg("Копирование недоступно"); }
};
$("#dlBtn").onclick = () => {
  const img = $("#qrBox img, #qrBox canvas");
  if (!img) return msg("QR ещё не готов");
  const a = document.createElement("a"); a.download = "huwy-qr.png"; a.href = img.src || img.toDataURL(); a.click();
};
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; $("#installBanner").classList.remove("hidden"); });
$("#installAppBtn").onclick = async () => { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; } $("#installBanner").classList.add("hidden"); };
$("#installDismissBtn").onclick = () => $("#installBanner").classList.add("hidden");
$("#installBtn").onclick = () => $("#installBanner").classList.toggle("hidden");

/* ================= рендер ================= */
function renderRate() {
  const p = price();
  $("#ratePill").textContent = "1 HUWY = " + p.toFixed(4) + " ₽ · 1 ₽ = " + CFG.RATE + " HUWY";
  $("#tvPrice").textContent = p.toFixed(4) + " ₽";
  const ch = ((p - priceHist[0]) / priceHist[0]) * 100;
  const el = $("#tvChg");
  el.textContent = (ch >= 0 ? "+" : "") + ch.toFixed(2) + "%";
  el.style.color = ch >= 0 ? "#6ee7a8" : "#ff7a7a";
  const dr = $("#depRate"); if (dr) dr.textContent = "1 ₽ = " + CFG.RATE + " HUWY";
}
async function renderHist() {
  const list = await getHist();
  $("#histList").innerHTML = list.length ? list.map((t) =>
    '<div class="tx"><span>' + t.kind + " · " + (t.note || "") +
    "<br><small>" + new Date(t.t).toLocaleString("ru-RU") + "</small></span><b style=\"color:" +
    (t.amt >= 0 ? "#6ee7a8" : "#ff7a7a") + "\">" + (t.amt >= 0 ? "+" : "") + fmt(t.amt) + "</b></div>"
  ).join("") : "<p class='muted'>Пока пусто</p>";
}
async function render() {
  const u = await getMe();
  $("#authView").classList.toggle("hidden", !!u);
  $("#dashView").classList.toggle("hidden", !u);
  if (!u) return;
  $("#balHuwy").textContent = fmt(u.bal) + " HUWY";
  $("#balRub").textContent = "≈ " + fmt(u.bal * price()) + " ₽";
  $("#userLogin").textContent = u.login;
  $("#userAddr").textContent = u.address;
  drawQR(u.address);
  renderRate(); drawChart(); depCalc(); renderHist(); msg("");
}
async function boot() {
  if (!READY) {
    authErr("Нет связи с сервером: вставь SUPABASE_URL и SUPABASE_ANON_KEY в assets/js/config.js (Dashboard → Settings → API).");
    return;
  }
  try {
    const { data } = await sb.rpc("huwy_public_config");
    if (data && data.rate) CFG.RATE = Number(data.rate);
    if (data && data.start_bonus) CFG.START_BONUS = Number(data.start_bonus);
  } catch {}
  $("#modeBadge").textContent = "сервер · Supabase";
  $("#depMethod").textContent = "ЮMoney (" + CFG.YOOMONEY_WALLET + ")";
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  render();
  // возврат с ЮMoney после оплаты: ждём уведомление и обновляем баланс
  if (new URLSearchParams(location.search).get("pay") === "success") {
    history.replaceState(null, "", location.pathname);
    const me = await getMe();
    if (me) {
      showView("deposit");
      msg("", "ЮMoney принял платёж. HUWY начислятся автоматически, как только придёт уведомление (обычно до минуты).");
      const b0 = me.bal; let n = 0;
      const timer = setInterval(async () => {
        n++;
        const m2 = await getMe();
        if ((m2 && m2.bal !== b0) || n >= 24) {
          clearInterval(timer); render();
          if (m2 && m2.bal !== b0) msg("", "HUWY начислены: +" + fmt(m2.bal - b0));
        }
      }, 5000);
    }
  }
}
boot();
