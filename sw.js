// オフライン用 Service Worker。ファイルを更新したら CACHE_VERSION を新しいバージョン表記に変えること。
// バージョンを変えるときは、app.js の APP_VERSION と両方を同じ表記にする（例：'Ver1.2'）。
const CACHE_VERSION = 'Ver1.3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './logic.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先（オフラインでも起動できる）。キャッシュにないものはネットワークから取得。
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request))
  );
});
