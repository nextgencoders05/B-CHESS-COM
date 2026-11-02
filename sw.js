const CACHE_NAME = 'b-chess-shell-v6-mobile';
const APP_SHELL = [
  './', './index.html', './style.css', './ux.css', './ux.js', './script.js', './books_data.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './pieces/wb.png', './pieces/bp.png', './pieces/wk.png', './pieces/wq.png',
  './pieces/wp.png', './pieces/bn.png', './pieces/wn.png', './pieces/wr.png',
  './pieces/bb.png', './pieces/bk.png', './pieces/bq.png', './pieces/br.png'
];
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response && response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match('./index.html'))));
});
