// Reparto TyM — mapas (Leaflet + tiles de OpenStreetMap)

var Mapa = (function () {
  function crear(el, opts) {
    var m = L.map(el, Object.assign({ zoomControl: true, attributionControl: true }, opts || {}))
      .setView(CONFIG.CENTRO_MAPA, 12);
    L.tileLayer(CONFIG.TILES, { maxZoom: 19, attribution: CONFIG.TILES_ATRIB }).addTo(m);
    return m;
  }

  function icono(texto, clase) {
    return L.divIcon({
      className: 'pin ' + (clase || ''),
      html: '<span><b>' + U.esc(texto) + '</b></span>',
      iconSize: [32, 32], iconAnchor: [16, 30], popupAnchor: [0, -28],
    });
  }

  function iconoBase() { return icono('⌂', 'pin-base'); }

  // Mapa de confirmación: un pin arrastrable + puntos de las otras coincidencias
  function Confirmar(el) {
    this.m = crear(el);
    this.pin = null;
    this.otras = L.layerGroup().addTo(this.m);
  }
  Confirmar.prototype.mostrar = function (lat, lng, alMover) {
    var self = this;
    if (!this.pin) {
      this.pin = L.marker([lat, lng], { draggable: true, icon: icono('●', 'pin-sel'), autoPan: true }).addTo(this.m);
      this.pin.on('dragend', function () {
        var p = self.pin.getLatLng();
        if (self._alMover) self._alMover(p.lat, p.lng);
      });
      // Tocar el mapa también mueve el pin (más fácil que arrastrar con una mano)
      this.m.on('click', function (e) {
        self.pin.setLatLng(e.latlng);
        if (self._alMover) self._alMover(e.latlng.lat, e.latlng.lng);
      });
    }
    this._alMover = alMover;
    this.pin.setLatLng([lat, lng]);
    this.m.setView([lat, lng], 17);
  };
  Confirmar.prototype.alternativas = function (lista, alElegir) {
    this.otras.clearLayers();
    var self = this;
    lista.forEach(function (c, i) {
      L.circleMarker([c.lat, c.lng], { radius: 7, color: '#8b0000', weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .on('click', function () { alElegir(i); })
        .addTo(self.otras);
    });
  };
  Confirmar.prototype.ajustar = function () {
    var m = this.m;
    setTimeout(function () { m.invalidateSize(); }, 60);
  };

  // Mapa del recorrido: base, paradas numeradas por estado y la línea
  function Recorrido(el) {
    this.m = crear(el);
    this.capa = L.layerGroup().addTo(this.m);
    this.yo = null;
  }
  Recorrido.prototype.dibujar = function (base, paradas, linea, alTocar) {
    var cl = this.capa;
    cl.clearLayers();
    var limites = [];
    if (linea && linea.length > 1) {
      L.polyline(linea, { color: '#c0392b', weight: 5, opacity: 0.8 }).addTo(cl);
    }
    if (base) {
      L.marker([base.lat, base.lng], { icon: iconoBase(), zIndexOffset: -100 }).addTo(cl).bindPopup('Sucursal');
      limites.push([base.lat, base.lng]);
    }
    paradas.forEach(function (p, i) {
      if (p.lat == null) return;
      var mk = L.marker([p.lat, p.lng], { icon: icono(String(i + 1), 'pin-' + p.estado + (p.prioridad === 'urgente' ? ' pin-urgente' : '')) }).addTo(cl);
      mk.bindPopup('<b>' + (i + 1) + '. ' + U.esc(p.direccion) + '</b>' + (p.cliente_final ? '<br>' + U.esc(p.cliente_final) : ''));
      if (alTocar) mk.on('click', function () { alTocar(p.id); });
      limites.push([p.lat, p.lng]);
    });
    if (limites.length) this.m.fitBounds(limites, { padding: [36, 36], maxZoom: 16 });
  };
  Recorrido.prototype.miPosicion = function (lat, lng) {
    if (!this.yo) {
      this.yo = L.circleMarker([lat, lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(this.m);
    } else this.yo.setLatLng([lat, lng]);
  };
  Recorrido.prototype.ajustar = function () {
    var m = this.m;
    setTimeout(function () { m.invalidateSize(); }, 60);
  };

  return { Confirmar: Confirmar, Recorrido: Recorrido };
})();
