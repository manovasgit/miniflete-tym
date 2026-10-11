// Reparto TyM — piezas de interfaz compartidas por la app y el panel:
// hoja inferior, pantalla de "calculando…" y ubicador (confirmar una dirección en el mapa).
// Necesita en el HTML: #hoja-fondo, #hoja y el bloque #ubicador.

var Hoja = (function () {
  var $ = U.$, $$ = U.$$;

  function abrir(html, alta) {
    var h = $('#hoja');
    h.innerHTML = '<div class="hoja-asa"></div>' + html;
    h.classList.toggle('hoja-alta', !!alta);
    h.hidden = false;
    $('#hoja-fondo').hidden = false;
    $$('[data-cerrar]', h).forEach(function (b) { b.addEventListener('click', cerrar); });
    h.scrollTop = 0;
    return h;
  }

  function cerrar() {
    $('#hoja').hidden = true;
    $('#hoja-fondo').hidden = true;
    $('#hoja').innerHTML = '';
  }

  function abierta() { return !$('#hoja').hidden; }

  function cargando(msg) {
    var el = $('#cargando');
    if (!msg) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'cargando';
      el.className = 'cargando';
      document.body.appendChild(el);
    }
    el.innerHTML = '<div class="rueda"></div><p>' + U.esc(msg) + '</p>';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var f = $('#hoja-fondo');
    if (f) f.addEventListener('click', cerrar);
  });

  return { abrir: abrir, cerrar: cerrar, abierta: abierta, cargando: cargando };
})();

var Ubicador = (function () {
  var $ = U.$, $$ = U.$$, esc = U.esc;
  var u = { mapa: null, cands: [], sel: null, dir: '', loc: '', alOk: null, osmPedido: false, listo: false };

  function iniciar() {
    if (u.listo) return;
    u.listo = true;
    $('#ubi-volver').addEventListener('click', cerrar);
    $('#ubi-ok').addEventListener('click', function () {
      if (!u.sel) return;
      var g = u.sel, cb = u.alOk;
      cerrar();
      cb(g);
    });
    $('#ubi-mas').addEventListener('click', function () {
      if (u.osmPedido) return;
      u.osmPedido = true;
      $('#ubi-mas').textContent = 'Buscando…';
      Routing.geocodificarOSM(u.dir, u.loc).then(function (osm) {
        var nuevas = osm.filter(function (o) {
          return !u.cands.some(function (c) { return Math.abs(c.lat - o.lat) < 1e-4 && Math.abs(c.lng - o.lng) < 1e-4; });
        });
        u.cands = u.cands.filter(function (c) { return !c.cache; }).concat(nuevas);
        $('#ubi-mas').hidden = true;
        if (!nuevas.length) U.toast('No hay más coincidencias. Mové el pin a mano.');
        pintar();
        if (!u.sel && u.cands.length) elegir(0);
      });
    });
  }

  // Abre el mapa para confirmar dónde queda la dirección. alOk recibe {lat, lng, etiqueta, fuente}.
  function abrir(dir, loc, actual, alOk) {
    iniciar();
    u.dir = dir; u.loc = loc; u.alOk = alOk; u.cands = []; u.sel = null; u.osmPedido = false;
    $('#ubicador').hidden = false;
    $('#ubi-mas').hidden = false;
    $('#ubi-mas').textContent = 'Buscar más opciones';
    $('#ubi-ok').disabled = true;
    $('#ubi-ayuda').textContent = 'Tocá o arrastrá el pin para corregir.';
    $('#ubi-lista').innerHTML = '<p class="ayuda">Buscando ' + esc(dir) + '…</p>';
    if (!u.mapa) u.mapa = new Mapa.Confirmar($('#ubi-mapa'));
    u.mapa.ajustar();

    if (actual) {
      u.cands = [{ lat: actual.lat, lng: actual.lng, etiqueta: 'Ubicación guardada', fuente: actual.fuente || 'manual' }];
      pintar();
      elegir(0);
      return;
    }
    Routing.geocodificar(dir, loc).then(function (lista) {
      if ($('#ubicador').hidden) return;
      u.cands = lista;
      if (!lista.length) {
        $('#ubi-lista').innerHTML = '<p class="txt-mal">No encontré la dirección. Probá "Buscar más opciones" o mové el pin al lugar correcto.</p>';
        u.mapa.mostrar(CONFIG.CENTRO_MAPA[0], CONFIG.CENTRO_MAPA[1], mover);
        u.mapa.m.setZoom(12);
        u.sel = null;
        return;
      }
      pintar();
      elegir(0);
    });
  }

  function mover(lat, lng) {
    u.sel = { lat: lat, lng: lng, etiqueta: 'Marcada a mano', fuente: 'manual' };
    $('#ubi-ok').disabled = false;
    $$('#ubi-lista .cand').forEach(function (x) { x.classList.remove('sel'); });
    $('#ubi-ayuda').textContent = '📍 Pin movido a mano.';
  }

  function aproximada(c) {
    return c.precision === 'calle' ? ' <small class="txt-mal">(sin altura exacta: revisá el pin)</small>' : '';
  }

  function pintar() {
    var l = $('#ubi-lista');
    if (u.cands.length <= 1 && u.cands[0] && !u.cands[0].cache) {
      l.innerHTML = '<div class="cand sel">' + esc(u.cands[0].etiqueta) + aproximada(u.cands[0]) + '</div>';
    } else {
      l.innerHTML = u.cands.map(function (c, i) {
        return '<button class="cand" data-i="' + i + '">' + esc(c.etiqueta) + (c.cache ? ' <small>(ya usada antes)</small>' : '') + aproximada(c) + '</button>';
      }).join('');
      $$('.cand', l).forEach(function (b) { b.addEventListener('click', function () { elegir(+b.dataset.i); }); });
    }
    u.mapa.alternativas(u.cands, elegir);
  }

  function elegir(i) {
    var c = u.cands[i];
    if (!c) return;
    u.sel = { lat: c.lat, lng: c.lng, etiqueta: c.etiqueta, fuente: c.fuente };
    $$('#ubi-lista .cand').forEach(function (x) { x.classList.toggle('sel', +x.dataset.i === i); });
    $('#ubi-ayuda').textContent = 'Tocá o arrastrá el pin para corregir.';
    $('#ubi-ok').disabled = false;
    u.mapa.mostrar(c.lat, c.lng, mover);
  }

  function cerrar() { $('#ubicador').hidden = true; }
  function abierto() { return !$('#ubicador').hidden; }

  return { abrir: abrir, cerrar: cerrar, abierto: abierto };
})();

// Botón "atrás" de Android: cierra lo que esté abierto en vez de salir de la app
(function () {
  window.addEventListener('popstate', function () {
    if (window.Ubicador && document.getElementById('ubicador') && Ubicador.abierto()) { Ubicador.cerrar(); history.pushState(null, ''); return; }
    if (document.getElementById('hoja') && Hoja.abierta()) { Hoja.cerrar(); history.pushState(null, ''); }
  });
  history.pushState(null, '');
})();
