const indexName = 'ato-aibp-assets-index-v1';
const marker = new URL('local-assets-index', self.registration.scope).href;
const safePath = /^\/(?:aibp\/(?:ps|images)|technology\/images\/gear_cards|hero\/assets|ss\/(?:terrain|terrain-cards|battle-board|tokens))\/(?:[^/]+\/)*[^/]+\.(?:jpe?g|png|webp)$/i;
let activeIndex;

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
        const version = entry.headers.get('X-ATO-Asset-Index');
        if (!version || activeIndex?.cacheName !== version) activeIndex = await entry.json();
        const pack = await caches.open(activeIndex.cacheName);
        if (!activeIndex.entries) {
          const existing = await pack.match(url.origin + url.pathname);
          if (existing) return existing;
        } else {
          const image = activeIndex.entries[url.pathname.slice(1)];
          const match = image && await pack.match(new URL(image.member, marker));
          if (match) {
            const chunk = await match.blob();
            const body = chunk.slice(image.start, image.end, image.type);
            return new Response(body, { headers: {
              'Content-Type': image.type,
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': 'sandbox',
            } });
          }
        }
      }
    } catch { /* Fall back to assets supplied by the server. */ }
    return fetch(event.request);
  })());
});
