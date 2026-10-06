/* 個人記帳 — offline shell (識別／同步一律走網路，只快取介面) */
var CACHE = "ra-shell-v8";
var SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest",
             "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;                       // API／上傳一律直通
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // api.github.com、LLM 全部直通
  var rel = url.pathname.substring(url.pathname.lastIndexOf("/") + 1) || "index.html";
  if (SHELL.indexOf(rel) < 0 && rel !== "index.html") return;
  e.respondWith(
    fetch(req).then(function (r) {
      if (r && r.ok) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(req, cp); }); }
      return r;
    }).catch(function () { return caches.match(req).then(function (m) { return m || caches.match("index.html"); }); })
  );
});
