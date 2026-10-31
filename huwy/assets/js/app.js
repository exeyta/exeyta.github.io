"use strict";
/* Huwy Wallet на Firebase (Auth + Realtime Database). Только логин + пароль.
   Email для Auth технический: логин@huwy.local — юзер его не видит.
   P2P — эскроу: отправитель списывает и создаёт перевод одним атомарным update,
   получатель забирает. Правила database.rules.json запрещают любую накрутку. */
const CFG = window.HUWY_CONFIG;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const norm = (s) => (s || "").trim();
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("ru-RU");

firebase.initializeApp(CFG.FIREBASE);
const auth = firebase.auth();
const rdb = firebase.database();
const TS = firebase.database.ServerValue.TIMESTAMP;
const FAKE_MAIL = (login) => login.toLowerCase() + "@huwy.local";
const validAddr = (a) => /^HUWY-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{8}$/.test(a);
function randAddr() {
  const h = "0123456789ABCDEF", p = (n) => Array.from({ length: n }, () => h[(Math.random() * 16) | 0]).join("");
  return "HUWY-" + p(4) + "-" + p(4) + "-" + p(8);
}
const R = (p) => rdb.ref(p);
const val = async (p) => (await R(p).get()).val();

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
function fbErr(e) {
  const c = String((e && e.code) || "") + " " + String((e && e.message) || "");
  if (c.includes("email-already-in-use")) return "Такой логин уже занят";
  if (c.includes("wrong-password") || c.includes("invalid-credential") || c.includes("user-not-found") || c.includes("user-not-found")) return "Неверный логин или пароль";
  if (c.includes("unauthorized-domain")) return "Домен не разрешён: добавь exeyta.github.io в Authentication → Settings → Authorized domains";
  if (c.includes("operation-not-allowed")) return "Провайдер Email/Password выключен: Authentication → Sign-in method";
  if (c.includes("PERMISSION_DENIED")) return "Отклонено правилами базы: вставь database.rules.json в Realtime Database → Rules → Publish";
  if (c.includes("unavailable") || c.includes("network") || c.includes("DISCONNECTED")) return "Нет связи с сервером. Проверь интернет";
  return "Ошибка. Попробуй позже";
}
const me = () => auth.currentUser;
const isAdmin = () => !!(CFG.ADMIN_UID && me() && me().uid === CFG.ADMIN_UID);

async function getProfile() {
  const u = me(); if (!u) return null;
  const p = await val("users/" + u.uid);
  if (!p) return null;
  return { login: p.login, address: p.address, bal: Number(p.balance), uid: u.uid };
}
function ledgerEntry(uid, kind, amt, note) {
  const k = R("ledger/" + uid).push().key;
  const u = {};
  u["ledger/" + uid + "/" + k] = { uid, kind, amt, note: String(note || "").slice(0, 140), t: TS };
  return u;
}
/* создание профиля (идемпотентно) */
async function ensureProfile(uid, login) {
  if (await val("users/" + uid)) return "ok";
  if (await val("logins/" + login)) return "taken";
  let address = randAddr();
  for (let i = 0; i < 5; i++) {
    if (!(await val("addresses/" + address))) break;
    address = randAddr();
  }
  await R("logins/" + login).transaction((cur) => (cur ? undefined : { uid }));
  if ((await val("logins/" + login))?.uid !== uid) return "taken";
  const u = {};
  u["users/" + uid] = { login, address, balance: CFG.START_BONUS, pendingClaim: "", createdAt: TS };
  u["addresses/" + address] = { uid, login };
  await R("/").update(u);
  await R("/").update(ledgerEntry(uid, "bonus", CFG.START_BONUS, "Стартовый бонус"));
  return "ok";
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
  if (name === "hist") { renderHist(); renderIncoming(); renderOutbox(); }
  if (name === "scan") initScanner(); else stopScanner();
}

