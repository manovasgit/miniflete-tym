// App de propuestas: OBSOLETA. Este SW ya no cachea nada.
//
// Su scope era /miniflete-tym/, o sea que se metia en /unidades/ y /cotizador/,
// y su activate borraba TODAS las caches del dominio. Quedan equipos con el
// registrado de antes, asi que en vez de borrar el archivo (un 404 tarda en
// limpiarse) lo dejamos autodestruirse: borra sus propias caches y se desregistra.
//
// No agregar un handler de fetch: sin el, los pedidos van directo a la red y cada
// app se queda con su propio SW, que tiene el scope mas especifico.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // Solo las propias (mftym-). Ojo: las de unidades y cotizador son mtym-, no mftym-.
    await Promise.all(keys.filter(k => k.startsWith('mftym-')).map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(c.url).catch(() => {}));
  })());
});
