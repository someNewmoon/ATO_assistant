// Retire the service worker registered by earlier versions of local card-art import.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim().then(() => self.registration.unregister()));
});