/* ================= регистрация / вход ================= */
$("#registerForm").onsubmit = async (e) => {
  e.preventDefault(); authErr("");
  const f = new FormData(e.target);
  const login = norm(f.get("login")).toLowerCase(), pw = f.get("password");
  if (login.length < 3) return authErr("Логин минимум 3 символа");
  if (!/^[a-z0-9_а-яё-]{3,24}$/.test(login)) return authErr("Только буквы, цифры, _ и -");
  if (pw.length < 6) return authErr("Пароль минимум 6 символов");
  try {
    if (await val("logins/" + login)) return authErr("Такой логин уже занят");
    const cred = await auth.createUserWithEmailAndPassword(FAKE_MAIL(login), pw);
    const st = await ensureProfile(cred.user.uid, login);
    if (st === "taken") { await cred.user.delete().catch(() => {}); await auth.signOut(); return authErr("Такой логин уже занят"); }
    render();
  } catch (err) { authErr(fbErr(err)); }
};
$("#loginForm").onsubmit = async (e) => {
  e.preventDefault(); authErr("");
  const f = new FormData(e.target);
  const login = norm(f.get("login")).toLowerCase(), pw = f.get("password");
  try {
    await auth.signInWithEmailAndPassword(FAKE_MAIL(login), pw);
    render();
  } catch (err) { authErr(fbErr(err)); }
};
$("#logoutBtn").onclick = async () => { stopScanner(); await auth.signOut(); render(); };

/* ================= перевод (эскроу) ================= */
$("#sendForm").onsubmit = async (e) => {
  e.preventDefault(); msg("");
  const f = new FormData(e.target);
  const to = norm(f.get("to")).toUpperCase(), amt = Math.round(parseFloat(f.get("amount")) * 100) / 100, memo = norm(f.get("memo"));
  if (!validAddr(to)) return msg("Неверный формат адреса");
  if (!(amt > 0)) return msg("Сумма должна быть > 0");
  if (amt > 1000000) return msg("Слишком большая сумма");
  try {
    const u = me(); if (!u) return msg("Войди снова");
    const rc = await val("addresses/" + to);
    if (!rc) return msg("Получатель не найден");
    if (rc.uid === u.uid) return msg("Нельзя отправить самому себе");
    const prof = await val("users/" + u.uid);
    if (!prof || Number(prof.balance) < amt) return msg("Недостаточно средств");
    const tid = R("users/" + u.uid + "/outbox").push().key;
    const lid = R("ledger/" + u.uid).push().key;
    const up = {};
    up["users/" + u.uid + "/balance"] = Math.round((Number(prof.balance) - amt) * 100) / 100;
    up["users/" + u.uid + "/outbox/" + tid] = {
      toUid: rc.uid, toAddr: to, amount: amt,
      memo: memo.slice(0, 120), claimed: false, t: TS
    };
    up["users/" + rc.uid + "/inbox/" + tid] = {
      tid, fromUid: u.uid, fromLogin: prof.login, toUid: rc.uid,
      amount: amt, memo: memo.slice(0, 120), spent: false, t: TS
    };
    up["ledger/" + u.uid + "/" + lid] = { uid: u.uid, kind: "out", amt: -amt, note: (memo ? memo + " · " : "") + to, t: TS };
    await R("/").update(up);
    render(); e.target.reset();
    msg("", "Отправлено " + fmt(amt) + " HUWY → " + rc.login + ". Заберёт во вкладке «История».");
  } catch (err) { msg(fbErr(err)); }
};

