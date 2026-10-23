// Offline cache: app shell + data + images. Bump VERSION after updating data.
const VERSION = 'acc-v6';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(['./', 'index.html', 'styles.css?v=6', 'app.js?v=6', 'data/units.json', 'data/glossary.json', 'icon.svg', 'icon-180.png', 'manifest.webmanifest'])));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Network first (so updates show up), fall back to cache when offline.
// Our own files revalidate with the server, so a fresh page never gets a stale script from the HTTP cache.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const own = new URL(e.request.url).origin === location.origin && e.request.mode !== 'navigate';
  e.respondWith(fetch(own ? new Request(e.request, {cache: 'no-cache'}) : e.request).then(r => {
    const copy = r.clone();
    if (r.ok) caches.open(VERSION).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true})));
});
