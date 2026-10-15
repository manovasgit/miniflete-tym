// Reparto TyM — service worker
// Subir la versión ante CUALQUIER cambio (y CONFIG.VERSION en js/config.js a la par).
const CACHE = 'mtym-reparto-v3.2.0';
const PREFIJO = 'mtym-reparto-';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/config.js',
  './js/util.js',
  './js/store.js',
  './js/routing.js',
  './js/mapa.js',
  './js/ui.js',
  './js/api.js',
  './js/sesion.js',
  './js/push.js',
  './js/fletes.js',
  './js/reparto.js',
  './panel.html',
  './js/panel.js',
  './js/admin.js',
  './js/fletes-admin.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
// Librerías de CDN (versión fija): se cachean para abrir sin señal
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.concat(LIBS))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Borra solo caches propias: las de /unidades/ y /cotizador/ no se tocan.
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

  // Librerías del CDN: primero la cache
  if (LIBS.includes(url.href)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }

  // Cualquier otra cosa de afuera (mapas, rutas, Apps Script) va directo a la red
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes('/reparto/')) return;

  // Archivos de la app: primero la red (siempre lo último). Si no hay señal, o la red tarda
  // más de 4 s y hay copia guardada, la cache: en la calle la señal suele ser mala.
  const esNav = e.request.mode === 'navigate';
  const deCache = () => caches.match(e.request, esNav ? { ignoreSearch: true } : undefined)
    .then(r => r || (esNav ? caches.match('./index.html') : undefined));
  const red = fetch(e.request).then(res => {
    if (res && res.ok && res.type === 'basic' && !(esNav && url.search)) {
      const copia = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copia));
    }
    return res;
  });
  const lenta = new Promise(r => setTimeout(r, 4000)).then(deCache);
  e.respondWith(Promise.race([
    red.catch(deCache),
    lenta.then(c => c || red),
  ]).then(r => r || red));
});

// ── Notificaciones push (Firebase manda solo datos; la notificación la arma el service worker) ──
self.addEventListener('push', e => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || j.notification || j; } catch (err) { /* sin datos */ }
  const titulo = d.titulo || d.title || 'Reparto TyM';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.cuerpo || d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: d.id || 'reparto',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { tipo: d.tipo || '', id: d.id || '' },
  }));
});

// Tocar la notificación abre la app (o la trae al frente y le pide que refresque)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ventanas => {
    for (const w of ventanas) {
      if (w.url.includes('/reparto/') && !w.url.includes('panel.html')) {
        w.postMessage({ tipo: 'refrescar' });
        return w.focus();
      }
    }
    return self.clients.openWindow('./');
  }));
});
