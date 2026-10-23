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

  // ── Lista de fletes ───────────────────────────────────────────────────
  // Cada flete es una tarjeta corta con "Cargar flete": al tocarlo se abre la pantalla del flete
  // armada como la del reparto (paradas en orden, navegar, cobro, contacto y mapa).
  var abiertoId = Store.leer('flete_abierto', null);
  var verMapaFl = false;
  var mapaFl = null;
  var geoPedido = {};

  function abrir(id) { abiertoId = id; verMapaFl = false; Store.escribir('flete_abierto', id); render(contenedor); window.scrollTo(0, 0); }
  function cerrar() { abiertoId = null; Store.escribir('flete_abierto', null); render(contenedor); window.scrollTo(0, 0); }

  function render(c) {
    contenedor = c;
    if (mapaFl) { try { mapaFl.m.remove(); } catch (e) { /* ya no estaba */ } mapaFl = null; }
    var abierto = abiertoId && buscar(abiertoId);
    if (abierto) { detalle(c, abierto); return; }
    if (abiertoId) { abiertoId = null; Store.escribir('flete_abierto', null); }

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
    var b = $('#fl-actualizar', c);
    if (b) b.addEventListener('click', function () { U.toast('Buscando…'); refrescar(); });
    var vc = $('#fl-ver-cerrados', c);
    if (vc) vc.addEventListener('click', function () { verTerminados = !verTerminados; render(contenedor); });
    $$('[data-abrir]', c).forEach(function (bt) { bt.addEventListener('click', function () { abrir(bt.dataset.abrir); }); });
  }

  function tarjeta(f) {
    var abierto = ABIERTOS.indexOf(f.estado) >= 0;
    var tot = total(f);
    return '<section class="tarjeta flete est-fl-' + f.estado + '" data-id="' + esc(f.id) + '">' +
      '<div class="fl-cab"><span class="fl-cuando">' + esc(cuando(f)) + '</span>' +
      '<span class="chip chip-fl-' + f.estado + '">' + ESTADOS[f.estado] + '</span></div>' +
      '<h3 class="fl-cliente">' + esc(f.cliente) + '</h3>' +
      (f.estado === 'cancelado' ? '<p class="txt-mal">Cancelado por el administrador' + (f.motivo ? ': ' + esc(f.motivo) : '') + '</p>' : '') +
      (f.estado === 'no_realizado' && f.motivo ? '<p class="txt-mal">' + esc(f.motivo) + '</p>' : '') +
      '<div class="fl-ruta">' + esc(f.loc_retiro || f.dir_retiro) + ' → ' + esc(f.loc_entrega || f.dir_entrega) + '</div>' +
      (tot ? '<div class="chips"><span class="chip chip-cobro">' + plata(tot) + '</span>' + (f.pago ? '<span class="chip chip-pago">' + esc(PAGO[f.pago] || f.pago) + '</span>' : '') + '</div>' : '') +
      '<button class="btn ' + (abierto ? 'btn-pri btn-grande' : 'btn-sec') + '" data-abrir="' + esc(f.id) + '">' +
      (!abierto ? 'Ver detalle' : f.estado === 'asignado' ? '▶ Cargar flete' : '▶ Seguir con el flete') + '</button>' +
      '</section>';
  }

  // ── Pantalla del flete (como la del reparto) ──────────────────────────
  var PAGO = { efectivo: 'Efectivo', transferencia: 'Transferencia' };

  function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.round(n) : 0; }
  function total(f) { return num(f.monto_camioneta) + num(f.monto_peones) + num(f.monto_adicionales); }
  function plata(n) { return '$ ' + Math.round(n).toLocaleString('es-AR'); }

  // Teléfono → links. Argentinos con el formato de siempre; los de afuera (+ y otro país) tal cual.
  function linkTel(t) { return U.linkTel(t); }
  function linkWa(t, msg) {
    var wa = U.linkWhatsApp(t, msg);
    if (wa) return wa;
    var d = String(t || '').replace(/\D/g, '');
    return /^\s*(\+|00)/.test(String(t || '')) && d.length >= 8 ? 'https://wa.me/' + d.replace(/^00/, '') + (msg ? '?text=' + encodeURIComponent(msg) : '') : '';
  }
  function contactoFl(tel, msg) {
    if (!tel) return '';
    var wa = linkWa(tel, msg);
    return '<div class="fila-2 contacto">' +
      '<a class="btn btn-sec" href="' + esc(linkTel(tel)) + '">📞 Llamar</a>' +
      (wa ? '<a class="btn btn-wa" href="' + esc(wa) + '" target="_blank" rel="noopener">WhatsApp</a>' : '<span></span>') +
      '</div>';
  }
  function mensaje(f, tramo) {
    var yo = usuario ? usuario.nombre_mostrar || usuario.nombre : '';
    var dir = tramo === 'entrega' ? f.dir_entrega : f.dir_retiro;
    return 'Hola, ¿cómo estás? ' + (yo ? 'Soy ' + yo + ', de' : 'Te escribo de') + ' Miniflete TyM. ' +
      (tramo === 'entrega' ? 'Estoy yendo con la carga a ' : 'Estoy yendo para ') + dir + '. ¡Gracias!';
  }

  // Las paradas del flete en orden. El estado de cada una sale del estado del flete.
  function geoDe(f, tramo) {
    var la = f['lat_' + tramo], ln = f['lng_' + tramo];
    if (la !== '' && la != null && ln !== '' && ln != null) return { lat: +la, lng: +ln };
    var g = (Store.leer('fletes_geo', {})[f.id] || {})[tramo];
    return g ? { lat: g.lat, lng: g.lng } : { lat: null, lng: null };
  }
  function paradasDe(f) {
    var gr = geoDe(f, 'retiro'), ge = geoDe(f, 'entrega');
    var hechoRetiro = ['en_viaje', 'realizado'].indexOf(f.estado) >= 0;
    var p = [
      { id: 'retiro', tit: 'Retiro', dir: f.dir_retiro, loc: f.loc_retiro, tel: f.telefono, lat: gr.lat, lng: gr.lng,
        hecho: hechoRetiro, hora: f.hora_en_viaje },
      { id: 'entrega', tit: 'Entrega', dir: f.dir_entrega, loc: f.loc_entrega, tel: f.telefono_entrega && f.telefono_entrega !== f.telefono ? f.telefono_entrega : '',
        lat: ge.lat, lng: ge.lng, hecho: f.estado === 'realizado', hora: f.hora_realizado },
    ];
    return p;
  }

  function detalle(c, f) {
    var abierto = ABIERTOS.indexOf(f.estado) >= 0;
    var paradas = paradasDe(f);
    var prox = !abierto ? null : f.estado === 'en_viaje' ? paradas[1] : paradas[0];
    var sig = SIGUIENTE[f.estado];
    var app = Store.navApp();
    var tot = total(f);
    var html = '<button class="btn-link fl-volver" id="fl-volver">← Mis fletes</button>';

    // Cliente, cuándo y contacto
    html += '<section class="tarjeta resumen">' +
      '<div class="fl-cab"><span class="fl-cuando">' + esc(cuando(f)) + '</span>' +
      '<span class="chip chip-fl-' + f.estado + '">' + ESTADOS[f.estado] + '</span></div>' +
      '<h2 class="fl-cliente">' + esc(f.cliente) + '</h2>' +
      (f.telefono ? '<div class="parada-sub">📞 ' + esc(f.telefono) + '</div>' + (abierto ? contactoFl(f.telefono, mensaje(f, prox ? prox.id : 'retiro')) : '') : '') +
      (f.estado === 'cancelado' ? '<p class="txt-mal">Cancelado por el administrador' + (f.motivo ? ': ' + esc(f.motivo) : '') + '</p>' : '') +
      (f.estado === 'no_realizado' && f.motivo ? '<p class="txt-mal">' + esc(f.motivo) + '</p>' : '') +
      '</section>';

    // Cobro
    if (tot || f.pago) {
      var items = [['Camioneta', num(f.monto_camioneta)], ['Peones', num(f.monto_peones)], ['Adicionales', num(f.monto_adicionales)]]
        .filter(function (x) { return x[1]; });
      html += '<section class="tarjeta fl-cobro">' +
        '<div class="prox-tit">A cobrar</div>' +
        '<div class="fl-total">' + (tot ? plata(tot) : 'Sin monto cargado') + '</div>' +
        (f.pago ? '<div class="chips"><span class="chip chip-pago">' + esc(PAGO[f.pago] || f.pago) + '</span></div>' : '') +
        (items.length > 1 ? '<ul class="fl-items">' + items.map(function (x) { return '<li><span>' + x[0] + '</span><span>' + plata(x[1]) + '</span></li>'; }).join('') + '</ul>' : '') +
        '</section>';
    }

    // Próxima parada, como en el reparto
    if (prox) {
      html += '<section class="tarjeta proxima">' +
        '<div class="prox-tit">' + (f.estado === 'asignado' ? 'Primero' : f.estado === 'cargando' ? 'Cargando en' : 'En camino a') + ' · ' + prox.tit + '</div>' +
        '<div class="prox-dir"><span class="num">' + (prox.id === 'retiro' ? 1 : 2) + '</span> ' + esc(prox.dir) + '</div>' +
        (prox.loc ? '<div class="prox-sub">' + esc(prox.loc) + '</div>' : '') +
        (prox.id === 'entrega' && prox.tel ? '<div class="prox-sub">Recibe: 📞 ' + esc(prox.tel) + '</div>' + contactoFl(prox.tel, mensaje(f, 'entrega')) : '') +
        (f.estado !== 'cargando' ? '<button class="btn btn-pri btn-grande" data-nav="' + prox.id + '">➤ Navegar' + (app ? ' (' + (app === 'waze' ? 'Waze' : 'Google Maps') + ')' : '') + '</button>' : '') +
        (sig ? '<button class="btn ' + (f.estado === 'cargando' ? 'btn-pri' : 'btn-ok') + ' btn-grande" data-paso="' + sig[0] + '">' + sig[1] + '</button>' : '') +
        '<button class="btn btn-borde" data-no>✗ No se pudo hacer</button>' +
        '</section>';
    }

    // Lista / mapa de las paradas
    html += '<div class="tabs">' +
      '<button class="tab' + (verMapaFl ? '' : ' activa') + '" data-tabfl="lista">Lista</button>' +
      '<button class="tab' + (verMapaFl ? ' activa' : '') + '" data-tabfl="mapa">Mapa</button>' +
      '</div>';
    if (verMapaFl) {
      html += '<div class="panel-mapa"><div id="fl-mapa" class="mapa"></div></div>';
    } else {
      html += '<ol class="paradas">' + paradas.map(function (p, i) {
        var est = p.hecho ? 'entregado' : prox && prox.id === p.id ? 'en_camino' : 'pendiente';
        return '<li class="parada est-' + est + '">' +
          '<span class="num">' + (i + 1) + '</span>' +
          '<div class="parada-txt">' +
          '<div class="parada-dir">' + esc(p.dir) + '</div>' +
          '<div class="parada-sub">' + esc([p.tit, p.loc, p.tel ? '📞 ' + p.tel : ''].filter(Boolean).join(' · ')) + '</div>' +
          (abierto && !p.hecho ? '<button class="btn btn-sec btn-chico" data-nav="' + p.id + '">➤ Navegar</button>' : '') +
          '</div>' +
          '<div class="parada-der"><span class="chip chip-p-' + est + '">' + (p.hecho ? 'Hecho' : est === 'en_camino' ? 'Ahora' : 'Pendiente') + '</span>' +
          (p.hecho && p.hora ? '<span class="hora">' + U.hora(p.hora) + '</span>' : '') + '</div></li>';
      }).join('') + '</ol>';
    }

    // Comanda completa y horarios
    if (f.nota) html += '<details class="tarjeta fl-comanda"><summary>Ver comanda completa</summary><div class="nota">' + esc(f.nota).replace(/\n/g, '<br>') + '</div></details>';
    var horas = ['asignado', 'en_camino', 'cargando', 'en_viaje', 'realizado', 'no_realizado', 'cancelado']
      .filter(function (e) { return f['hora_' + e]; })
      .map(function (e) { return '<li>' + ESTADOS[e] + ': ' + U.hora(f['hora_' + e]) + '</li>'; }).join('');
    if (horas) html += '<ul class="horas">' + horas + '</ul>';
    if (app) html += '<button class="btn-link" id="fl-cambiar-nav">Cambiar app de navegación</button>';
    if (ANTERIOR[f.estado] !== undefined && f.estado !== 'cancelado' && f.estado !== 'asignado') {
      html += '<button class="btn-link chico" data-atras>Me equivoqué: volver al paso anterior</button>';
    }

    c.innerHTML = html;
    var id = f.id;
    $('#fl-volver', c).addEventListener('click', cerrar);
    $$('[data-tabfl]', c).forEach(function (b) { b.addEventListener('click', function () { verMapaFl = b.dataset.tabfl === 'mapa'; render(contenedor); }); });
    $$('[data-nav]', c).forEach(function (bt) { bt.addEventListener('click', function () { navegar(id, bt.dataset.nav); }); });
    $$('[data-paso]', c).forEach(function (bt) { bt.addEventListener('click', function () { marcar(id, bt.dataset.paso); }); });
    $$('[data-no]', c).forEach(function (bt) { bt.addEventListener('click', function () { noRealizado(id); }); });
    var cn = $('#fl-cambiar-nav', c);
    if (cn) cn.addEventListener('click', function () { Store.guardarNavApp(Store.navApp() === 'waze' ? 'google' : 'waze'); U.toast('Navegación: ' + (Store.navApp() === 'waze' ? 'Waze' : 'Google Maps')); render(contenedor); });
    $$('[data-atras]', c).forEach(function (bt) {
      bt.addEventListener('click', function () {
        var fl = buscar(id);
        var ant = fl && (fl.estado === 'no_realizado' ? ultimoAbierto(fl) : ANTERIOR[fl.estado]);
        if (!ant) return;
        if (!confirm('¿Volver a "' + ESTADOS[ant] + '"?')) return;
        marcar(id, ant, '', true);
      });
    });
    if (verMapaFl) dibujarMapaFl(f);
  }

  // Mapa: si el flete no trae coordenadas, se ubican las direcciones (y quedan guardadas en el celu)
  function dibujarMapaFl(f) {
    var el = $('#fl-mapa');
    if (!el || !window.L) return;
    mapaFl = new Mapa.Recorrido(el);
    mapaFl.ajustar();
    var ps = paradasDe(f);
    function pintar() {
      if (!mapaFl) return;
      mapaFl.dibujar(null, ps.map(function (p) {
        return { id: p.id, lat: p.lat, lng: p.lng, direccion: p.tit + ': ' + p.dir, estado: p.hecho ? 'entregado' : 'pendiente' };
      }), null, null);
    }
    var faltan = ps.filter(function (p) { return p.lat == null; });
    if (!faltan.length || geoPedido[f.id]) { setTimeout(pintar, 80); return; }
    geoPedido[f.id] = true;
    Promise.all(faltan.map(function (p) {
      return Routing.geocodificar(p.dir, p.loc).then(function (r) { return r && r[0] ? r[0] : null; }).catch(function () { return null; });
    })).then(function (res) {
      var geo = Store.leer('fletes_geo', {});
      var g = geo[f.id] || {};
      faltan.forEach(function (p, i) {
        if (!res[i]) return;
        p.lat = res[i].lat; p.lng = res[i].lng;
        g[p.id] = { lat: res[i].lat, lng: res[i].lng };
      });
      geo[f.id] = g;
      var ids = lista().map(function (x) { return x.id; });
      Object.keys(geo).forEach(function (k) { if (ids.indexOf(k) < 0) delete geo[k]; });
      Store.escribir('fletes_geo', geo);
      if (faltan.some(function (p) { return p.lat == null; })) U.toast('Alguna dirección no se pudo ubicar en el mapa');
      pintar();
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
    var g = geoDe(f, tramo), lat = g.lat, lng = g.lng;
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
