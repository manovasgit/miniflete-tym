// Reparto TyM — datos locales del celular
// Todas las claves llevan el prefijo reparto_ (el origen se comparte con Unidades y el cotizador).
// Los campos usan los mismos nombres que las columnas del Sheet (etapa 2), así no hay que traducir.

var Store = (function () {
  var P = 'reparto_';
  var SCHEMA = 1;
  var _oyentes = [];

  function leer(clave, def) {
    try {
      var v = localStorage.getItem(P + clave);
      return v == null ? def : JSON.parse(v);
    } catch (e) { return def; }
  }
  function escribir(clave, valor) {
    try { localStorage.setItem(P + clave, JSON.stringify(valor)); }
    catch (e) { U.toast('No se pudo guardar en el celular (memoria llena)'); }
  }
  function borrar(clave) {
    try { localStorage.removeItem(P + clave); } catch (e) { /* nada */ }
  }

  // Avisa a quien escuche (etapa 2: la cola de envío al servidor) qué registro cambió
  function emitir(tipo, registro) {
    _oyentes.forEach(function (fn) {
      try { fn(tipo, registro); } catch (e) { console.error(e); }
    });
  }
  function alCambiar(fn) { _oyentes.push(fn); }

  (function migrar() {
    var v = leer('schema', 0);
    if (v < SCHEMA) escribir('schema', SCHEMA);
  })();

  // ── Ajustes ────────────────────────────────────────────────────────────
  var AJUSTES_DEF = { base: null, min_por_parada: CONFIG.MIN_POR_PARADA };
  function ajustes() { return Object.assign({}, AJUSTES_DEF, leer('ajustes', {})); }
  function guardarAjustes(a) { escribir('ajustes', Object.assign(ajustes(), a)); }

  function navApp() { return leer('nav', null); }
  function guardarNavApp(app) { escribir('nav', app); }

  // ── Reparto actual ─────────────────────────────────────────────────────
  function reparto() { return leer('actual', null); }

  function _guardar(r) {
    r.actualizado_ts = Date.now();
    escribir('actual', r);
  }

  function nuevoReparto(base) {
    var r = {
      id: U.id('rep'),
      fecha: U.hoy(),
      repartidor_id: null,     // etapa 2: usuario logueado
      cliente_id: null,
      sucursal_id: null,
      estado: 'armado',
      base_direccion: base.direccion,
      base_lat: base.lat,
      base_lng: base.lng,
      km_estimados: null,
      min_estimados: null,
      fuente_tiempos: null,
      total_paradas: 0,
      entregadas: 0,
      no_entregadas: 0,
      hora_armado: null,
      hora_inicio: null,
      hora_fin: null,
      geometria: null,         // solo local: polilínea del recorrido
      paradas: [],
    };
    _guardar(r);
    emitir('reparto', r);
    return r;
  }

  function _contar(r) {
    var vivas = r.paradas.filter(function (p) { return !p.eliminada; });
    r.total_paradas = vivas.length;
    r.entregadas = vivas.filter(function (p) { return p.estado === 'entregado'; }).length;
    r.no_entregadas = vivas.filter(function (p) { return p.estado === 'no_entregado'; }).length;
  }

  function guardarReparto(r) {
    _contar(r);
    _guardar(r);
    emitir('reparto', r);
    return r;
  }

  function nuevaParada(r, datos) {
    var ahora = U.ahoraISO();
    var p = {
      id: U.id('par'),
      reparto_id: r.id,
      cliente_id: r.cliente_id,
      sucursal_id: r.sucursal_id,
      fecha: r.fecha,
      origen: 'repartidor',
      creado_por: r.repartidor_id,
      orden: r.paradas.length + 1,
      direccion: '', localidad: '', cliente_final: '',
      metodo_pago: 'efectivo', metodo_pago_detalle: '', nota: '',
      prioridad: 'normal', hora_limite: '',
      lat: null, lng: null, geo_fuente: null,
      eta: null, aviso_horario: false,
      estado: 'pendiente', motivo: '', motivo_detalle: '',
      hora_pendiente: ahora, hora_en_camino: null, hora_entregado: null, hora_no_entregado: null,
      eliminada: false,
      actualizado_ts: Date.now(),
    };
    Object.assign(p, datos || {});
    r.paradas.push(p);
    guardarReparto(r);
    emitir('parada', p);
    return p;
  }

  function editarParada(r, id, datos) {
    var p = parada(r, id);
    if (!p) return null;
    Object.assign(p, datos);
    p.actualizado_ts = Date.now();
    guardarReparto(r);
    emitir('parada', p);
    return p;
  }

  function eliminarParada(r, id) {
    return editarParada(r, id, { eliminada: true });
  }

  function parada(r, id) {
    for (var i = 0; i < r.paradas.length; i++) if (r.paradas[i].id === id) return r.paradas[i];
    return null;
  }

  function paradasVivas(r) {
    return r.paradas.filter(function (p) { return !p.eliminada; })
      .sort(function (a, b) { return a.orden - b.orden; });
  }

  // Cambia el estado de una parada y guarda la hora. El reparto pasa solo a "en curso".
  function estadoParada(r, id, estado, motivo, detalle) {
    var p = parada(r, id);
    if (!p) return null;
    var ahora = U.ahoraISO();

    if (estado === 'en_camino') {
      // Una sola parada "en camino" a la vez: la anterior vuelve a pendiente
      r.paradas.forEach(function (o) {
        if (o.id !== id && o.estado === 'en_camino' && !o.eliminada) {
          o.estado = 'pendiente';
          o.actualizado_ts = Date.now();
          emitir('parada', o);
        }
      });
    }

    p.estado = estado;
    p['hora_' + estado] = ahora;
    if (estado === 'no_entregado') {
      p.motivo = motivo || 'otro';
      p.motivo_detalle = detalle || '';
    } else if (estado === 'pendiente') {
      p.motivo = '';
      p.motivo_detalle = '';
    }
    p.actualizado_ts = Date.now();

    if (r.estado === 'armado' && estado !== 'pendiente') iniciar(r);
    guardarReparto(r);
    emitir('parada', p);
    return p;
  }

  function iniciar(r) {
    if (r.estado !== 'armado') return;
    r.estado = 'en_curso';
    r.hora_inicio = U.ahoraISO();
  }

  function finalizar(r) {
    r.estado = 'finalizado';
    r.hora_fin = U.ahoraISO();
    guardarReparto(r);
    // Al historial (últimos 7 días) y se libera el actual
    var h = leer('historial', []);
    var copia = Object.assign({}, r);
    delete copia.geometria;
    h.unshift(copia);
    var limite = Date.now() - 7 * 86400000;
    h = h.filter(function (x) { return (x.actualizado_ts || 0) >= limite; }).slice(0, 30);
    escribir('historial', h);
    borrar('actual');
    return copia;
  }

  function historial() { return leer('historial', []); }

  // ── Cache de geocodificación ───────────────────────────────────────────
  function geoCache(clave) {
    var c = leer('geocache', {});
    return c[clave] || null;
  }
  function guardarGeoCache(clave, valor) {
    var c = leer('geocache', {});
    c[clave] = Object.assign({ t: Date.now() }, valor);
    var claves = Object.keys(c);
    if (claves.length > 600) {
      claves.sort(function (a, b) { return (c[a].t || 0) - (c[b].t || 0); });
      claves.slice(0, claves.length - 500).forEach(function (k) { delete c[k]; });
    }
    escribir('geocache', c);
  }

  function borrarTodo() {
    var claves = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(P) === 0) claves.push(k);
    }
    claves.forEach(function (k) { localStorage.removeItem(k); });
  }

  return {
    leer: leer, escribir: escribir, borrar: borrar, alCambiar: alCambiar,
    ajustes: ajustes, guardarAjustes: guardarAjustes, navApp: navApp, guardarNavApp: guardarNavApp,
    reparto: reparto, nuevoReparto: nuevoReparto, guardarReparto: guardarReparto,
    nuevaParada: nuevaParada, editarParada: editarParada, eliminarParada: eliminarParada,
    parada: parada, paradasVivas: paradasVivas, estadoParada: estadoParada,
    iniciar: iniciar, finalizar: finalizar, historial: historial,
    geoCache: geoCache, guardarGeoCache: guardarGeoCache, borrarTodo: borrarTodo,
  };
})();