/* ================= входящие: забрать / свои незабранные: отменить ================= */
async function renderIncoming() {
  const u = me(); const box = $("#incomingList"); if (!u || !box) return;
  const all = (await val("users/" + u.uid + "/inbox")) || {};
  const list = Object.entries(all).filter(([, t]) => t && !t.spent);
  box.innerHTML = list.length ? list.map(([tid, t]) =>
    '<div class="tx"><span>Входящий · от ' + t.fromLogin + (t.memo ? " · " + t.memo : "") +
    '</span><span><b>+' + fmt(t.amount) + '</b> <button class="btn ghost sm" data-claim="' + tid + '">Забрать</button></span></div>'
  ).join("") : "<p class='muted'>Входящих нет</p>";
  box.querySelectorAll("[data-claim]").forEach((b) => (b.onclick = () => claimTransfer(b.dataset.claim)));
}
async function claimTransfer(tid) {
  msg("");
  try {
    const u = me();
    const [inbox, prof] = [await val("users/" + u.uid + "/inbox/" + tid), await val("users/" + u.uid)];
    if (!inbox || inbox.spent) return msg("Перевод уже забран");
    const out = await val("users/" + inbox.fromUid + "/outbox/" + tid);
    if (!out || out.claimed) return msg("Перевод уже забран");
    const amt = Number(inbox.amount);
    const up = {};
    up["users/" + u.uid + "/balance"] = Math.round((Number(prof.balance) + amt) * 100) / 100;
    up["users/" + u.uid + "/pendingClaim"] = tid;
    up["users/" + u.uid + "/inbox/" + tid + "/spent"] = true;
    up["users/" + inbox.fromUid + "/outbox/" + tid + "/claimed"] = true;
    Object.assign(up, ledgerEntry(u.uid, "in", amt, "Входящий перевод"));
    await R("/").update(up);
    render(); msg("", "Зачислено +" + fmt(amt) + " HUWY");
  } catch (err) { msg(fbErr(err)); }
}
async function renderOutbox() {
  const u = me(); const box = $("#outboxList"); if (!u || !box) return;
  const all = (await val("users/" + u.uid + "/outbox")) || {};
  const list = Object.entries(all).filter(([, t]) => t && !t.claimed);
  box.innerHTML = list.length ? list.map(([tid, t]) =>
    '<div class="tx"><span>Ждёт получения · ' + t.toAddr +
    '</span><span><b>' + fmt(t.amount) + '</b> <button class="btn ghost sm" data-cancel="' + tid + '">Отменить</button></span></div>'
  ).join("") : "";
  box.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => cancelTransfer(b.dataset.cancel)));
}
async function cancelTransfer(tid) {
  msg("");
  try {
    const u = me();
    const [out, prof] = [await val("users/" + u.uid + "/outbox/" + tid), await val("users/" + u.uid)];
    if (!out || out.claimed) return msg("Перевод уже забран, отменить нельзя");
    const amt = Number(out.amount);
    const up = {};
    up["users/" + u.uid + "/balance"] = Math.round((Number(prof.balance) + amt) * 100) / 100;
    up["users/" + u.uid + "/pendingClaim"] = tid;
    up["users/" + u.uid + "/outbox/" + tid] = null;
    Object.assign(up, ledgerEntry(u.uid, "cancel", amt, "Возврат: перевод не забрали"));
    await R("/").update(up);
    render(); msg("", "Перевод отменён, +" + fmt(amt) + " HUWY возвращено");
  } catch (err) { msg(fbErr(err)); }
}

