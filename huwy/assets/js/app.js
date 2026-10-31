"use strict";
/* Huwy Wallet на Firebase (Auth + Firestore). Только логин + пароль.
   Email провайдер Firebase использует технический логин@huwy.local — юзер его не видит.
   P2P — эскроу: отправитель списывает и создаёт перевод, получатель забирает.
   Правила firestore.rules запрещают любую другую накрутку баланса. */
const CFG = window.HUWY_CONFIG;
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const norm = (s) => (s || "").trim();
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("ru-RU");

firebase.initializeApp(CFG.FIREBASE);
const auth = firebase.auth();
const db = firebase.firestore();
const FAKE_MAIL = (login) => login.toLowerCase() + "@huwy.local";
const validAddr = (a) => /^HUWY-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{8}$/.test(a);
function randAddr() {
  const h = "0123456789ABCDEF", p = (n) => Array.from({ length: n }, () => h[(Math.random() * 16) | 0]).join("");
  return "HUWY-" + p(4) + "-" + p(4) + "-" + p(8);
}

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
  const c = (e && e.code) || "";
  if (c.includes("email-already-in-use")) return "Такой логин уже занят";
  if (c.includes("wrong-password") || c.includes("invalid-credential") || c.includes("user-not-found")) return "Неверный логин или пароль";
  if (c.includes("unauthorized-domain") || c.includes("referer-blocked")) return "Домен не разрешён: добавь exeyta.github.io в Authentication → Settings → Authorized domains";
  if (c.includes("operation-not-allowed")) return "Провайдер Email/Password выключен: Authentication → Sign-in method → Email/Password";
  if (c.includes("admin-restricted")) return "Регистрация закрыта в настройках проекта";
  if (c.includes("permission-denied") || c.includes("failed-precondition")) return "Отклонено правилами базы: вставь firestore.rules в Firestore → Rules → Publish";
  if (c.includes("not-found")) return "База не создана: Firestore Database → Create database";
  if (c.includes("unavailable") || c.includes("network")) return "Нет связи с сервером. Проверь интернет";
  return "Ошибка. Попробуй позже";
}
const me = () => auth.currentUser;
const isAdmin = () => !!(CFG.ADMIN_UID && me() && me().uid === CFG.ADMIN_UID);

