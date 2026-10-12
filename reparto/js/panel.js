// Reparto TyM — panel de seguimiento. Cambia según el rol:
//   sucursal → los repartos de su sucursal, día por día
//   dueño    → todas sus sucursales + resumen mensual
//   admin    → todo, más administración de usuarios, clientes y sucursales
// Lo que se ve lo decide el servidor: el panel solo muestra lo que el script le devuelve.

(function () {
  var $ = U.$, $$ = U.$$, esc = U.esc;
  var PAGOS = { efectivo: 'Efectivo', debito: 'Débito', credito: 'Crédito', transferencia: 'Transferencia', cta_cte: 'Cta. cte.', otro: 'Otro' };
  var ESTADOS = { pendiente: 'Pendiente', en_camino: 'En camino', entregado: 'Entregado', no_entregado: 'No entregado' };
  var EST_REPARTO = { armado: 'Armado', en_curso: 'En curso', finalizado: 'Finalizado' };
  var MOTIVOS = { ausente: 'Ausente', dir_incorrecta: 'Dirección incorrecta', rechazo: 'Rechazó', otro: 'Otro' };
  var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var REFRESCO = 30000;

  var st = {
    usuario: null, rol: null, tab: 'dia',
    fecha: U.hoy(), mes: U.hoy().slice(0, 7), cliente: '',
    dia: null, mesDatos: null, cargando: false, abiertos: {}, clientes: [],
  };

  document.addEventListener('DOMContentLoaded', function () {
    $('#version').textContent = CONFIG.VERSION;
    if (!Api.activa()) {
      $('#p-vista').innerHTML = '<div class="vacio"><h2>Falta configurar el servidor</h2><p>Cargá la URL del Apps Script en js/config.js.</p></div>';
      return;
    }
    Sesion.exigir('panel').then(arrancar);
  });

  function rolPanel(u) {
    if (u.roles.indexOf('admin') >= 0) return 'admin';
    if (u.roles.indexOf('duenio') >= 0) return 'duenio';
    if (u.roles.indexOf('sucursal') >= 0) return 'sucursal';
    return null;
  }

  function arrancar(u) {
    st.usuario = u;
    st.rol = rolPanel(u);
    var suc = u.sucursal && st.rol === 'sucursal' && U.normalizar(u.sucursal.nombre) !== U.normalizar(u.nombre_mostrar) ? ' · ' + u.sucursal.nombre : '';
    $('#p-quien').textContent = u.nombre_mostrar + suc;
    $('#p-quien').hidden = false;
    $('#p-menu').hidden = false;
    $('#p-menu').addEventListener('click', menu);

    if (!st.rol) {
      $('#p-vista').innerHTML = '<div class="vacio"><h2>Hola, ' + esc(u.nombre_mostrar) + '</h2>' +
        '<p>Este panel es para las sucursales, los dueños y la administración.</p>' +
        '<a class="btn btn-pri" href="./">Ir a la app de reparto</a></div>';
      return;
    }

    var tabs = st.rol === 'admin' ? ['dia', 'mes', 'admin'] : st.rol === 'duenio' ? ['dia', 'mes'] : ['dia'];
    var guardada = Store.leer('panel_tab', 'dia');
    st.tab = tabs.indexOf(guardada) >= 0 ? guardada : 'dia';
    var nombres = { dia: 'Día', mes: 'Resumen del mes', admin: 'Administración' };
    if (tabs.length > 1) {
      $('#p-tabs').innerHTML = tabs.map(function (t) { return '<button data-t="' + t + '">' + nombres[t] + '</button>'; }).join('');
      $('#p-tabs').hidden = false;
      $$('#p-tabs button').forEach(function (b) {
        b.addEventListener('click', function () { cambiarTab(b.dataset.t); });
      });
    }

    // Barra de fecha
    $('#p-fecha').value = st.fecha;
    $('#p-fecha').addEventListener('change', function () { if ($('#p-fecha').value) { st.fecha = $('#p-fecha').value; cargarDia(true); } });
    $('#p-ant').addEventListener('click', function () { moverDia(-1); });
    $('#p-sig').addEventListener('click', function () { moverDia(1); });
    $('#p-hoy').addEventListener('click', function () { st.fecha = U.hoy(); $('#p-fecha').value = st.fecha; cargarDia(true); });
    $('#p-mes').value = st.mes;
    $('#p-mes').addEventListener('change', function () { if ($('#p-mes').value) { st.mes = $('#p-mes').value; cargarMes(true); } });
    $('#p-mes-ant').addEventListener('click', function () { moverMes(-1); });
    $('#p-mes-sig').addEventListener('click', function () { moverMes(1); });

    if (st.rol === 'admin') {
      Api.llamar('admin.datos', {}).then(function (r) {
        if (!r.ok) return;
        st.clientes = r.clientes.filter(function (c) { return c.activo; });
        var ops = '<option value="">Todos los clientes</option>' + st.clientes.map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.nombre) + '</option>';
        }).join('');
        ['#p-cliente', '#p-cliente-mes'].forEach(function (sel) {
          var s = $(sel);
          s.innerHTML = ops;
          s.hidden = st.clientes.length < 2;
          s.addEventListener('change', function () {
            st.cliente = s.value;
            $('#p-cliente').value = $('#p-cliente-mes').value = st.cliente;
            if (st.tab === 'dia') cargarDia(true); else cargarMes(true);
          });
        });
      });
    }

    cambiarTab(st.tab);
    setInterval(refrescoAutomatico, REFRESCO);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescoAutomatico(); });
  }

  function cambiarTab(t) {
    st.tab = t;
    Store.escribir('panel_tab', t);
    $$('#p-tabs button').forEach(function (b) { b.classList.toggle('activa', b.dataset.t === t); });
    $('#p-barra-fecha').hidden = t !== 'dia';
    $('#p-barra-mes').hidden = t !== 'mes';
    if (t === 'dia') cargarDia(true);
    else if (t === 'mes') cargarMes(true);
    else Admin.mostrar($('#p-vista'));
  }

  function refrescoAutomatico() {
    if (document.hidden || Hoja.abierta() || Ubicador.abierto() || st.cargando) return;
    if (st.tab === 'dia') cargarDia(false);
    else if (st.tab === 'mes') cargarMes(false);
  }

  function moverDia(n) {
    var d = new Date(st.fecha + 'T12:00:00-03:00');
    d.setDate(d.getDate() + n);
    st.fecha = d.toISOString().slice(0, 10);
    $('#p-fecha').value = st.fecha;
    cargarDia(true);
  }

  function moverMes(n) {
    var a = st.mes.split('-').map(Number);
    var d = new Date(Date.UTC(a[0], a[1] - 1 + n, 15));
    st.mes = d.toISOString().slice(0, 7);
    $('#p-mes').value = st.mes;
    cargarMes(true);
  }

  function errorVista(msg) {
    $('#p-vista').innerHTML = '<div class="vacio"><p class="txt-mal">' + esc(msg) + '</p>' +
      '<button class="btn btn-sec" id="p-reint">Reintentar</button></div>';
    $('#p-reint').addEventListener('click', function () { cambiarTab(st.tab); });
  }

  // ── Día ────────────────────────────────────────────────────────────────
  function cargarDia(conAviso) {
    if (conAviso) $('#p-vista').innerHTML = '<div class="vacio"><div class="rueda"></div></div>';
    st.cargando = true;
    var pedida = st.fecha;
    return Api.llamar('panel.dia', { fecha: st.fecha, cliente_id: st.cliente || undefined })
      .then(function (r) {
        if (st.tab !== 'dia' || pedida !== st.fecha) return;
        if (!r.ok) { if (r.codigo !== 'auth') errorVista(r.error); return; }
        st.dia = r;
        $('#p-actualizado').textContent = 'Actualizado ' + U.hora(new Date());
        renderDia();
      })
      .catch(function () {
        $('#p-actualizado').textContent = 'Sin conexión · reintenta solo';
        if (conAviso && !st.dia) errorVista('Sin conexión con el servidor.');
      })
      .finally(function () { st.cargando = false; });
  }

  function horaEstado(p) {
    if (p.estado === 'entregado') return U.hora(p.hora_entregado);
    if (p.estado === 'no_entregado') return U.hora(p.hora_no_entregado);
    if (p.estado === 'en_camino') return U.hora(p.hora_en_camino);
    return p.eta ? '~' + p.eta : '';
  }

  function contar(paradas) {
    var c = { total: paradas.length, ent: 0, no: 0, pend: 0 };
    paradas.forEach(function (p) {
      if (p.estado === 'entregado') c.ent++;
      else if (p.estado === 'no_entregado') c.no++;
      else c.pend++;
    });
    return c;
  }

  function tiras(c, extra) {
    return '<div class="p-tiras">' +
      (extra || '') +
      '<div class="p-tira"><b>' + c.total + '</b><span>paradas</span></div>' +
      '<div class="p-tira p-ok"><b>' + c.ent + '</b><span>entregadas</span></div>' +
      '<div class="p-tira p-mal"><b>' + c.no + '</b><span>no entregadas</span></div>' +
      '<div class="p-tira"><b>' + c.pend + '</b><span>pendientes</span></div>' +
      '</div>';
  }

  function renderDia() {
    var d = st.dia;
    var esHoy = d.fecha === U.hoy();
    var html = '';
    var totalReps = d.repartos.length;
    var c = contar(d.paradas);
    var fechaTxt = fechaLarga(d.fecha);

    html += '<h2 class="p-titulo">' + (esHoy ? 'Hoy, ' : '') + fechaTxt + '</h2>';
    html += tiras(c, st.rol !== 'sucursal' ? '<div class="p-tira"><b>' + totalReps + '</b><span>repartos</span></div>' : '');

    // Resumen por sucursal (dueño y admin)
    if (st.rol !== 'sucursal' && d.sucursales.length > 1) {
      html += '<div class="p-tabla-envuelta"><table class="p-tabla"><thead><tr><th>Sucursal</th><th>Repartidor</th><th>Inicio</th><th>Fin</th><th>Entreg.</th><th>No ent.</th><th>Pend.</th></tr></thead><tbody>';
      d.sucursales.forEach(function (s) {
        var reps = d.repartos.filter(function (r) { return r.sucursal_id === s.id; });
        if (!reps.length) {
          html += '<tr class="p-vacia"><td>' + esc(s.nombre) + '</td><td colspan="6">Sin reparto</td></tr>';
          return;
        }
        reps.forEach(function (r) {
          var cc = contar(d.paradas.filter(function (p) { return p.reparto_id === r.id; }));
          html += '<tr><td>' + esc(s.nombre) + '</td><td>' + esc(r.repartidor) + '</td>' +
            '<td>' + (U.hora(r.hora_inicio) || '—') + '</td><td>' + (U.hora(r.hora_fin) || '—') + '</td>' +
            '<td class="p-ok">' + cc.ent + '</td><td class="p-mal">' + cc.no + '</td><td>' + cc.pend + '</td></tr>';
        });
      });
      html += '</tbody></table></div>';
    }

    // Detalle: sucursal → reparto → paradas
    d.sucursales.forEach(function (s) {
      var reps = d.repartos.filter(function (r) { return r.sucursal_id === s.id; });
      if (d.sucursales.length > 1) html += '<h3 class="p-suc">' + esc(s.nombre) + '</h3>';
      if (!reps.length) {
        html += '<p class="ayuda p-sin">' + (esHoy ? 'Todavía no salió ningún reparto.' : 'Sin repartos este día.') + '</p>';
        return;
      }
      reps.forEach(function (r) { html += tarjetaReparto(r, d.paradas.filter(function (p) { return p.reparto_id === r.id; })); });
    });
    if (!d.sucursales.length) html += '<div class="vacio"><p>No hay sucursales para mostrar.</p></div>';

    var y = window.scrollY;
    $('#p-vista').innerHTML = html;
    window.scrollTo(0, y);
    $$('details.p-reparto').forEach(function (det) {
      det.addEventListener('toggle', function () { st.abiertos[det.dataset.id] = det.open; });
    });
  }

  function tarjetaReparto(r, paradas) {
    paradas.sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
    var c = contar(paradas);
    var pct = c.total ? Math.round(c.ent / c.total * 100) : 0;
    var abierto = st.abiertos[r.id] !== undefined ? st.abiertos[r.id] : (st.rol === 'sucursal' || st.dia.repartos.length <= 2);
    return '<details class="tarjeta p-reparto" data-id="' + esc(r.id) + '"' + (abierto ? ' open' : '') + '>' +
      '<summary>' +
      '<div class="p-rep-cab"><strong>' + esc(r.repartidor || 'Repartidor') + '</strong>' +
      '<span class="chip chip-r-' + r.estado + '">' + EST_REPARTO[r.estado] + '</span></div>' +
      '<div class="p-rep-sub">' +
      'Inicio ' + (U.hora(r.hora_inicio) || '—') + ' · Fin ' + (U.hora(r.hora_fin) || '—') +
      (r.km_estimados ? ' · ' + U.km(r.km_estimados * 1000) : '') + '</div>' +
      '<div class="progreso-txt"><strong>' + c.ent + ' de ' + c.total + '</strong> entregadas' +
      (c.no ? ' · <span class="txt-mal">' + c.no + ' no entregada' + (c.no > 1 ? 's' : '') + '</span>' : '') + '</div>' +
      '<div class="barra-prog"><div style="width:' + pct + '%"></div></div>' +
      '</summary>' +
      '<ol class="p-paradas">' + paradas.map(function (p, i) {
        return '<li class="p-parada est-' + p.estado + '">' +
          '<span class="num">' + (i + 1) + '</span>' +
          '<div class="parada-txt"><div class="parada-dir">' + esc(p.direccion) + '</div>' +
          '<div class="parada-sub">' + esc([p.localidad, p.cliente_final].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="chips">' +
          (p.prioridad === 'urgente' ? '<span class="chip chip-urgente">Urgente</span>' : '') +
          (p.prioridad === 'hora' && p.hora_limite ? '<span class="chip chip-hora' + (p.aviso_horario && p.estado === 'pendiente' ? ' chip-tarde' : '') + '">Antes de ' + esc(p.hora_limite) + '</span>' : '') +
          '<span class="chip chip-pago">' + esc(p.metodo_pago === 'otro' && p.metodo_pago_detalle ? p.metodo_pago_detalle : PAGOS[p.metodo_pago] || '') + '</span>' +
          '</div>' +
          (p.estado === 'no_entregado' ? '<div class="txt-mal chico">' + esc(MOTIVOS[p.motivo] || '') + (p.motivo_detalle ? ': ' + esc(p.motivo_detalle) : '') + '</div>' : '') +
          (p.nota ? '<div class="ayuda chico">' + esc(p.nota) + '</div>' : '') +
          '</div>' +
          '<div class="parada-der"><span class="chip chip-p-' + p.estado + '">' + ESTADOS[p.estado] + '</span>' +
          '<span class="hora">' + horaEstado(p) + '</span></div></li>';
      }).join('') + '</ol></details>';
  }

  function fechaLarga(f) {
    var d = new Date(f + 'T12:00:00-03:00');
    var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return dias[d.getUTCDay()] + ' ' + d.getUTCDate() + ' de ' + meses[d.getUTCMonth()];
  }

  // ── Mes ────────────────────────────────────────────────────────────────
  function cargarMes(conAviso) {
    if (conAviso) $('#p-vista').innerHTML = '<div class="vacio"><div class="rueda"></div></div>';
    st.cargando = true;
    var pedido = st.mes;
    return Api.llamar('panel.mes', { mes: st.mes, cliente_id: st.cliente || undefined })
      .then(function (r) {
        if (st.tab !== 'mes' || pedido !== st.mes) return;
        if (!r.ok) { if (r.codigo !== 'auth') errorVista(r.error); return; }
        st.mesDatos = r;
        renderMes();
      })
      .catch(function () { if (conAviso) errorVista('Sin conexión con el servidor.'); })
      .finally(function () { st.cargando = false; });
  }

  function renderMes() {
    var m = st.mesDatos;
    var sucNom = {};
    m.sucursales.forEach(function (s) { sucNom[s.id] = s.nombre; });
    var tot = { reps: m.repartos.length, total: 0, ent: 0, no: 0 };
    var porDia = {}, porSuc = {};
    m.repartos.forEach(function (r) {
      tot.total += r.total_paradas || 0; tot.ent += r.entregadas || 0; tot.no += r.no_entregadas || 0;
      (porDia[r.fecha] = porDia[r.fecha] || []).push(r);
      var s = porSuc[r.sucursal_id] = porSuc[r.sucursal_id] || { reps: 0, total: 0, ent: 0, no: 0 };
      s.reps++; s.total += r.total_paradas || 0; s.ent += r.entregadas || 0; s.no += r.no_entregadas || 0;
    });
    var pct = function (e, t) { return t ? Math.round(e / t * 100) + '%' : '—'; };

    var a = m.mes.split('-');
    var meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    var html = '<h2 class="p-titulo">' + meses[+a[1] - 1] + ' ' + a[0] + '</h2>';
    html += '<div class="p-tiras">' +
      '<div class="p-tira"><b>' + tot.reps + '</b><span>repartos</span></div>' +
      '<div class="p-tira"><b>' + tot.total + '</b><span>paradas</span></div>' +
      '<div class="p-tira p-ok"><b>' + tot.ent + '</b><span>entregadas</span></div>' +
      '<div class="p-tira p-mal"><b>' + tot.no + '</b><span>no entregadas</span></div>' +
      '<div class="p-tira"><b>' + pct(tot.ent, tot.total) + '</b><span>efectividad</span></div></div>';

    if (!m.repartos.length) {
      $('#p-vista').innerHTML = html + '<div class="vacio"><p>Sin repartos en este mes.</p></div>';
      return;
    }

    if (m.sucursales.length > 1) {
      html += '<h3 class="p-suc">Por sucursal</h3><div class="p-tabla-envuelta"><table class="p-tabla"><thead><tr><th>Sucursal</th><th>Repartos</th><th>Paradas</th><th>Entreg.</th><th>No ent.</th><th>Efect.</th></tr></thead><tbody>' +
        m.sucursales.map(function (s) {
          var x = porSuc[s.id] || { reps: 0, total: 0, ent: 0, no: 0 };
          return '<tr><td>' + esc(s.nombre) + '</td><td>' + x.reps + '</td><td>' + x.total + '</td><td class="p-ok">' + x.ent + '</td><td class="p-mal">' + x.no + '</td><td>' + pct(x.ent, x.total) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }

    html += '<h3 class="p-suc">Por día</h3><div class="p-tabla-envuelta"><table class="p-tabla p-tabla-dias"><thead><tr><th>Día</th><th>Sucursal</th><th>Repartidor</th><th>Inicio</th><th>Fin</th><th>Paradas</th><th>Entreg.</th><th>No ent.</th></tr></thead><tbody>';
    Object.keys(porDia).sort().reverse().forEach(function (f) {
      var reps = porDia[f].sort(function (x, y) { return String(sucNom[x.sucursal_id]).localeCompare(String(sucNom[y.sucursal_id])); });
      var dt = new Date(f + 'T12:00:00-03:00');
      var sum = { total: 0, ent: 0, no: 0 };
      reps.forEach(function (r, i) {
        sum.total += r.total_paradas || 0; sum.ent += r.entregadas || 0; sum.no += r.no_entregadas || 0;
        html += '<tr' + (i === 0 ? ' class="p-dia-ini"' : '') + '>' +
          (i === 0 ? '<td rowspan="' + (reps.length + (reps.length > 1 ? 1 : 0)) + '"><a href="#" class="p-ir-dia" data-f="' + f + '">' + DIAS[dt.getUTCDay()] + ' ' + dt.getUTCDate() + '</a></td>' : '') +
          '<td>' + esc(sucNom[r.sucursal_id] || '') + '</td><td>' + esc(r.repartidor) + '</td>' +
          '<td>' + (U.hora(r.hora_inicio) || '—') + '</td><td>' + (U.hora(r.hora_fin) || '—') + '</td>' +
          '<td>' + (r.total_paradas || 0) + '</td><td class="p-ok">' + (r.entregadas || 0) + '</td><td class="p-mal">' + (r.no_entregadas || 0) + '</td></tr>';
      });
      if (reps.length > 1) {
        html += '<tr class="p-subtotal"><td colspan="4">Total del día</td><td>' + sum.total + '</td><td class="p-ok">' + sum.ent + '</td><td class="p-mal">' + sum.no + '</td></tr>';
      }
    });
    html += '</tbody></table></div><p class="ayuda">Tocá un día para ver el detalle parada por parada.</p>';

    $('#p-vista').innerHTML = html;
    $$('.p-ir-dia').forEach(function (aEl) {
      aEl.addEventListener('click', function (e) {
        e.preventDefault();
        st.fecha = aEl.dataset.f;
        $('#p-fecha').value = st.fecha;
        cambiarTab('dia');
      });
    });
  }

  // ── Menú ───────────────────────────────────────────────────────────────
  function menu() {
    var u = st.usuario;
    var esChofer = u.roles.indexOf('repartidor') >= 0 || u.roles.indexOf('fletero') >= 0;
    Hoja.abrir('<h2>' + esc(u.nombre_mostrar) + '</h2>' +
      '<p class="ayuda">' + esc(u.roles.map(function (r) {
        return { admin: 'Administrador', repartidor: 'Repartidor', fletero: 'Fletero', sucursal: 'Sucursal', duenio: 'Dueño' }[r];
      }).join(' · ')) + (u.cliente ? ' — ' + esc(u.cliente.nombre) : '') + '</p>' +
      (esChofer ? '<a class="btn btn-sec" href="./">Ir a la app de reparto</a>' : '') +
      '<button class="btn btn-borde" id="m-salir">Cerrar sesión</button>' +
      '<p class="ayuda centro">Versión ' + CONFIG.VERSION + '</p>' +
      '<button class="btn-link" data-cerrar>Cerrar</button>');
    $('#m-salir').addEventListener('click', function () { Sesion.salir(); });
  }
})();
