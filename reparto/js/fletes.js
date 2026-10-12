// Reparto TyM — fletes del fletero (etapa 3)
// Los fletes los crea el admin (panel o Unidades). Acá el fletero los ve, navega al retiro y a la
// entrega, y va marcando el estado. Los cambios viajan por la misma cola que las paradas.
//
//   Fletes.iniciar(usuario, alCambiar) → empieza a traer los fletes del servidor
//   Fletes.render(contenedor)          → dibuja la lista
//   Fletes.refrescar()                 → vuelve a pedirlos ya

var Fletes = (function () {
  var $ = U.$, $$ = U.$$, esc = U.esc;

  var ESTADOS = {
    asignado: 'Asignado', en_camino: 'En camino al retiro', cargando: 'Cargando', en_viaje: 'En viaje',
    realizado: 'Realizado', no_realizado: 'No realizado', cancelado: 'Cancelado',
  };
  // Qué botón principal corresponde a cada estado
  var SIGUIENTE = {
    asignado: ['en_camino', '🚚 Salgo hacia el retiro'],
    en_camino: ['cargando', '📦 Llegué, estoy cargando'],
    cargando: ['en_viaje', '➤ Salgo con la carga'],
    en_viaje: ['realizado', '✓ Descarga terminada'],
  };
  var ANTERIOR = { en_camino: 'asignado', cargando: 'en_camino', en_viaje: 'cargando', realizado: 'en_viaje', no_realizado: null };
  var ABIERTOS = ['asignado', 'en_camino', 'cargando', 'en_viaje'];
  var MOTIVOS = ['Cliente ausente', 'No entra / no se puede cargar', 'El cliente canceló', 'Problema con la unidad', 'Otro'];

  var usuario = null;
  var contenedor = null;
  var alCambiar = null;
  var trayendo = false;
  var verTerminados = false;

  function lista() { return Store.leer('fletes', []); }
  function guardarLista(l) { Store.escribir('fletes', l); }
  function buscar(id) { return lista().filter(function (f) { return f.id === id; })[0] || null; }

  function iniciar(u, cb) {
    usuario = u;
    alCambiar = cb;
    refrescar();
    setInterval(function () { if (!document.hidden) refrescar(); }, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(); });
    window.addEventListener('online', refrescar);
    // Al tocar una notificación con la app abierta, el service worker avisa
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.tipo === 'refrescar') refrescar();
    });
  }

  // Trae los fletes del servidor. Si hay un cambio local que todavía no llegó (está en la cola),
  // se respeta el local: si no, el chofer vería "volver atrás" lo que acaba de marcar.
  function refrescar() {
    if (trayendo || !Api.activa()) return Promise.resolve();
    trayendo = true;
    return Api.llamar('fletes.mios', {}).then(function (r) {
      if (!r.ok) return;
      var locales = {};
      lista().forEach(function (f) { locales[f.id] = f; });
      var vistos = Store.leer('fletes_vistos', null);
      var primeraVez = vistos === null;
      vistos = vistos || [];
      var nuevos = [];
      var res = r.fletes.map(function (f) {
        var l = locales[f.id];
        if (l && f.estado !== 'cancelado' && (l.actualizado_ts || 0) > (f.actualizado_ts || 0)) return l;
        if (vistos.indexOf(f.id) < 0 && ABIERTOS.indexOf(f.estado) >= 0) nuevos.push(f);
        return f;
      });
      guardarLista(res);
      Store.escribir('fletes_vistos', res.map(function (f) { return f.id; }).concat(vistos).slice(0, 200));
      if (nuevos.length && !primeraVez) {
        U.vibrar([200, 100, 200]);
        U.toast(nuevos.length === 1 ? '🔔 Tenés un flete nuevo: ' + nuevos[0].cliente : '🔔 Tenés ' + nuevos.length + ' fletes nuevos', 5000);
      }
      if (alCambiar) alCambiar();
    }).catch(function () { /* sin señal: se muestra lo guardado */ })
      .finally(function () { trayendo = false; });
  }

  function cuando(f) {
    var hoy = U.hoy();
    var man = new Date(Date.now() + 86400000);
    var manStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(man);
    var dia = f.fecha === hoy ? 'Hoy' : f.fecha === manStr ? 'Mañana' : f.fecha.split('-').reverse().slice(0, 2).join('/');
    return dia + (f.hora ? ' ' + f.hora : '');
  }

  function direccion(dir, loc) { return [dir, loc].filter(Boolean).join(', '); }

  function render(c) {
    contenedor = c;
    var l = lista();
    var abiertos = l.filter(function (f) { return ABIERTOS.indexOf(f.estado) >= 0; })
      .sort(function (a, b) { return (a.fecha + (a.hora || '99')).localeCompare(b.fecha + (b.hora || '99')); });
    var cerrados = l.filter(function (f) { return ABIERTOS.indexOf(f.estado) < 0; })
      .sort(function (a, b) { return (b.actualizado_ts || 0) - (a.actualizado_ts || 0); });

    var html = window.Push ? Push.aviso() : '';
    if (!abiertos.length) {
      html += '<div class="vacio"><div class="vacio-icono">🚚</div><h2>Sin fletes pendientes</h2>' +
        '<p>Cuando te asignen uno, aparece acá.</p>' +
        '<button class="btn btn-sec" id="fl-actualizar">Actualizar</button></div>';
    }
    html += abiertos.map(tarjeta).join('');
    if (cerrados.length) {
      html += '<button class="btn-link" id="fl-ver-cerrados">' + (verTerminados ? 'Ocultar' : 'Ver') + ' terminados y cancelados (' + cerrados.length + ')</button>';
      if (verTerminados) html += cerrados.map(tarjeta).join('');
    }
    c.innerHTML = html;
    conectar(c);
  }

  function tarjeta(f) {
    var abierto = ABIERTOS.indexOf(f.estado) >= 0;
    var sig = SIGUIENTE[f.estado];
    var horas = ['asignado', 'en_camino', 'cargando', 'en_viaje', 'realizado', 'no_realizado', 'cancelado']
      .filter(function (e) { return f['hora_' + e]; })
      .map(function (e) { return '<li>' + ESTADOS[e] + ': ' + U.hora(f['hora_' + e]) + '</li>'; }).join('');
    var tel = String(f.telefono || '').replace(/[^\d+]/g, '');
    var wa = tel ? 'https://wa.me/' + (tel.indexOf('54') === 0 ? tel : '549' + tel.replace(/^0/, '').replace(/^15/, '')) : '';
    return '<section class="tarjeta flete est-fl-' + f.estado + '" data-id="' + esc(f.id) + '">' +
      '<div class="fl-cab"><span class="fl-cuando">' + esc(cuando(f)) + '</span>' +
      '<span class="chip chip-fl-' + f.estado + '">' + ESTADOS[f.estado] + '</span></div>' +
      '<h3 class="fl-cliente">' + esc(f.cliente) + '</h3>' +
      (f.estado === 'cancelado' ? '<p class="txt-mal">Cancelado por el administrador' + (f.motivo ? ': ' + esc(f.motivo) : '') + '</p>' : '') +
      (f.estado === 'no_realizado' && f.motivo ? '<p class="txt-mal">' + esc(f.motivo) + '</p>' : '') +
      '<div class="fl-tramo"><div class="fl-tramo-tit">Retiro</div><div class="fl-dir">' + esc(direccion(f.dir_retiro, f.loc_retiro)) + '</div>' +
      (abierto ? '<button class="btn btn-sec btn-chico" data-nav="retiro">➤ Navegar al retiro</button>' : '') + '</div>' +
      '<div class="fl-tramo"><div class="fl-tramo-tit">Entrega</div><div class="fl-dir">' + esc(direccion(f.dir_entrega, f.loc_entrega)) + '</div>' +
      (abierto ? '<button class="btn btn-sec btn-chico" data-nav="entrega">➤ Navegar a la entrega</button>' : '') + '</div>' +
      (f.telefono ? '<div class="fl-tel">📞 ' + esc(f.telefono) +
        (abierto ? ' <a class="btn-mini-link" href="tel:' + esc(tel) + '">Llamar</a>' + (wa ? ' <a class="btn-mini-link" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '') : '') + '</div>' : '') +
      (f.nota ? '<div class="nota">' + esc(f.nota).replace(/\n/g, '<br>') + '</div>' : '') +
      (sig ? '<button class="btn btn-pri btn-grande" data-paso="' + sig[0] + '">' + sig[1] + '</button>' : '') +
      (abierto ? '<button class="btn btn-borde" data-no>✗ No se pudo hacer</button>' : '') +
      (ANTERIOR[f.estado] !== undefined && f.estado !== 'cancelado' ? '<button class="btn-link chico" data-atras>Me equivoqué: volver al paso anterior</button>' : '') +
      (horas ? '<ul class="horas">' + horas + '</ul>' : '') +
      '</section>';
  }

  function conectar(c) {
    var b = $('#fl-actualizar', c);
    if (b) b.addEventListener('click', function () { U.toast('Buscando…'); refrescar(); });
    var vc = $('#fl-ver-cerrados', c);
    if (vc) vc.addEventListener('click', function () { verTerminados = !verTerminados; render(contenedor); });
    $$('.flete', c).forEach(function (card) {
      var id = card.dataset.id;
      $$('[data-nav]', card).forEach(function (bt) { bt.addEventListener('click', function () { navegar(id, bt.dataset.nav); }); });
      $$('[data-paso]', card).forEach(function (bt) { bt.addEventListener('click', function () { marcar(id, bt.dataset.paso); }); });
      $$('[data-no]', card).forEach(function (bt) { bt.addEventListener('click', function () { noRealizado(id); }); });
      $$('[data-atras]', card).forEach(function (bt) {
        bt.addEventListener('click', function () {
          var f = buscar(id);
          var ant = f && (f.estado === 'no_realizado' ? ultimoAbierto(f) : ANTERIOR[f.estado]);
          if (!ant) return;
          if (!confirm('¿Volver a "' + ESTADOS[ant] + '"?')) return;
          marcar(id, ant, '', true);
        });
      });
    });
  }

  function ultimoAbierto(f) {
    var r = 'asignado';
    ['en_camino', 'cargando', 'en_viaje'].forEach(function (e) { if (f['hora_' + e]) r = e; });
    return r;
  }

  function navegar(id, tramo) {
    var f = buscar(id);
    if (!f) return;
    var app = Store.navApp() || 'google';
    var lat = f['lat_' + tramo], lng = f['lng_' + tramo];
    var url = lat != null && lng != null
      ? Routing.linkNavegacion(lat, lng, app)
      : Routing.linkNavegacionTexto(direccion(f['dir_' + tramo], f['loc_' + tramo]), app);
    window.open(url, '_blank');
  }

  // Cambia el estado, guarda la hora y lo manda por la cola (funciona sin señal)
  function marcar(id, estado, motivo, deshacer) {
    var l = lista();
    var f = l.filter(function (x) { return x.id === id; })[0];
    if (!f || f.estado === 'cancelado') return;
    // Al deshacer se borra la hora del paso que se deja (si no, el panel mostraría algo que no pasó)
    if (deshacer) f['hora_' + f.estado] = '';
    f.estado = estado;
    if (!deshacer && estado !== 'asignado') f['hora_' + estado] = U.ahoraISO();
    if (estado === 'no_realizado') f.motivo = motivo || '';
    else if (deshacer) f.motivo = '';
    f.actualizado_ts = Date.now();
    guardarLista(l);
    Store.avisarCambio('flete', {
      id: f.id, estado: f.estado, motivo: f.motivo || '',
      hora_en_camino: f.hora_en_camino || '', hora_cargando: f.hora_cargando || '', hora_en_viaje: f.hora_en_viaje || '',
      hora_realizado: f.hora_realizado || '', hora_no_realizado: f.hora_no_realizado || '',
      actualizado_ts: f.actualizado_ts,
    });
    U.vibrar(60);
    if (!deshacer) U.toast(ESTADOS[estado] + ' ✓');
    if (alCambiar) alCambiar();
  }

  function noRealizado(id) {
    var elegido = null;
    Hoja.abrir('<h2>No se pudo hacer el flete</h2>' +
      '<div class="opciones">' + MOTIVOS.map(function (m, i) {
        return '<button class="btn btn-sec" data-m="' + i + '">' + esc(m) + '</button>';
      }).join('') + '</div>' +
      '<label class="campo"><span>Detalle</span><textarea id="fl-det" rows="2" placeholder="Contá qué pasó"></textarea></label>' +
      '<button class="btn btn-mal btn-grande" id="fl-no-ok" disabled>Confirmar</button>' +
      '<button class="btn-link" data-cerrar>Cancelar</button>');
    $$('[data-m]').forEach(function (b) {
      b.addEventListener('click', function () {
        elegido = MOTIVOS[+b.dataset.m];
        $$('[data-m]').forEach(function (x) { x.classList.toggle('btn-pri', x === b); x.classList.toggle('btn-sec', x !== b); });
        $('#fl-no-ok').disabled = false;
      });
    });
    $('#fl-no-ok').addEventListener('click', function () {
      var det = $('#fl-det').value.trim();
      if (elegido === 'Otro' && !det) { U.toast('Contá qué pasó en el detalle'); return; }
      Hoja.cerrar();
      marcar(id, 'no_realizado', elegido + (det ? ': ' + det : ''));
    });
  }

  function pendientes() { return lista().filter(function (f) { return ABIERTOS.indexOf(f.estado) >= 0; }).length; }

  return { iniciar: iniciar, render: render, refrescar: refrescar, pendientes: pendientes };
})();
