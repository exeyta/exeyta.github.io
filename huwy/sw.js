/* Huwy Wallet — офлайн-кэш. Без сборки. */
const CACHE = "huwy-v6";
const FILES = ["./", "./index.html", "./manifest.webmanifest",
  "./assets/css/style.css?v=6", "./assets/js/config.js?v=6", "./assets/js/app.js?v=6"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).catch(() => caches.match("./index.html"))));
});
