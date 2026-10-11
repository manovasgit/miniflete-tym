// Reparto TyM — pantallas del chofer (etapa 1: reparto local)

(function () {
  var $ = U.$, $$ = U.$$, esc = U.esc;

  var PAGOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', cta_cte: 'Cuenta corriente', otro: 'Otro' };
  var ESTADOS = { pendiente: 'Pendiente', en_camino: 'En camino', entregado: 'Entregado', no_entregado: 'No entregado' };
  var MOTIVOS = { ausente: 'Ausente', dir_incorrecta: 'Dirección incorrecta', rechazo: 'Rechazó', otro: 'Otro' };
  var EST_REPARTO = { armado: 'Armado', en_curso: 'En curso', finalizado: 'Finalizado' };
  var LOC_GBA = ['Vicente López', 'Olivos', 'Florida', 'Munro', 'Martínez', 'San Isidro', 'Beccar', 'Boulogne',
    'San Fernando', 'Tigre', 'San Martín', 'Villa Ballester', 'Tres de Febrero', 'Caseros', 'Ciudadela',
    'Hurlingham', 'Ituzaingó', 'Morón', 'Haedo', 'Castelar', 'La Matanza', 'Ramos Mejía', 'San Justo',
    'Avellaneda', 'Sarandí', 'Wilde', 'Lanús', 'Lomas de Zamora', 'Banfield', 'Quilmes', 'Bernal',
    'Almirante Brown', 'Adrogué', 'Esteban Echeverría', 'Ezeiza', 'San Miguel', 'Malvinas Argentinas',
    'José C. Paz', 'Pilar', 'Escobar', 'Merlo', 'Moreno', 'Berazategui', 'Florencio Varela'];

  var mapaRec = null;       // Mapa.Recorrido (se crea la primera vez que se muestra)
  var verMapa = false;
  var ocupado = false;      // evita dos cálculos de recorrido a la vez
  var sortable = null;
  var ultimoFinalizado = null;
  var usuario = null;       // etapa 2: usuario logueado (null si la app corre sin backend)
  var abrirHoja = Hoja.abrir, cerrarHoja = Hoja.cerrar, cargando = Hoja.cargando;

  // ── Arranque ───────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    $('#version').textContent = CONFIG.VERSION;
    $('#btn-ajustes').addEventListener('click', abrirAjustes);
    var h = Store.historial()[0];
    if (h && h.fecha === U.hoy()) ultimoFinalizado = h;
    if (!Api.activa()) { render(); return; }
    Sesion.exigir('chofer').then(arrancar);
  });

  function arrancar(u) {
    usuario = u;
    if (u.roles.indexOf('repartidor') < 0) { renderSinReparto(); return; }
    // Si el celular tiene un reparto de otro usuario (celular compartido), no se mezcla
    var r = Store.reparto();
    if (r && r.repartidor_id && r.repartidor_id !== u.id) {
      Store.borrar('actual');
      Store.borrar('cola');
    }
    Api.iniciarCola();
    Api.alEstado(pintarSync);
    render();
    // En segundo plano: datos frescos del usuario (la base la puede haber cambiado el admin)
    // y, si el celular perdió el reparto del día, se recupera del servidor
    Sesion.refrescar().then(function (nu) {
      if (nu) usuario = nu;
      if (!Store.reparto()) return recuperarDelServidor();
    }).then(function () { render(); });
  }

  function recuperarDelServidor() {
    return Api.llamar('mis.repartos', { fecha: U.hoy() }).then(function (res) {
      if (!res.ok || Store.reparto()) return;
      var abierto = res.repartos.filter(function (r) { return r.estado !== 'finalizado'; })[0];
      if (!abierto) return;
      var r = Object.assign({}, abierto, { paradas: [], geometria: null, ruta_vieja: true });
      r.paradas = res.paradas.filter(function (p) { return p.reparto_id === r.id; });
      Store.escribir('actual', r);
      U.toast('Se recuperó tu reparto de hoy del servidor');
    }).catch(function () { /* sin señal: se sigue con lo local */ });
  }

  // Usuarios sin rol de repartidor (fletero, sucursal, dueño, admin solo)
  function renderSinReparto() {
    var panel = ['admin', 'duenio', 'sucursal'].some(function (r) { return usuario.roles.indexOf(r) >= 0; });
    var fletero = usuario.roles.indexOf('fletero') >= 0;
    $('#vista').innerHTML = '<div class="vacio">' +
      '<h2>Hola, ' + esc(usuario.nombre_mostrar) + '</h2>' +
      (fletero ? '<p>Acá te van a aparecer los fletes que te asignen.</p>' : '') +
      (panel ? '<p>Tu usuario es para el panel de seguimiento.</p><a class="btn btn-pri btn-grande" href="panel.html">Ir al panel</a>' : '') +
      '<button class="btn-link" id="btn-salir">Cerrar sesión</button></div>';
    $('#btn-salir').addEventListener('click', function () { Sesion.salir(); });
  }

  // Indicador de envío al servidor, en la barra de arriba
  function pintarSync(e) {
    var el = $('#chip-sync');
    if (!el) return;
    var txt = '', cls = '';
    if (e.estado === 'sin_senal') { txt = e.pendientes ? 'Sin señal · ' + e.pendientes : 'Sin señal'; cls = 'sync-mal'; }
    else if (e.estado === 'error') { txt = 'Error al enviar'; cls = 'sync-mal'; }
    else if (e.pendientes) { txt = 'Enviando ' + e.pendientes; cls = 'sync-pend'; }
    else { txt = '✓ Al día'; cls = 'sync-ok'; }
    el.textContent = txt;
    el.className = 'chip-sync ' + cls;
    el.title = e.error || '';
    el.hidden = false;
  }

  // La base viene de la sucursal del repartidor (la carga el admin). Si todavía no está, la local.
  function base() {
    var s = usuario && usuario.sucursal;
    if (s && s.lat != null) {
      return { direccion: s.direccion + (s.localidad ? ', ' + s.localidad : ''), lat: s.lat, lng: s.lng, servidor: true, nombre: s.nombre };
    }
    return Store.ajustes().base;
  }

  function repartoOCrear() {
    var r = Store.reparto();
    if (r) return r;
    r = Store.nuevoReparto(base());
    if (usuario) {
      r.repartidor_id = usuario.id;
      r.cliente_id = usuario.cliente_id;
      r.sucursal_id = usuario.sucursal_id;
      Store.guardarReparto(r);
    }
    return r;
  }

  // Paradas con el orden visible: primero las cerradas (en el orden en que se hicieron), después las pendientes
  function ordenadas(r) { return Store.paradasVivas(r); }
  function pendientes(r) {
    return ordenadas(r).filter(function (p) { return p.estado === 'pendiente' || p.estado === 'en_camino'; });
  }
  function proxima(r) {
    var pend = pendientes(r);
    for (var i = 0; i < pend.length; i++) if (pend[i].estado === 'en_camino') return pend[i];
    return pend[0] || null;
  }
  function numero(r, p) { return ordenadas(r).indexOf(p) + 1; }

  // ── Render principal ───────────────────────────────────────────────────
  function render() {
    var r = Store.reparto();
    var chip = $('#chip-estado');
    var v = $('#vista');

    if (sortable) { sortable.destroy(); sortable = null; }
    estacionarMapa();

    if (!base()) {
      chip.hidden = true;
      mostrarMapa(false);
      v.innerHTML =
        '<div class="vacio">' +
        '<div class="vacio-icono">⌂</div>' +
        '<h2>Primero, tu base</h2>' +
        (usuario
          ? '<p>Tu sucursal todavía no tiene cargada la dirección de la base. Pedile al administrador que la cargue en el panel.</p>' +
            '<button class="btn btn-sec" id="btn-base">Usar una base provisoria</button>'
          : '<p>El recorrido sale de la base y vuelve a ella. Cargá la dirección una sola vez.</p>' +
            '<button class="btn btn-pri" id="btn-base">Cargar dirección de la base</button>') +
        '</div>';
      $('#btn-base').addEventListener('click', editarBase);
      return;
    }

    if (!r) {
      chip.hidden = true;
      mostrarMapa(false);
      v.innerHTML = (ultimoFinalizado ? resumenFinal(ultimoFinalizado) : '') +
        '<div class="vacio">' +
        '<h2>' + (ultimoFinalizado ? 'Reparto cerrado' : 'Nuevo reparto') + '</h2>' +
        '<p>Base: ' + esc(base().direccion) + '</p>' +
        '<button class="btn btn-pri btn-grande" id="btn-agregar">+ Agregar parada</button>' +
        '</div>';
      $('#btn-agregar').addEventListener('click', function () { abrirFormParada(null); });
      return;
    }

    chip.hidden = false;
    chip.textContent = EST_REPARTO[r.estado];
    chip.className = 'chip chip-' + r.estado;

    var lista = ordenadas(r);
    var hechas = lista.filter(function (p) { return p.estado === 'entregado' || p.estado === 'no_entregado'; });
    var pend = pendientes(r);
    var prox = proxima(r);
    var hayRuta = r.hora_armado && !r.ruta_vieja;
    var html = '';

    // Resumen y progreso
    var pct = lista.length ? Math.round(r.entregadas / lista.length * 100) : 0;
    html += '<section class="tarjeta resumen">' +
      '<div class="progreso-txt"><strong>' + r.entregadas + ' de ' + lista.length + '</strong> entregadas' +
      (r.no_entregadas ? ' · <span class="txt-mal">' + r.no_entregadas + ' no entregada' + (r.no_entregadas > 1 ? 's' : '') + '</span>' : '') +
      '</div>' +
      '<div class="barra-prog"><div style="width:' + pct + '%"></div></div>' +
      (r.km_estimados != null ? '<div class="totales">' +
        '<span>' + U.km(r.km_estimados * 1000) + '</span>' +
        '<span>' + U.duracion(r.min_estimados * 60) + '</span>' +
        (r.regreso ? '<span>Vuelta a base ~' + r.regreso + '</span>' : '') +
        '</div>' : '') +
      (r.fuente_tiempos === 'recta' ? '<p class="aviso-chico">Sin conexión al servidor de rutas: tiempos aproximados en línea recta.</p>' : '') +
      (r.hora_inicio ? '<p class="ayuda">Inicio ' + U.hora(r.hora_inicio) + '</p>' : '') +
      '</section>';

    if (r.ruta_vieja && pend.length) {
      html += '<div class="banner">Hay cambios en las paradas. <button class="btn-link" id="btn-recalc-b">Recalcular recorrido</button></div>';
    }

    // Avisos de horario
    var tarde = pend.filter(function (p) { return p.aviso_horario; });
    if (tarde.length && hayRuta) {
      html += '<div class="banner banner-mal">⚠ ' + (tarde.length === 1 ? 'Una parada no llega' : tarde.length + ' paradas no llegan') +
        ' a su horario: ' + tarde.map(function (p) { return numero(r, p) + ' (antes de ' + p.hora_limite + ')'; }).join(', ') + '</div>';
    }

    // Próxima parada
    if (prox && hayRuta) {
      var app = Store.navApp();
      html += '<section class="tarjeta proxima">' +
        '<div class="prox-tit">' + (prox.estado === 'en_camino' ? 'En camino a' : 'Próxima') + '</div>' +
        '<div class="prox-dir"><span class="num">' + numero(r, prox) + '</span> ' + esc(prox.direccion) + '</div>' +
        '<div class="prox-sub">' + esc([prox.localidad, prox.cliente_final].filter(Boolean).join(' · ')) + '</div>' +
        detallesChips(prox) +
        (prox.nota ? '<div class="nota">' + esc(prox.nota) + '</div>' : '') +
        '<button class="btn btn-pri btn-grande" data-nav="' + prox.id + '">➤ Navegar' + (app ? ' (' + (app === 'waze' ? 'Waze' : 'Google Maps') + ')' : '') + '</button>' +
        (app ? '<button class="btn-link" id="btn-cambiar-nav">Cambiar app de navegación</button>' : '') +
        '<div class="fila-2">' +
        '<button class="btn btn-ok" data-ok="' + prox.id + '">✓ Entregado</button>' +
        '<button class="btn btn-mal" data-no="' + prox.id + '">✗ No entregado</button>' +
        '</div></section>';
    }

    // Lista / mapa
    if (lista.length) {
      html += '<div class="tabs">' +
        '<button class="tab' + (verMapa ? '' : ' activa') + '" data-tab="lista">Lista</button>' +
        '<button class="tab' + (verMapa ? ' activa' : '') + '" data-tab="mapa">Mapa</button>' +
        '</div>';
    }
    if (!verMapa) {
      html += '<ol class="paradas" id="lista-hechas">' + hechas.map(function (p) { return itemParada(r, p, false); }).join('') + '</ol>';
      html += '<ol class="paradas" id="lista-pend">' + pend.map(function (p) { return itemParada(r, p, true); }).join('') + '</ol>';
      if (pend.length > 1 && hayRuta) html += '<p class="ayuda centro">Mantené apretado ☰ y arrastrá para cambiar el orden.</p>';
      if (!lista.length) html += '<div class="vacio"><p>Todavía no cargaste paradas.</p></div>';
    }

    // Acciones
    html += '<div class="acciones">';
    if (lista.length >= CONFIG.MAX_PARADAS) {
      html += '<p class="aviso-chico">Llegaste a ' + CONFIG.MAX_PARADAS + ' paradas, el máximo por reparto.</p>';
    } else {
      html += '<button class="btn btn-sec btn-grande" id="btn-agregar">+ Agregar parada</button>';
    }
    if (pend.length && (!r.hora_armado || r.ruta_vieja)) {
      html += '<button class="btn btn-pri btn-grande" id="btn-armar">' + (r.hora_armado ? 'Recalcular recorrido' : 'Armar recorrido') + '</button>';
    } else if (pend.length > 1 && hayRuta) {
      html += '<button class="btn btn-sec" id="btn-armar">Reoptimizar pendientes</button>';
    }
    if (r.estado === 'en_curso' || (lista.length && !pend.length)) {
      html += '<button class="btn btn-borde" id="btn-cerrar">Cerrar reparto</button>';
    } else if (r.estado === 'armado' && lista.length) {
      html += '<button class="btn-link txt-mal" id="btn-descartar">Descartar este reparto</button>';
    }
    html += '</div>';

    v.innerHTML = html;
    conectar(r);
    mostrarMapa(verMapa);
    if (verMapa) dibujarMapa(r);
  }

  function detallesChips(p) {
    var c = '';
    if (p.prioridad === 'urgente') c += '<span class="chip chip-urgente">Urgente</span>';
    if (p.prioridad === 'hora' && p.hora_limite) c += '<span class="chip chip-hora' + (p.aviso_horario ? ' chip-tarde' : '') + '">Antes de ' + esc(p.hora_limite) + '</span>';
    c += '<span class="chip chip-pago">' + esc(p.metodo_pago === 'otro' && p.metodo_pago_detalle ? p.metodo_pago_detalle : PAGOS[p.metodo_pago]) + '</span>';
    return '<div class="chips">' + c + '</div>';
  }

  function itemParada(r, p, movible) {
    var hora = p.estado === 'entregado' ? U.hora(p.hora_entregado)
      : p.estado === 'no_entregado' ? U.hora(p.hora_no_entregado)
      : (p.eta && r.hora_armado && !r.ruta_vieja ? '~' + p.eta : '');
    return '<li class="parada est-' + p.estado + '" data-id="' + p.id + '">' +
      (movible ? '<span class="asa" aria-label="Mover">☰</span>' : '') +
      '<span class="num">' + numero(r, p) + '</span>' +
      '<div class="parada-txt">' +
      '<div class="parada-dir">' + esc(p.direccion) + '</div>' +
      '<div class="parada-sub">' + esc([p.localidad, p.cliente_final].filter(Boolean).join(' · ')) + '</div>' +
      detallesChips(p) +
      (p.estado === 'no_entregado' ? '<div class="txt-mal chico">' + esc(MOTIVOS[p.motivo] || '') + (p.motivo_detalle ? ': ' + esc(p.motivo_detalle) : '') + '</div>' : '') +
      '</div>' +
      '<div class="parada-der"><span class="chip chip-p-' + p.estado + '">' + ESTADOS[p.estado] + '</span>' +
      (hora ? '<span class="hora">' + hora + '</span>' : '') +
      (p.lat == null ? '<span class="txt-mal chico">Sin ubicar</span>' : '') +
      '</div></li>';
  }

  function resumenFinal(r) {
    return '<section class="tarjeta resumen">' +
      '<h3>Último reparto</h3>' +
      '<div class="totales"><span>Inicio ' + (U.hora(r.hora_inicio) || '—') + '</span><span>Fin ' + U.hora(r.hora_fin) + '</span></div>' +
      '<div class="progreso-txt"><strong>' + r.entregadas + ' de ' + r.total_paradas + '</strong> entregadas' +
      (r.no_entregadas ? ' · <span class="txt-mal">' + r.no_entregadas + ' no entregadas</span>' : '') + '</div>' +
      '</section>';
  }

  function conectar(r) {
    var v = $('#vista');
    $$('[data-tab]', v).forEach(function (b) {
      b.addEventListener('click', function () { verMapa = b.dataset.tab === 'mapa'; render(); });
    });
    $$('[data-nav]', v).forEach(function (b) { b.addEventListener('click', function () { navegar(b.dataset.nav); }); });
    $$('[data-ok]', v).forEach(function (b) { b.addEventListener('click', function () { marcarEntregado(b.dataset.ok); }); });
    $$('[data-no]', v).forEach(function (b) { b.addEventListener('click', function () { abrirNoEntregado(b.dataset.no); }); });
    $$('.parada', v).forEach(function (li) {
      li.addEventListener('click', function (e) {
        if (e.target.closest('.asa')) return;
        abrirDetalle(li.dataset.id);
      });
    });
    var bc = $('#btn-cambiar-nav');
    if (bc) bc.addEventListener('click', function () { elegirNav(null); });
    var ba = $('#btn-agregar');
    if (ba) ba.addEventListener('click', function () { abrirFormParada(null); });
    var bar = $('#btn-armar');
    if (bar) bar.addEventListener('click', function () { armarRecorrido(); });
    var brb = $('#btn-recalc-b');
    if (brb) brb.addEventListener('click', function () { armarRecorrido(); });
    var bce = $('#btn-cerrar');
    if (bce) bce.addEventListener('click', cerrarReparto);
    var bd = $('#btn-descartar');
    if (bd) bd.addEventListener('click', function () {
      if (!confirm('¿Descartar el reparto y todas sus paradas?')) return;
      // Si ya se había mandado al servidor, se marca como eliminado para que no aparezca en los paneles
      if (r.hora_armado) { r.eliminado = true; Store.guardarReparto(r); }
      Store.borrar('actual');
      render();
    });

    var lp = $('#lista-pend');
    if (lp && window.Sortable && r.hora_armado && !r.ruta_vieja) {
      sortable = Sortable.create(lp, {
        handle: '.asa', animation: 150, delay: 120, delayOnTouchOnly: true,
        onEnd: function (ev) {
          if (ev.oldIndex === ev.newIndex) return;
          var ids = $$('.parada', lp).map(function (li) { return li.dataset.id; });
          reordenarAMano(ids);
        },
      });
    }
  }

  // ── Mapa del recorrido ─────────────────────────────────────────────────
  function mostrarMapa(si) {
    var pm = $('#panel-mapa');
    pm.hidden = !si;
    if (si) {
      // El panel va justo después de las pestañas
      var tabs = $('.tabs');
      if (tabs && tabs.nextSibling !== pm) tabs.parentNode.insertBefore(pm, tabs.nextSibling);
      if (!mapaRec) mapaRec = new Mapa.Recorrido($('#mapa-recorrido'));
      mapaRec.ajustar();
    }
  }

  // Saca el mapa de #vista antes de redibujarla (si no, innerHTML lo destruye)
  function estacionarMapa() {
    var pm = $('#panel-mapa');
    if (pm.parentNode !== document.body) document.body.insertBefore(pm, $('#hoja-fondo'));
    pm.hidden = true;
  }

  function dibujarMapa(r) {
    if (!mapaRec) return;
    var b = { lat: r.base_lat, lng: r.base_lng };
    var linea = r.ruta_vieja ? null : r.geometria;
    mapaRec.ajustar();
    setTimeout(function () { mapaRec.dibujar(b, ordenadas(r), linea, abrirDetalle); }, 80);
  }

  // ── Armar / recalcular recorrido ───────────────────────────────────────
  function armarRecorrido(opts) {
    opts = opts || {};
    var r = Store.reparto();
    if (!r || ocupado) return Promise.resolve();
    var pend = pendientes(r);
    var sinUbicar = pend.filter(function (p) { return p.lat == null; });
    if (sinUbicar.length) {
      U.toast('Falta ubicar en el mapa: ' + sinUbicar.map(function (p) { return p.direccion; }).join(', '), 4000);
      return Promise.resolve();
    }
    if (!pend.length) return Promise.resolve();

    ocupado = true;
    cargando(opts.fijo ? 'Calculando horarios…' : 'Calculando el mejor recorrido…');

    var enCurso = r.estado === 'en_curso';
    var origenP = enCurso && !opts.desdeBase ? origenActual(r, opts.usarGPS) : Promise.resolve({ lat: r.base_lat, lng: r.base_lng });

    return origenP.then(function (origen) {
      var entrada = pend.map(function (p) {
        return { id: p.id, lat: p.lat, lng: p.lng, prioridad: p.prioridad, hora_limite: p.hora_limite };
      });
      // La que está "en camino" queda primera: el chofer ya va para allá
      var enCamino = pend.filter(function (p) { return p.estado === 'en_camino'; })[0];
      var destino = { lat: r.base_lat, lng: r.base_lng };
      return Routing.optimizar({
        origen: origen, destino: destino, paradas: entrada,
        servicioMin: Store.ajustes().min_por_parada, fijo: !!opts.fijo,
        primero: enCamino ? enCamino.id : null,
      }).then(function (res) {
        var r2 = Store.reparto();
        var hechas = ordenadas(r2).filter(function (p) { return p.estado === 'entregado' || p.estado === 'no_entregado'; });
        var n = 1;
        hechas.forEach(function (p) { p.orden = n++; });
        res.orden.forEach(function (id) {
          var p = Store.parada(r2, id);
          p.orden = n++;
          p.eta = res.etas[id];
          p.aviso_horario = res.tarde.indexOf(id) >= 0;
          p.actualizado_ts = Date.now();
        });
        r2.km_estimados = Math.round(res.metros / 100) / 10;
        r2.min_estimados = Math.round(res.seg / 60);
        r2.fuente_tiempos = res.fuente;
        r2.regreso = res.regreso;
        r2.hora_armado = r2.hora_armado || U.ahoraISO();
        r2.ruta_vieja = false;
        Store.guardarReparto(r2);
        ordenadas(r2).forEach(function (p) { Store.editarParada(r2, p.id, {}); });

        var puntos = [origen].concat(res.orden.map(function (id) { var p = Store.parada(r2, id); return { lat: p.lat, lng: p.lng }; }))
          .concat([destino]);
        return Routing.geometria(puntos).then(function (g) {
          var r3 = Store.reparto();
          r3.geometria = g;
          Store.guardarReparto(r3);
          if (res.tarde.length && !opts.silencioso) U.vibrar([80, 60, 80]);
        });
      });
    }).catch(function (e) {
      console.error(e);
      U.toast('No se pudo calcular el recorrido. Probá de nuevo.');
    }).finally(function () {
      ocupado = false;
      cargando(null);
      render();
    });
  }

  // Desde dónde recalcular con el reparto en curso: GPS, o la última parada hecha, o la base
  var _ultPos = null;
  function origenActual(r, usarGPS) {
    var respaldo = function () {
      var hechas = ordenadas(r).filter(function (p) { return p.estado === 'entregado' || p.estado === 'no_entregado'; });
      hechas.sort(function (a, b) {
        return String(a['hora_' + a.estado]).localeCompare(String(b['hora_' + b.estado]));
      });
      var u = hechas[hechas.length - 1];
      if (_ultPos && Date.now() - _ultPos.t < 10 * 60000) return { lat: _ultPos.lat, lng: _ultPos.lng };
      return u ? { lat: u.lat, lng: u.lng } : { lat: r.base_lat, lng: r.base_lng };
    };
    if (usarGPS === false) return Promise.resolve(respaldo());
    return U.gps(10000).then(function (p) {
      _ultPos = { lat: p.lat, lng: p.lng, t: Date.now() };
      if (mapaRec) mapaRec.miPosicion(p.lat, p.lng);
      return { lat: p.lat, lng: p.lng };
    }).catch(function () {
      U.toast('Sin GPS: se calcula desde la última parada');
      return respaldo();
    });
  }

  function reordenarAMano(ids) {
    var r = Store.reparto();
    var hechas = ordenadas(r).filter(function (p) { return p.estado === 'entregado' || p.estado === 'no_entregado'; });
    var n = hechas.length + 1;
    ids.forEach(function (id) { Store.parada(r, id).orden = n++; });
    Store.guardarReparto(r);
    armarRecorrido({ fijo: true, usarGPS: false });
  }

  // ── Acciones sobre paradas ─────────────────────────────────────────────
  function navegar(id) {
    var app = Store.navApp();
    if (!app) { elegirNav(id); return; }
    var r = Store.reparto();
    var p = Store.parada(r, id);
    if (!p || p.lat == null) return;
    var empezaba = r.estado === 'armado';
    Store.estadoParada(r, id, 'en_camino');
    window.open(Routing.linkNavegacion(p.lat, p.lng, app), '_blank');
    // Al salir, las horas estimadas se recalculan desde ahora (sin cambiar el orden)
    if (empezaba) armarRecorrido({ fijo: true, desdeBase: true, silencioso: true });
    else render();
  }

  function elegirNav(idParaNavegar) {
    var actual = Store.navApp();
    abrirHoja('<h2>¿Con qué app navegás?</h2>' +
      '<p class="ayuda">Queda guardado. Lo podés cambiar cuando quieras.</p>' +
      '<button class="btn btn-grande ' + (actual === 'google' ? 'btn-pri' : 'btn-sec') + '" data-app="google">Google Maps</button>' +
      '<button class="btn btn-grande ' + (actual === 'waze' ? 'btn-pri' : 'btn-sec') + '" data-app="waze">Waze</button>' +
      '<button class="btn-link" data-cerrar>Cancelar</button>');
    $$('[data-app]', $('#hoja')).forEach(function (b) {
      b.addEventListener('click', function () {
        Store.guardarNavApp(b.dataset.app);
        cerrarHoja();
        if (idParaNavegar) navegar(idParaNavegar);
        else render();
      });
    });
  }

  function marcarEntregado(id) {
    var r = Store.reparto();
    var empezaba = r.estado === 'armado';
    Store.estadoParada(r, id, 'entregado');
    U.vibrar(60);
    U.toast('Entregado ✓  (tocá la parada si fue un error)');
    cerrarHoja();
    if (empezaba) armarRecorrido({ fijo: true, desdeBase: true, silencioso: true });
    else render();
    verificarFin();
  }

  function abrirNoEntregado(id) {
    var r = Store.reparto();
    var p = Store.parada(r, id);
    var elegido = null;
    abrirHoja('<h2>No entregado</h2>' +
      '<p class="ayuda">' + esc(p.direccion) + '</p>' +
      '<div class="opciones">' + Object.keys(MOTIVOS).map(function (k) {
        return '<button class="btn btn-sec" data-motivo="' + k + '">' + MOTIVOS[k] + '</button>';
      }).join('') + '</div>' +
      '<label class="campo"><span>Detalle (opcional)</span><textarea id="no-detalle" rows="2" placeholder="Ej: nadie atiende, volver a llamar"></textarea></label>' +
      '<button class="btn btn-mal btn-grande" id="no-ok" disabled>Confirmar no entregado</button>' +
      '<button class="btn-link" data-cerrar>Cancelar</button>');
    $$('[data-motivo]').forEach(function (b) {
      b.addEventListener('click', function () {
        elegido = b.dataset.motivo;
        $$('[data-motivo]').forEach(function (x) { x.classList.toggle('btn-pri', x === b); x.classList.toggle('btn-sec', x !== b); });
        $('#no-ok').disabled = false;
        if (elegido === 'otro') $('#no-detalle').focus();
      });
    });
    $('#no-ok').addEventListener('click', function () {
      var det = $('#no-detalle').value.trim();
      if (elegido === 'otro' && !det) { U.toast('Contá qué pasó en el detalle'); return; }
      var r2 = Store.reparto();
      var empezaba = r2.estado === 'armado';
      Store.estadoParada(r2, id, 'no_entregado', elegido, det);
      U.vibrar(60);
      cerrarHoja();
      if (empezaba) armarRecorrido({ fijo: true, desdeBase: true, silencioso: true });
      else render();
      verificarFin();
    });
  }

  function verificarFin() {
    var r = Store.reparto();
    if (r && r.estado === 'en_curso' && !pendientes(r).length) {
      setTimeout(function () { U.toast('¡Listo! No quedan paradas. Cerrá el reparto al volver a la base.', 4500); }, 2700);
    }
  }

  function abrirDetalle(id) {
    var r = Store.reparto();
    var p = Store.parada(r, id);
    if (!p) return;
    var abierta = p.estado === 'pendiente' || p.estado === 'en_camino';
    var horas = ['pendiente', 'en_camino', 'entregado', 'no_entregado'].filter(function (e) { return p['hora_' + e]; })
      .map(function (e) { return '<li>' + ESTADOS[e] + ': ' + U.hora(p['hora_' + e]) + '</li>'; }).join('');
    abrirHoja('<h2><span class="num">' + numero(r, p) + '</span> ' + esc(p.direccion) + '</h2>' +
      '<p class="ayuda">' + esc([p.localidad, p.cliente_final].filter(Boolean).join(' · ')) + '</p>' +
      detallesChips(p) +
      (p.nota ? '<div class="nota">' + esc(p.nota) + '</div>' : '') +
      '<ul class="horas">' + horas + '</ul>' +
      (abierta && p.lat != null ? '<button class="btn btn-pri btn-grande" data-nav="' + p.id + '">➤ Navegar</button>' +
        '<div class="fila-2"><button class="btn btn-ok" data-ok="' + p.id + '">✓ Entregado</button>' +
        '<button class="btn btn-mal" data-no="' + p.id + '">✗ No entregado</button></div>' : '') +
      (!abierta ? '<button class="btn btn-sec" id="det-reabrir">Volver a pendiente</button>' : '') +
      (abierta ? '<div class="fila-2"><button class="btn btn-sec" id="det-editar">Editar</button>' +
        '<button class="btn btn-borde txt-mal" id="det-borrar">Quitar parada</button></div>' : '') +
      '<button class="btn-link" data-cerrar>Cerrar</button>');
    var h = $('#hoja');
    $$('[data-nav]', h).forEach(function (b) { b.addEventListener('click', function () { cerrarHoja(); navegar(id); }); });
    $$('[data-ok]', h).forEach(function (b) { b.addEventListener('click', function () { marcarEntregado(id); }); });
    $$('[data-no]', h).forEach(function (b) { b.addEventListener('click', function () { abrirNoEntregado(id); }); });
    var re = $('#det-reabrir');
    if (re) re.addEventListener('click', function () {
      Store.estadoParada(Store.reparto(), id, 'pendiente');
      cerrarHoja();
      armarRecorrido({ usarGPS: true });
    });
    var ed = $('#det-editar');
    if (ed) ed.addEventListener('click', function () { abrirFormParada(id); });
    var bo = $('#det-borrar');
    if (bo) bo.addEventListener('click', function () {
      if (!confirm('¿Quitar ' + p.direccion + ' del reparto?')) return;
      var r2 = Store.reparto();
      Store.eliminarParada(r2, id);
      cerrarHoja();
      if (r2.hora_armado) armarRecorrido({ fijo: true, usarGPS: false });
      else render();
    });
  }

  function cerrarReparto() {
    var r = Store.reparto();
    var pend = pendientes(r);
    var msg = pend.length
      ? 'Quedan ' + pend.length + ' parada(s) sin marcar. Van a quedar como pendientes.\n\n¿Cerrar el reparto igual?'
      : '¿Cerrar el reparto? Hacelo al volver a la base.';
    if (!confirm(msg)) return;
    if (r.estado === 'armado') Store.iniciar(r);
    ultimoFinalizado = Store.finalizar(r);
    verMapa = false;
    U.toast('Reparto cerrado ✓');
    render();
  }

  // ── Formulario de parada ───────────────────────────────────────────────
  function opcionesLocalidad() {
    var barrios = Routing.LOCALIDADES.map(function (b) {
      return b.replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
    });
    return '<datalist id="dl-localidades">' + barrios.concat(LOC_GBA).map(function (l) {
      return '<option value="' + esc(l) + '">';
    }).join('') + '</datalist>';
  }

  function abrirFormParada(id) {
    var r = Store.reparto();
    var p = id && r ? Store.parada(r, id) : null;
    var d = p || { direccion: '', localidad: '', cliente_final: '', metodo_pago: 'efectivo', metodo_pago_detalle: '', nota: '', prioridad: 'normal', hora_limite: '' };
    var geo = p && p.lat != null ? { lat: p.lat, lng: p.lng, fuente: p.geo_fuente } : null;

    abrirHoja('<h2>' + (p ? 'Editar parada' : 'Nueva parada') + '</h2>' +
      '<form id="f-parada" autocomplete="off">' +
      '<label class="campo"><span>Dirección *</span><input id="f-dir" required placeholder="Ej: Av. Cabildo 2040" value="' + esc(d.direccion) + '"></label>' +
      '<label class="campo"><span>Localidad o barrio</span><input id="f-loc" list="dl-localidades" placeholder="Ej: Belgrano, Morón, Olivos" value="' + esc(d.localidad) + '"></label>' +
      opcionesLocalidad() +
      '<label class="campo"><span>Cliente</span><input id="f-cli" placeholder="Nombre de quien recibe" value="' + esc(d.cliente_final) + '"></label>' +
      '<div class="campo"><span>Pago</span><div class="seg" id="f-pago">' + Object.keys(PAGOS).map(function (k) {
        return '<button type="button" data-v="' + k + '" class="' + (d.metodo_pago === k ? 'sel' : '') + '">' + PAGOS[k] + '</button>';
      }).join('') + '</div>' +
      '<input id="f-pago-det" placeholder="¿Cuál?" value="' + esc(d.metodo_pago_detalle) + '"' + (d.metodo_pago === 'otro' ? '' : ' hidden') + '></div>' +
      '<div class="campo"><span>Prioridad</span><div class="seg" id="f-prio">' +
      '<button type="button" data-v="normal" class="' + (d.prioridad === 'normal' ? 'sel' : '') + '">Normal</button>' +
      '<button type="button" data-v="urgente" class="' + (d.prioridad === 'urgente' ? 'sel' : '') + '">Urgente</button>' +
      '<button type="button" data-v="hora" class="' + (d.prioridad === 'hora' ? 'sel' : '') + '">Antes de…</button>' +
      '</div><input id="f-hora" type="time" value="' + esc(d.hora_limite) + '"' + (d.prioridad === 'hora' ? '' : ' hidden') + '></div>' +
      '<label class="campo"><span>Nota</span><textarea id="f-nota" rows="2" placeholder="Timbre, horario, qué lleva…">' + esc(d.nota) + '</textarea></label>' +
      '<p id="f-geo" class="ayuda">' + (geo ? '📍 Ubicada en el mapa' : '') + '</p>' +
      '<button type="submit" class="btn btn-pri btn-grande">' + (geo ? 'Guardar' : 'Ubicar en el mapa') + '</button>' +
      (geo ? '<button type="button" class="btn btn-sec" id="f-reubicar">Ver o corregir en el mapa</button>' : '') +
      '<button type="button" class="btn-link" data-cerrar>Cancelar</button>' +
      '</form>', true);

    function segmento(sel, alCambiar) {
      $$('#' + sel + ' button').forEach(function (b) {
        b.addEventListener('click', function () {
          $$('#' + sel + ' button').forEach(function (x) { x.classList.toggle('sel', x === b); });
          alCambiar(b.dataset.v);
        });
      });
    }
    var pago = d.metodo_pago, prio = d.prioridad;
    segmento('f-pago', function (v) { pago = v; $('#f-pago-det').hidden = v !== 'otro'; if (v === 'otro') $('#f-pago-det').focus(); });
    segmento('f-prio', function (v) { prio = v; $('#f-hora').hidden = v !== 'hora'; if (v === 'hora') $('#f-hora').focus(); });

    var dirOriginal = U.normalizar(d.direccion + '|' + d.localidad);

    function datos() {
      return {
        direccion: $('#f-dir').value.trim(),
        localidad: $('#f-loc').value.trim(),
        cliente_final: $('#f-cli').value.trim(),
        metodo_pago: pago,
        metodo_pago_detalle: pago === 'otro' ? $('#f-pago-det').value.trim() : '',
        prioridad: prio,
        hora_limite: prio === 'hora' ? $('#f-hora').value : '',
        nota: $('#f-nota').value.trim(),
      };
    }

    function validar(x) {
      if (!x.direccion) { U.toast('Falta la dirección'); $('#f-dir').focus(); return false; }
      if (x.prioridad === 'hora' && !x.hora_limite) { U.toast('Poné la hora límite'); return false; }
      return true;
    }

    function guardar(x, g) {
      x.lat = g.lat; x.lng = g.lng; x.geo_fuente = g.fuente || 'manual';
      Routing.recordarGeo(x.direccion, x.localidad, g);
      var rr = repartoOCrear();
      var enCurso = rr.estado === 'en_curso';
      if (p) {
        Store.editarParada(rr, p.id, x);
      } else {
        if (Store.paradasVivas(rr).length >= CONFIG.MAX_PARADAS) { U.toast('Máximo ' + CONFIG.MAX_PARADAS + ' paradas'); return; }
        Store.nuevaParada(rr, x);
      }
      cerrarHoja();
      Ubicador.cerrar();
      rr = Store.reparto();
      if (enCurso) {
        // Con el reparto en curso se recalculan solo las pendientes, desde donde está el chofer
        U.toast(p ? 'Parada actualizada. Recalculando…' : 'Parada agregada. Recalculando desde tu ubicación…');
        armarRecorrido({ usarGPS: true });
      } else {
        if (rr.hora_armado) { rr.ruta_vieja = true; Store.guardarReparto(rr); }
        U.toast(p ? 'Parada actualizada ✓' : 'Parada agregada ✓');
        render();
      }
    }

    $('#f-parada').addEventListener('submit', function (e) {
      e.preventDefault();
      var x = datos();
      if (!validar(x)) return;
      var cambioDir = U.normalizar(x.direccion + '|' + x.localidad) !== dirOriginal;
      if (geo && !cambioDir) { guardar(x, geo); return; }
      Ubicador.abrir(x.direccion, x.localidad, null, function (g) { guardar(x, g); });
    });
    var reu = $('#f-reubicar');
    if (reu) reu.addEventListener('click', function () {
      var x = datos();
      if (!validar(x)) return;
      Ubicador.abrir(x.direccion, x.localidad, geo, function (g) { guardar(x, g); });
    });
    if (!p) setTimeout(function () { $('#f-dir').focus(); }, 250);
  }

  // ── Ajustes ────────────────────────────────────────────────────────────
  function abrirAjustes() {
    var a = Store.ajustes();
    var app = Store.navApp();
    var b = base();
    var verPanel = usuario && ['admin', 'duenio', 'sucursal'].some(function (x) { return usuario.roles.indexOf(x) >= 0; });
    abrirHoja('<h2>Ajustes</h2>' +
      (usuario ? '<div class="campo"><span>Usuario</span><p>' + esc(usuario.nombre_mostrar) +
        (usuario.sucursal ? ' · ' + esc(usuario.sucursal.nombre) : '') + '</p>' +
        (verPanel ? '<a class="btn btn-sec" href="panel.html">Ir al panel</a>' : '') +
        '<button class="btn btn-borde" id="aj-salir">Cerrar sesión</button></div>' : '') +
      '<div class="campo"><span>Base</span><p>' + (b ? esc(b.direccion) : '<em>Sin cargar</em>') +
      (b && b.servidor ? '<br><small class="ayuda">La carga el administrador desde el panel.</small>' : '') + '</p>' +
      (b && b.servidor ? '' : '<button class="btn btn-sec" id="aj-base">' + (b ? 'Cambiar base' : 'Cargar base') + '</button>') + '</div>' +
      '<label class="campo"><span>Minutos en cada parada</span><input id="aj-min" type="number" min="1" max="30" inputmode="numeric" value="' + a.min_por_parada + '"></label>' +
      '<div class="campo"><span>App para navegar</span><p>' + (app ? (app === 'waze' ? 'Waze' : 'Google Maps') : 'Se pregunta la primera vez') + '</p>' +
      '<button class="btn btn-sec" id="aj-nav">Elegir</button></div>' +
      '<button class="btn btn-pri" id="aj-ok">Guardar</button>' +
      '<p class="ayuda centro">Versión ' + CONFIG.VERSION + '</p>' +
      '<button class="btn-link txt-mal" id="aj-borrar">Borrar todos los datos de este celular</button>' +
      '<button class="btn-link" data-cerrar>Cerrar</button>');
    if ($('#aj-base')) $('#aj-base').addEventListener('click', editarBase);
    if ($('#aj-salir')) $('#aj-salir').addEventListener('click', function () {
      var n = Api.pendientes();
      if (n && !confirm('Hay ' + n + ' cambio(s) que todavía no llegaron al servidor. Si cerrás sesión se pierden. ¿Cerrar igual?')) return;
      Sesion.salir();
    });
    $('#aj-nav').addEventListener('click', function () { elegirNav(null); });
    $('#aj-ok').addEventListener('click', function () {
      var m = parseInt($('#aj-min').value, 10);
      Store.guardarAjustes({ min_por_parada: m >= 1 && m <= 30 ? m : CONFIG.MIN_POR_PARADA });
      cerrarHoja();
      U.toast('Ajustes guardados ✓');
      render();
    });
    $('#aj-borrar').addEventListener('click', function () {
      if (!confirm('Se borran el reparto actual, el historial y las direcciones guardadas de este celular. ¿Seguro?')) return;
      Store.borrarTodo();
      cerrarHoja();
      render();
    });
  }

  function editarBase() {
    var b = Store.ajustes().base || { direccion: '', localidad: '' };
    abrirHoja('<h2>Dirección de la base</h2>' +
      '<form id="f-base" autocomplete="off">' +
      '<label class="campo"><span>Dirección *</span><input id="b-dir" required placeholder="Ej: Av. Triunvirato 4500" value="' + esc(b.direccion_sola || b.direccion) + '"></label>' +
      '<label class="campo"><span>Localidad o barrio</span><input id="b-loc" list="dl-localidades" value="' + esc(b.localidad || '') + '"></label>' +
      opcionesLocalidad() +
      '<button class="btn btn-pri btn-grande" type="submit">Ubicar en el mapa</button>' +
      '<button type="button" class="btn-link" data-cerrar>Cancelar</button></form>', true);
    $('#f-base').addEventListener('submit', function (e) {
      e.preventDefault();
      var dir = $('#b-dir').value.trim(), loc = $('#b-loc').value.trim();
      if (!dir) return;
      Ubicador.abrir(dir, loc, null, function (g) {
        Routing.recordarGeo(dir, loc, g);
        Store.guardarAjustes({ base: {
          direccion: dir + (loc ? ', ' + loc : ''), direccion_sola: dir, localidad: loc, lat: g.lat, lng: g.lng,
        } });
        // Si hay un reparto armado sin empezar, toma la base nueva
        var r = Store.reparto();
        if (r && r.estado === 'armado') {
          r.base_direccion = dir; r.base_lat = g.lat; r.base_lng = g.lng;
          if (r.hora_armado) r.ruta_vieja = true;
          Store.guardarReparto(r);
        }
        cerrarHoja();
        U.toast('Base guardada ✓');
        render();
      });
    });
  }

})();
