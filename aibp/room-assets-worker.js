const indexName = 'ato-aibp-assets-index-v1';
const marker = new URL('local-assets-index', self.registration.scope).href;
const safePath = /^\/(?:aibp\/(?:ps|images)|technology\/images\/gear_cards|hero\/assets|ss\/(?:terrain|terrain-cards|battle-board|tokens))\/(?:[^/]+\/)*[^/]+\.(?:jpe?g|png|webp)$/i;

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || event.request.destination !== 'image'
      || url.origin !== self.location.origin || !safePath.test(url.pathname)) return;
  event.respondWith((async () => {
    try {
      const index = await caches.open(indexName);
      const entry = await index.match(marker);
      if (entry) {
        const { cacheName } = await entry.json();
        const pack = await caches.open(cacheName);
        const image = await pack.match(url.origin + url.pathname);
        if (image) return image;
      }
    } catch { /* Fall back to assets supplied by the server. */ }
    return fetch(event.request);
  })());
});
