/* Maré: funcionamento offline e avisos no celular */
const C = "mare-v2";
const SHELL = ["./", "./index.html", "./app.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/badge-96.png", "./icons/favicon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});

const guardar = (req, res) => { if (res && (res.ok || res.type === "opaque")) { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); } return res; };

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (u.pathname.startsWith("/__/")) return;
    if (r.mode === "navigate") {
      e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put("./index.html", cp)); } return res; })
        .catch(() => caches.match("./index.html")));
      return;
    }
    e.respondWith(fetch(r).then(res => guardar(r, res)).catch(() => caches.match(r)));
    return;
  }
  const lib = (u.hostname === "www.gstatic.com" && u.pathname.startsWith("/firebasejs/")) || u.hostname === "fonts.gstatic.com" || u.hostname === "fonts.googleapis.com";
  if (lib) e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => guardar(r, res))));
});

self.addEventListener("push", e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch (x) { p = { data: { body: e.data && e.data.text() } }; }
  const d = p.data || p.notification || p;
  e.waitUntil(self.registration.showNotification(d.title || "Maré", {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: d.tag || "mare",
    renotify: true,
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ("focus" in w) return w.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./");
  }));
});
