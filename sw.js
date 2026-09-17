/**
 * Ledger — Service Worker (assets/sw.js)
 * %100 Çevrimdışı Çalışma, Stale-While-Revalidate Stratejisi
 */

const CACHE_NAME = 'ledger-spa-v1';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './db.js',
  './assets/app.css',
  './assets/app.js',
  './assets/icons.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Kendi origin'imiz: Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        // Query parametrelerini yoksay (index.html?tab=... aynı index.html önbelleğini kullanmalı)
        let cacheKey = request;
        if (request.mode === 'navigate') {
          cacheKey = './index.html';
        }

        const cachedResponse = await cache.match(cacheKey);

        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            cache.put(cacheKey, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => {
          // Ağ yoksa ve navigasyon ise index.html döndür
          if (request.mode === 'navigate') {
            return cache.match('./index.html');
          }
        });

        return cachedResponse || fetchPromise;
      })
    );
  }
});