async function getProfile() {
  const u = me(); if (!u) return null;
  const d = await db.collection("users").doc(u.uid).get();
  if (!d.exists) return null;
  const p = d.data();
  return { login: p.login, address: p.address, bal: Number(p.balance), uid: u.uid };
}
async function ledgerAdd(tx, uid, kind, amt, note) {
  tx.set(db.collection("ledger").doc(uid).collection("items").doc(),
    { uid, kind, amt, note: String(note || "").slice(0, 140), t: firebase.firestore.FieldValue.serverTimestamp() });
}
async function getHist() {
  const u = me(); if (!u) return [];
  const out = [];
  const s1 = await db.collection("transfers").where("fromUid", "==", u.uid).get();
  s1.forEach((d) => { const t = d.data(); out.push({ t: t.t ? t.t.toMillis() : 0, kind: "out", amt: -t.amount, note: (t.memo ? t.memo + " · " : "") + t.toAddr }); });
  const s2 = await db.collection("transfers").where("toUid", "==", u.uid).get();
  s2.forEach((d) => { const t = d.data(); out.push({ t: t.t ? t.t.toMillis() : 0, kind: "in", amt: t.amount, note: "от " + t.fromLogin + (t.memo ? " · " + t.memo : "") }); });
  const s3 = await db.collection("ledger").doc(u.uid).collection("items").get();
  s3.forEach((d) => { const t = d.data(); out.push({ t: t.t ? t.t.toMillis() : 0, kind: t.kind, amt: Number(t.amt), note: t.note }); });
  return out.sort((a, b) => b.t - a.t).slice(0, 100);
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

/* создание профиля (идемпотентно): используется при регистрации и при починке */
async function ensureProfile(uid, login) {
  const uref = db.collection("users").doc(uid);
  if ((await uref.get()).exists) return "ok";
  if ((await db.collection("logins").doc(login).get()).exists) return "taken";
  let address = randAddr();
  for (let i = 0; i < 5; i++) {
    if (!(await db.collection("addresses").doc(address).get()).exists) break;
    address = randAddr();
  }
  await db.runTransaction(async (tx) => {
    if ((await tx.get(uref)).exists) return;
    tx.set(uref, {
      login, address, balance: CFG.START_BONUS, pendingClaim: "",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    tx.set(db.collection("logins").doc(login), { uid });
    tx.set(db.collection("addresses").doc(address), { uid, login });
  });
  await ledgerAddTx(uid, "bonus", CFG.START_BONUS, "Стартовый бонус");
  return "ok";
}
$("#registerForm").onsubmit = async (e) => {
  e.preventDefault(); authErr("");
  const f = new FormData(e.target);
  const login = norm(f.get("login")).toLowerCase(), pw = f.get("password");
  if (login.length < 3) return authErr("Логин минимум 3 символа");
  if (!/^[a-z0-9_а-яё-]{3,24}$/.test(login)) return authErr("Только буквы, цифры, _ и -");
  if (pw.length < 6) return authErr("Пароль минимум 6 символов");
  try {
    if ((await db.collection("logins").doc(login).get()).exists) return authErr("Такой логин уже занят");
    const cred = await auth.createUserWithEmailAndPassword(FAKE_MAIL(login), pw);
    const st = await ensureProfile(cred.user.uid, login);
    if (st === "taken") { await cred.user.delete().catch(() => {}); await auth.signOut(); return authErr("Такой логин уже занят"); }
    render();
  } catch (err) { authErr(fbErr(err)); }
};
async function ledgerAddTx(uid, kind, amt, note) {
  await db.collection("ledger").doc(uid).collection("items").add(
    { uid, kind, amt, note: String(note || "").slice(0, 140), t: firebase.firestore.FieldValue.serverTimestamp() });
}
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
    const rc = await db.collection("addresses").doc(to).get();
    if (!rc.exists) return msg("Получатель не найден");
    if (rc.data().uid === u.uid) return msg("Нельзя отправить самому себе");
    await db.runTransaction(async (tx) => {
      const sdoc = await tx.get(db.collection("users").doc(u.uid));
      if (!sdoc.exists) throw { code: "no-profile" };
      if (Number(sdoc.data().balance) < amt) throw { code: "funds" };
      const tid = db.collection("transfers").doc().id;
      tx.set(db.collection("transfers").doc(tid), {
        fromUid: u.uid, fromLogin: sdoc.data().login,
        toUid: rc.data().uid, toAddr: to, amount: amt,
        memo: memo.slice(0, 120), claimed: false,
        t: firebase.firestore.FieldValue.serverTimestamp()
      });
      tx.update(db.collection("users").doc(u.uid), { balance: Number(sdoc.data().balance) - amt });
    });
    await ledgerAddTx(u.uid, "out", -amt, (memo ? memo + " · " : "") + to);
    render(); e.target.reset();
    msg("", "Отправлено " + fmt(amt) + " HUWY → " + rc.data().login + ". Получатель заберёт во вкладке «История» или перевод появится у него сам.");
  } catch (err) {
    if (err && err.code === "funds") return msg("Недостаточно средств");
    msg(fbErr(err));
  }
};

/* ================= входящие: забрать ================= */
async function renderIncoming() {
  const u = me(); const box = $("#incomingList"); if (!u || !box) return;
  const s = await db.collection("transfers").where("toUid", "==", u.uid).get();
  const list = [];
  s.forEach((d) => { if (!d.data().claimed) list.push({ id: d.id, ...d.data() }); });
  box.innerHTML = list.length ? list.map((t) =>
    '<div class="tx"><span>Входящий · от ' + t.fromLogin + (t.memo ? " · " + t.memo : "") +
    '</span><span><b>+' + fmt(t.amount) + '</b> <button class="btn ghost sm" data-claim="' + t.id + '" data-amt="' + t.amount + '">Забрать</button></span></div>'
  ).join("") : "<p class='muted'>Входящих нет</p>";
  box.querySelectorAll("[data-claim]").forEach((b) => (b.onclick = () => claimTransfer(b.dataset.claim, parseFloat(b.dataset.amt))));
}
async function claimTransfer(tid, amt) {
  msg("");
  try {
    const u = me();
    await db.runTransaction(async (tx) => {
      const tdoc = await tx.get(db.collection("transfers").doc(tid));
      if (!tdoc.exists || tdoc.data().claimed || tdoc.data().toUid !== u.uid) throw { code: "gone" };
      const udoc = await tx.get(db.collection("users").doc(u.uid));
      tx.update(db.collection("transfers").doc(tid), { claimed: true });
      tx.update(db.collection("users").doc(u.uid), {
        balance: Math.round((Number(udoc.data().balance) + amt) * 100) / 100,
        pendingClaim: tid
      });
    });
    await ledgerAddTx(u.uid, "in", amt, "Входящий перевод");
    render(); msg("", "Зачислено +" + fmt(amt) + " HUWY");
  } catch (err) { msg(err && err.code === "gone" ? "Перевод уже забран" : fbErr(err)); }
}

/* ================= трейдинг (исход решает случай, максимум x2 — только игра) ================= */
$("#tradeForm").onsubmit = async (e) => {
  e.preventDefault(); msg("");
  const amt = Math.floor(parseFloat(new FormData(e.target).get("amount")));
  if (!(amt >= 1)) return msg("Минимум 1 HUWY");
  try {
    const u = me(); if (!u) return msg("Войди снова");
    const bid = db.collection("bets").doc().id;
    await db.runTransaction(async (tx) => {
      const sdoc = await tx.get(db.collection("users").doc(u.uid));
      if (!sdoc.exists || Number(sdoc.data().balance) < amt) throw { code: "funds" };
      tx.set(db.collection("bets").doc(bid), {
        uid: u.uid, amount: amt, claimed: false,
        t: firebase.firestore.FieldValue.serverTimestamp()
      });
      tx.update(db.collection("users").doc(u.uid), { balance: Number(sdoc.data().balance) - amt });
    });
    await ledgerAddTx(u.uid, "trade", -amt, "Ставка");
    render();
    const entry = price();
    $("#tradeStatus").textContent = "Позиция открыта: " + fmt(amt) + " HUWY @ " + entry.toFixed(4) + " ₽. Жди 15 сек...";
    setTimeout(async () => {
      const win = Math.random() < 0.5;
      try {
        if (win) {
          await db.runTransaction(async (tx) => {
            const bdoc = await tx.get(db.collection("bets").doc(bid));
            if (!bdoc.exists || bdoc.data().claimed) throw { code: "gone" };
            const udoc = await tx.get(db.collection("users").doc(u.uid));
            tx.update(db.collection("bets").doc(bid), { claimed: true });
            tx.update(db.collection("users").doc(u.uid), {
              balance: Number(udoc.data().balance) + amt * 2,
              pendingClaim: bid
            });
          });
          await ledgerAddTx(u.uid, "trade", amt, "WIN x2");
          $("#tradeStatus").textContent = "WIN! Выплата " + fmt(amt * 2) + " HUWY";
        } else {
          await db.collection("bets").doc(bid).update({ claimed: true });
          await ledgerAddTx(u.uid, "trade", 0, "LOSS, ставка сгорела");
          $("#tradeStatus").textContent = "LOSS. Ставка сгорела.";
        }
      } catch (err) { $("#tradeStatus").textContent = "Ошибка расчёта: " + fbErr(err); }
      render();
    }, CFG.TRADE_WAIT_MS);
  } catch (err) { msg(err && err.code === "funds" ? "Недостаточно средств" : fbErr(err)); }
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

/* ================= админ (только ADMIN_UID, права проверяют правила базы) ================= */
$("#adminForm").onsubmit = async (e) => {
  e.preventDefault(); msg("");
  if (!isAdmin()) return msg("Нет прав");
  const f = new FormData(e.target);
  const address = norm(f.get("address")).toUpperCase(), amt = parseFloat(f.get("amount"));
  if (!validAddr(address)) return msg("Неверный формат адреса");
  if (!(amt > 0) || amt > 1000000) return msg("Сумма 0..1000000");
  try {
    const rc = await db.collection("addresses").doc(address).get();
    if (!rc.exists) return msg("Адрес не найден");
    await db.runTransaction(async (tx) => {
      const udoc = await tx.get(db.collection("users").doc(rc.data().uid));
      tx.update(db.collection("users").doc(rc.data().uid), {
        balance: Math.round((Number(udoc.data().balance) + amt) * 100) / 100
      });
      ledgerAdd(tx, rc.data().uid, "admin", Math.round(amt * 100) / 100, "Выдача админом");
    });
    render(); e.target.reset();
    msg("", "Выдано " + fmt(amt) + " HUWY → " + rc.data().login);
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
    "<br><small>" + (t.t ? new Date(t.t).toLocaleString("ru-RU") : "") + "</small></span><b style=\"color:" +
    (t.amt >= 0 ? "#6ee7a8" : "#ff7a7a") + "\">" + (t.amt >= 0 ? "+" : "") + fmt(t.amt) + "</b></div>"
  ).join("") : "<p class='muted'>Пока пусто</p>";
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
      // залогинен, а профиля нет (сбойная регистрация): чиним на месте
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
  renderRate(); drawChart(); renderHist(); renderIncoming(); msg("");
}
auth.onAuthStateChanged(() => render());
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
render();
