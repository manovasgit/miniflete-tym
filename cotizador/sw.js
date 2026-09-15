// Cotizador TyM — service worker
// Bumpear la versión ante CUALQUIER cambio en index.html (el CSS y el JS van inline).
const CACHE = 'mtym-cotizador-v1';
const PREFIJO = 'mtym-cotizador-';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Borra solo caches propias: las de /unidades/ y la raíz no se tocan.
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith(PREFIJO) && k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Segundo cinturón: nunca responder por fuera de /cotizador/.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes('/cotizador/')) return;

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => {
      if (e.request.mode === 'navigate') return caches.match('./index.html');
    }))
  );
});
