// Service Worker for BRUR Bus Driver PWA
const CACHE = 'brur-driver-v1';

// Cache the driver page assets on install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(['/driver.html', '/js/driver.js'])
    )
  );
});

// Serve from cache when offline, fetch when online
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});