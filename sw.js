// Offline-Cache für die App-Hülle. Es werden nur eigene Dateien gespeichert,
// niemals Finanzdaten - die liegen ausschließlich im localStorage.

const CACHE = 'bela-finanzen-v2';
const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/main.js',
  './js/store.js',
  './js/parse.js',
  './js/stats.js',
  './js/charts.js',
  './js/market.js',
  './js/views-market.js',
  './js/format.js',
  './app.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Netz zuerst, damit ein Update sofort ankommt; Cache als Rückfallebene.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
