/* 個人記帳 Service Worker：介面 network-first（永遠攞最新），斷網先食快取 */
var CACHE = "ra-shell-v22";
var ASSETS = ["./", "index.html", "app.js", "style.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS).catch(function () {}); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var u;
  try { u = new URL(req.url); } catch (x) { return; }
  if (u.origin !== location.origin) return;                 /* API／GitHub 請求唔掂 */
  if (u.pathname.indexOf("/photos/") >= 0) return;          /* 相片唔快取 */
  e.respondWith(
    fetch(req).then(function (r) {
      if (r && r.ok) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); }
      return r;
    }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match("index.html"); });
    })
  );
});
