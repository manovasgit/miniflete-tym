// Cotizador TyM — service worker
// Bumpear la versión ante CUALQUIER cambio en index.html (el CSS y el JS van inline).
const CACHE = 'mtym-cotizador-v2';
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

// Repone los assets que falten. El install corre una sola vez por versión de SW,
// así que sin esto una cache vaciada por otra app queda incompleta hasta el próximo bump.
async function reponerFaltantes() {
  try {
    const c = await caches.open(CACHE);
    const faltan = [];
    for (const a of ASSETS) if (!(await c.match(a))) faltan.push(a);
    if (faltan.length) await c.addAll(faltan);
  } catch (err) { /* sin conexión: se reintenta en la próxima apertura */ }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Segundo cinturón: nunca responder por fuera de /cotizador/.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes('/cotizador/')) return;

  if (e.request.mode === 'navigate') e.waitUntil(reponerFaltantes());

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      // Se guarda lo que baja de la red: si alguien vacia la cache, se repuebla
      // sola sin esperar a que cambie la version del SW.
      if (res && res.ok && res.type === 'basic') {
        const copia = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
      }
      return res;
    }).catch(() => {
      if (e.request.mode === 'navigate') return caches.match('./index.html');
    }))
  );
});
