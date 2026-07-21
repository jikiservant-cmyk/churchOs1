const CACHE_NAME = 'pastoros-cache-v1';
const urlsToCache = [
  '/',
  '/manifest.json',
  'https://picsum.photos/seed/pastoros-icon-192/192/192',
  'https://picsum.photos/seed/pastoros-icon-512/512/512',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
