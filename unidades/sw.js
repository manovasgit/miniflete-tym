const CACHE = 'mtym-unidades-v42';
const PREFIJO = 'mtym-unidades-';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './storage.js',
  './calculations.js',
  './comanda.js',
  './sheets.js',
  './gmail.js',
  './reparto-link.js',
  './nube.js',
  './manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // Solo caches propias: las de /cotizador/ y otras apps del dominio no se tocan.
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith(PREFIJO) && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.matchAll({ includeUncontrolled: true }))
      .then(clients => clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' })))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network-first para JS: siempre busca la versión más nueva
  if (e.request.url.endsWith('.js')) {
    e.respondWith(
      fetch(e.request)
        // La copia se saca ANTES de devolver la respuesta: después el cuerpo ya está consumido
        .then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
