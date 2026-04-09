// Service Worker minimale per abilitare la PWA (installazione)
const CACHE_NAME = 'agenda-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Semplice pass-through: non stiamo implementando il caching offline completo qui
  // ma la presenza del service worker è necessaria per l'installabilità.
  event.respondWith(fetch(event.request).catch(() => {
    return caches.match(event.request);
  }));
});
