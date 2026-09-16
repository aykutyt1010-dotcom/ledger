/* Ledger — Service Worker (çevrimdışı çalışma)
 * Strateji: HTML/JS/CSS için ağ-öncelikli + önbellek yedeği,
 * ikonlar için önbellek-öncelikli. Sürüm değiştirince CACHE adı artırılır.
 */
const CACHE = 'ledger-v1';

const CEKIRDEK = [
  './',
  './index.html',
  './manifest.webmanifest',
  './db.js',
  './ana-sayfa/ana-sayfa.html',
  './bakiyeler/bakiyeler.html',
  './musteriler/musteriler.html',
  './raporlar/raporlar.html',
  './islem-ekle/islem-ekle.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CEKIRDEK)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((adlar) => Promise.all(adlar.filter((a) => a !== CACHE).map((a) => caches.delete(a))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const istek = event.request;
  if (istek.method !== 'GET') return;

  const url = new URL(istek.url);

  // CDN (tailwind/iconify/font) isteklerini önbelleğe al, çevrimdışıyken yedekten ver.
  const cdnMi = /cdn\.jsdelivr\.net|code\.iconify\.design|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.hostname);
  if (cdnMi) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        fetch(istek)
          .then((yanit) => {
            if (yanit && yanit.ok) cache.put(istek, yanit.clone());
            return yanit;
          })
          .catch(() => cache.match(istek))
      )
    );
    return;
  }

  // Kendi dosyalarımız: önce ağı dene, olmazsa önbellek.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(istek)
        .then((yanit) => {
          const kopya = yanit.clone();
          caches.open(CACHE).then((cache) => cache.put(istek, kopya));
          return yanit;
        })
        .catch(() => caches.match(istek).then((eslesme) => eslesme || caches.match('./index.html')))
    );
  }
});