/* ================= трейдинг (x2, исход — случай; только игра) ================= */
$("#tradeForm").onsubmit = async (e) => {
  e.preventDefault(); msg("");
  const amt = Math.floor(parseFloat(new FormData(e.target).get("amount")));
  if (!(amt >= 1)) return msg("Минимум 1 HUWY");
  try {
    const u = me(); if (!u) return msg("Войди снова");
    const prof = await val("users/" + u.uid);
    if (!prof || Number(prof.balance) < amt) return msg("Недостаточно средств");
    const bid = R("users/" + u.uid + "/bets").push().key;
    const up = {};
    up["users/" + u.uid + "/balance"] = Number(prof.balance) - amt;
    up["users/" + u.uid + "/bets/" + bid] = { amount: amt, claimed: false, t: TS };
    Object.assign(up, ledgerEntry(u.uid, "trade", -amt, "Ставка"));
    await R("/").update(up);
    render();
    const entry = price();
    $("#tradeStatus").textContent = "Позиция открыта: " + fmt(amt) + " HUWY @ " + entry.toFixed(4) + " ₽. Жди 15 сек...";
    setTimeout(async () => {
      const win = Math.random() < 0.5;
      try {
        if (win) {
          const p2 = await val("users/" + u.uid);
          const up2 = {};
          up2["users/" + u.uid + "/balance"] = Number(p2.balance) + amt * 2;
          up2["users/" + u.uid + "/pendingClaim"] = bid;
          up2["users/" + u.uid + "/bets/" + bid + "/claimed"] = true;
          Object.assign(up2, ledgerEntry(u.uid, "trade", amt, "WIN x2"));
          await R("/").update(up2);
          $("#tradeStatus").textContent = "WIN! Выплата " + fmt(amt * 2) + " HUWY";
        } else {
          await R("users/" + u.uid + "/bets/" + bid + "/claimed").set(true);
          await R("/").update(ledgerEntry(u.uid, "trade", 0, "LOSS, ставка сгорела"));
          $("#tradeStatus").textContent = "LOSS. Ставка сгорела.";
        }
      } catch (err) { $("#tradeStatus").textContent = "Ошибка расчёта: " + fbErr(err); }
      render();
    }, CFG.TRADE_WAIT_MS);
  } catch (err) { msg(fbErr(err)); }
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

/* ================= админ (только ADMIN_UID, проверяют правила базы) ================= */
$("#adminForm").onsubmit = async (e) => {
  e.preventDefault(); msg("");
  if (!isAdmin()) return msg("Нет прав");
  const f = new FormData(e.target);
  const address = norm(f.get("address")).toUpperCase(), amt = parseFloat(f.get("amount"));
  if (!validAddr(address)) return msg("Неверный формат адреса");
  if (!(amt > 0) || amt > 1000000) return msg("Сумма 0..1000000");
  try {
    const rc = await val("addresses/" + address);
    if (!rc) return msg("Адрес не найден");
    const p = await val("users/" + rc.uid);
    const up = {};
    up["users/" + rc.uid + "/balance"] = Math.round((Number(p.balance) + amt) * 100) / 100;
    Object.assign(up, ledgerEntry(rc.uid, "admin", Math.round(amt * 100) / 100, "Выдача админом"));
    await R("/").update(up);
    render(); e.target.reset();
    msg("", "Выдано " + fmt(amt) + " HUWY → " + rc.login);
  } catch (err) { msg(fbErr(err)); }
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
/* ================= рендер ================= */
function renderRate() {
  const p = price();
  $("#ratePill").textContent = "1 HUWY = " + p.toFixed(4) + " ₽ · 1 ₽ = " + CFG.RATE + " HUWY";
  $("#tvPrice").textContent = p.toFixed(4) + " ₽";
  const ch = ((p - priceHist[0]) / priceHist[0]) * 100;
  const el = $("#tvChg");
  el.textContent = (ch >= 0 ? "+" : "") + ch.toFixed(2) + "%";
  el.style.color = ch >= 0 ? "#6ee7a8" : "#ff7a7a";
}
function txRow(kind, note, t, amt) {
  return '<div class="tx"><span>' + kind + " · " + (note || "") +
    "<br><small>" + (t ? new Date(t).toLocaleString("ru-RU") : "") + "</small></span><b style=\"color:" +
    (amt >= 0 ? "#6ee7a8" : "#ff7a7a") + "\">" + (amt >= 0 ? "+" : "") + fmt(amt) + "</b></div>";
}
async function renderHist() {
  try {
    const u = me(); if (!u) return;
    const [led, out] = [await val("ledger/" + u.uid), await val("users/" + u.uid + "/outbox")];
    const list = [];
    if (led) Object.values(led).forEach((t) => list.push({ t: t.t || 0, k: t.kind, n: t.note, a: Number(t.amt) }));
    if (out) Object.values(out).forEach((t) => { if (t && !t.claimed) list.push({ t: t.t || 0, k: "out", n: "Ожидает получения · " + t.toAddr, a: 0 }); });
    list.sort((a, b) => b.t - a.t);
    $("#histList").innerHTML = list.length ? list.slice(0, 100).map((t) => txRow(t.k, t.n, t.t, t.a)).join("") : "<p class='muted'>Пока пусто</p>";
  } catch (err) { $("#histList").innerHTML = "<p class='err'>" + fbErr(err) + "</p>"; }
}
async function render() {
  const u = me();
  $("#authView").classList.toggle("hidden", !!u);
  $("#dashView").classList.toggle("hidden", !u);
  if (!u) return;
  let p;
  try {
    p = await getProfile();
    if (!p) {
      const login = (u.email || "").split("@")[0];
      const st = await ensureProfile(u.uid, login);
      if (st === "taken") { await auth.signOut(); authErr("Логин занят другим аккаунтом. Войди под своим."); render(); return; }
      p = await getProfile();
    }
  } catch (err) {
    msg("Нет доступа к базе: " + fbErr(err));
    return;
  }
  if (!p) { await auth.signOut(); authErr("Профиль не найден. Зарегистрируйся заново."); render(); return; }
  $("#balHuwy").textContent = fmt(p.bal) + " HUWY";
  $("#balRub").textContent = "≈ " + fmt(p.bal * price()) + " ₽";
  $("#userLogin").textContent = p.login;
  $("#userAddr").textContent = p.address;
  drawQR(p.address);
  document.querySelector('[data-view="admin"]').style.display = isAdmin() ? "" : "none";
  renderRate(); drawChart(); renderHist(); renderIncoming(); renderOutbox(); msg("");
}
auth.onAuthStateChanged(() => render());
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
render();
