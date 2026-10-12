// Reparto TyM — fletes en el panel del administrador (etapa 3)
// Crear, editar, reasignar y cancelar. Los clientes (sucursal / dueño) nunca ven esto.
//
//   FletesAdmin.cargar(contenedor, fecha, conAviso) → Promise

var FletesAdmin = (function () {
  var $ = U.$, $$ = U.$$, esc = U.esc;
  var ESTADOS = {
    asignado: 'Asignado', en_camino: 'En camino', cargando: 'Cargando', en_viaje: 'En viaje',
    realizado: 'Realizado', no_realizado: 'No realizado', cancelado: 'Cancelado',
  };
  var PASOS = ['asignado', 'en_camino', 'cargando', 'en_viaje', 'realizado', 'no_realizado', 'cancelado'];
  var cont = null, fecha = null, fletes = [], fleteros = null;

  function traerFleteros() {
    if (fleteros) return Promise.resolve(fleteros);
    return Api.llamar('fleteros', {}).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      fleteros = r.fleteros;
      return fleteros;
    });
  }

  function cargar(c, f, conAviso) {
    cont = c;
    fecha = f;
    if (conAviso) cont.innerHTML = '<div class="vacio"><div class="rueda"></div></div>';
    return Api.llamar('admin.fletes', { desde: f, hasta: f }).then(function (r) {
      if (fecha !== f) return;
      if (!r.ok) { cont.innerHTML = '<div class="vacio"><p class="txt-mal">' + esc(r.error) + '</p></div>'; return; }
      fletes = r.fletes;
      render();
      var a = $('#p-actualizado');
      if (a) a.textContent = 'Actualizado ' + U.hora(new Date());
    }).catch(function () {
      if (conAviso) cont.innerHTML = '<div class="vacio"><p class="txt-mal">Sin conexión con el servidor.</p></div>';
    });
  }

  function render() {
    var abiertos = fletes.filter(function (f) { return ['asignado', 'en_camino', 'cargando', 'en_viaje'].indexOf(f.estado) >= 0; }).length;
    var html = '<div class="p-admin-cab"><h2 class="p-titulo">Fletes</h2>' +
      '<button class="btn btn-pri btn-chico" id="fa-nuevo">+ Flete</button></div>';
    html += '<div class="p-tiras">' +
      '<div class="p-tira"><b>' + fletes.length + '</b><span>fletes</span></div>' +
      '<div class="p-tira"><b>' + abiertos + '</b><span>en curso / por hacer</span></div>' +
      '<div class="p-tira p-ok"><b>' + fletes.filter(function (f) { return f.estado === 'realizado'; }).length + '</b><span>realizados</span></div>' +
      '<div class="p-tira p-mal"><b>' + fletes.filter(function (f) { return f.estado === 'no_realizado'; }).length + '</b><span>no realizados</span></div>' +
      '</div>';
    if (!fletes.length) html += '<div class="vacio"><p>No hay fletes para este día.</p></div>';
    html += fletes.map(function (f) {
      var horas = PASOS.filter(function (e) { return f['hora_' + e]; })
        .map(function (e) { return '<span>' + ESTADOS[e] + ' ' + U.hora(f['hora_' + e]) + '</span>'; }).join(' → ');
      var cerrado = ['realizado', 'no_realizado', 'cancelado'].indexOf(f.estado) >= 0;
      return '<div class="tarjeta fa-flete' + (f.estado === 'cancelado' ? ' inactivo' : '') + '">' +
        '<div class="p-rep-cab"><strong>' + esc(f.hora || '—') + ' · ' + esc(f.cliente) + '</strong>' +
        '<span class="chip chip-fl-' + f.estado + '">' + ESTADOS[f.estado] + '</span></div>' +
        '<div class="p-rep-sub">🚚 ' + esc(f.fletero) + (f.origen === 'unidades' ? ' · <span class="chip chip-rol">desde Unidades</span>' : '') +
        (f.telefono ? ' · 📞 ' + esc(f.telefono) : '') + '</div>' +
        '<div class="fa-tramos"><div><b>Retiro:</b> ' + esc([f.dir_retiro, f.loc_retiro].filter(Boolean).join(', ')) + '</div>' +
        '<div><b>Entrega:</b> ' + esc([f.dir_entrega, f.loc_entrega].filter(Boolean).join(', ')) + '</div></div>' +
        (f.nota ? '<div class="ayuda chico fa-nota">' + esc(f.nota).replace(/\n/g, '<br>') + '</div>' : '') +
        (f.motivo ? '<div class="txt-mal chico">' + esc(f.motivo) + '</div>' : '') +
        '<div class="fa-horas">' + horas + '</div>' +
        '<div class="fa-acciones">' +
        (f.estado !== 'cancelado' ? '<button class="btn-link btn-mini" data-ed="' + esc(f.id) + '">' + (cerrado ? 'Ver / reasignar' : 'Editar o reasignar') + '</button>' : '<button class="btn-link btn-mini" data-ed="' + esc(f.id) + '">Volver a asignar</button>') +
        (!cerrado ? '<button class="btn-link btn-mini txt-mal" data-can="' + esc(f.id) + '">Cancelar flete</button>' : '') +
        '</div></div>';
    }).join('');
    cont.innerHTML = html;
    $('#fa-nuevo').addEventListener('click', function () { form(null); });
    $$('[data-ed]', cont).forEach(function (b) { b.addEventListener('click', function () { form(b.dataset.ed); }); });
    $$('[data-can]', cont).forEach(function (b) { b.addEventListener('click', function () { cancelar(b.dataset.can); }); });
  }

  function cancelar(id) {
    var f = fletes.filter(function (x) { return x.id === id; })[0];
    var motivo = prompt('¿Cancelar el flete de ' + f.cliente + '? Al fletero le llega el aviso.\n\nMotivo (opcional):', '');
    if (motivo === null) return;
    Api.llamar('admin.flete', { id: id, cancelar: true, motivo: motivo }).then(function (r) {
      if (!r.ok) { U.toast(r.error, 4000); return; }
      U.toast('Flete cancelado');
      cargar(cont, fecha, false);
    }).catch(function () { U.toast('Sin conexión. No se canceló.', 4000); });
  }

  function form(id) {
    var f = id ? fletes.filter(function (x) { return x.id === id; })[0] : null;
    var d = f || { cliente: '', telefono: '', dir_retiro: '', loc_retiro: '', dir_entrega: '', loc_entrega: '', fecha: fecha, hora: '', nota: '', fletero_id: '' };
    traerFleteros().then(function (lista) {
      Hoja.abrir('<h2>' + (f ? (f.estado === 'cancelado' ? 'Volver a asignar flete' : 'Editar flete') : 'Nuevo flete') + '</h2>' +
        (f && f.origen === 'unidades' ? '<p class="ayuda">Vino de Unidades. Si cambiás datos acá, en Unidades quedan como estaban.</p>' : '') +
        '<label class="campo"><span>Cliente *</span><input id="fa-cli" value="' + esc(d.cliente) + '"></label>' +
        '<label class="campo"><span>Teléfono</span><input id="fa-tel" type="tel" value="' + esc(d.telefono) + '"></label>' +
        '<label class="campo"><span>Dirección de retiro *</span><input id="fa-dr" value="' + esc(d.dir_retiro) + '" placeholder="Calle, altura, piso"></label>' +
        '<label class="campo"><span>Localidad o barrio del retiro</span><input id="fa-lr" value="' + esc(d.loc_retiro) + '"></label>' +
        '<label class="campo"><span>Dirección de entrega *</span><input id="fa-de" value="' + esc(d.dir_entrega) + '"></label>' +
        '<label class="campo"><span>Localidad o barrio de la entrega</span><input id="fa-le" value="' + esc(d.loc_entrega) + '"></label>' +
        '<div class="fila-2"><label class="campo"><span>Fecha *</span><input id="fa-fe" type="date" value="' + esc(d.fecha) + '"></label>' +
        '<label class="campo"><span>Hora pactada</span><input id="fa-ho" type="time" value="' + esc(d.hora) + '"></label></div>' +
        '<label class="campo"><span>Nota</span><textarea id="fa-no" rows="3" placeholder="Qué se lleva, peones, aclaraciones">' + esc(d.nota) + '</textarea></label>' +
        '<label class="campo"><span>Fletero *</span><select id="fa-fl"><option value="">Elegí…</option>' + lista.map(function (x) {
          return '<option value="' + esc(x.id) + '"' + (x.id === d.fletero_id ? ' selected' : '') + '>' + esc(x.nombre) + '</option>';
        }).join('') + '</select></label>' +
        (f && f.estado !== 'asignado' && f.estado !== 'cancelado' ? '<p class="ayuda">Si cambiás el fletero, el flete vuelve a "Asignado" para el nuevo y al anterior le llega el aviso.</p>' : '') +
        '<p id="a-error" class="txt-mal" hidden></p>' +
        '<button class="btn btn-pri" id="fa-ok">' + (f ? 'Guardar' : 'Crear y avisar al fletero') + '</button>' +
        '<button class="btn-link" data-cerrar>Cancelar</button>', true);
      $('#fa-ok').addEventListener('click', function () {
        var b = $('#fa-ok');
        var datos = {
          id: f ? f.id : undefined,
          cliente: $('#fa-cli').value, telefono: $('#fa-tel').value,
          dir_retiro: $('#fa-dr').value, loc_retiro: $('#fa-lr').value,
          dir_entrega: $('#fa-de').value, loc_entrega: $('#fa-le').value,
          fecha: $('#fa-fe').value, hora: $('#fa-ho').value, nota: $('#fa-no').value,
          fletero_id: $('#fa-fl').value,
        };
        if (!datos.fletero_id) { mostrarError('Elegí el fletero'); return; }
        b.disabled = true;
        Api.llamar('admin.flete', datos).then(function (r) {
          if (!r.ok) { mostrarError(r.error); return; }
          Hoja.cerrar();
          U.toast(f ? 'Flete guardado ✓' : 'Flete creado ✓ — ' + r.flete.fletero + ' ya lo ve en la app');
          if (datos.fecha !== fecha) {
            fecha = datos.fecha;
            var inp = $('#p-fecha');
            if (inp) { inp.value = fecha; inp.dispatchEvent(new Event('change')); return; }
          }
          cargar(cont, fecha, false);
        }).catch(function () { mostrarError('Sin conexión. No se guardó.'); })
          .finally(function () { b.disabled = false; });
      });
    }).catch(function (e) { U.toast(e.message || 'Sin conexión', 4000); });
  }

  function mostrarError(m) {
    var e = $('#a-error');
    if (e) { e.textContent = m; e.hidden = false; } else U.toast(m, 4000);
  }

  return { cargar: cargar };
})();
