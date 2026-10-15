// Reparto TyM — formulario de parada, compartido por la app del chofer y el panel de la sucursal.
// Pide los datos, ubica la dirección en el mapa (Ubicador) y le pasa todo a quien lo abrió.
//
//   FormParada.abrir({ titulo, datos, sucursales, alGuardar(x) })
//     datos       → parada a editar (o null para una nueva)
//     sucursales  → [{id, nombre}] para que el admin elija la sucursal (opcional)
//     alGuardar   → recibe los campos con lat/lng/geo_fuente. Cerrar la hoja le toca a quien llama.
//   FormParada.opcionesLocalidad() → <datalist> de barrios y localidades

var FormParada = (function () {
  var $ = U.$, $$ = U.$$, esc = U.esc;

  // Medios de pago que se ofrecen al cargar. cta_cte y otro quedan solo para mostrar paradas viejas.
  var PAGOS_FORM = ['efectivo', 'debito', 'credito', 'transferencia'];
  var PAGOS = { efectivo: 'Efectivo', debito: 'Débito', credito: 'Crédito', transferencia: 'Transferencia', cta_cte: 'Cuenta corriente', otro: 'Otro' };
  var LOC_GBA = ['Vicente López', 'Olivos', 'Florida', 'Munro', 'Martínez', 'San Isidro', 'Beccar', 'Boulogne',
    'San Fernando', 'Tigre', 'San Martín', 'Villa Ballester', 'Tres de Febrero', 'Caseros', 'Ciudadela',
    'Hurlingham', 'Ituzaingó', 'Morón', 'Haedo', 'Castelar', 'La Matanza', 'Ramos Mejía', 'San Justo',
    'Avellaneda', 'Sarandí', 'Wilde', 'Lanús', 'Lomas de Zamora', 'Banfield', 'Quilmes', 'Bernal',
    'Almirante Brown', 'Adrogué', 'Esteban Echeverría', 'Ezeiza', 'San Miguel', 'Malvinas Argentinas',
    'José C. Paz', 'Pilar', 'Escobar', 'Merlo', 'Moreno', 'Berazategui', 'Florencio Varela'];

  function opcionesLocalidad() {
    var barrios = Routing.LOCALIDADES.map(function (b) {
      return b.replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
    });
    return '<datalist id="dl-localidades">' + barrios.concat(LOC_GBA).map(function (l) {
      return '<option value="' + esc(l) + '">';
    }).join('') + '</datalist>';
  }

  function abrir(o) {
    var p = o.datos;
    var d = p || { direccion: '', localidad: '', telefono: '', metodo_pago: 'efectivo', metodo_pago_detalle: '', nota: '', prioridad: 'normal', hora_limite: '' };
    var geo = p && p.lat != null ? { lat: p.lat, lng: p.lng, fuente: p.geo_fuente } : null;
    var sucs = o.sucursales || null;

    Hoja.abrir('<h2>' + esc(o.titulo || (p ? 'Editar parada' : 'Nueva parada')) + '</h2>' +
      '<form id="f-parada" autocomplete="off">' +
      (sucs ? '<label class="campo"><span>Sucursal *</span><select id="f-suc">' +
        (sucs.length > 1 ? '<option value="">Elegí…</option>' : '') + sucs.map(function (s) {
          return '<option value="' + esc(s.id) + '"' + (s.id === d.sucursal_id ? ' selected' : '') + '>' + esc(s.nombre) + '</option>';
        }).join('') + '</select></label>' : '') +
      '<label class="campo"><span>Dirección *</span><input id="f-dir" required placeholder="Ej: Av. Cabildo 2040" value="' + esc(d.direccion) + '"></label>' +
      '<label class="campo"><span>Localidad o barrio</span><input id="f-loc" list="dl-localidades" placeholder="Ej: Belgrano, Morón, Olivos" value="' + esc(d.localidad) + '"></label>' +
      opcionesLocalidad() +
      '<label class="campo"><span>Teléfono</span><input id="f-tel" type="tel" inputmode="tel" placeholder="Ej: 11 6455-4602" value="' + esc(d.telefono || '') + '"></label>' +
      '<div class="campo"><span>Pago</span><div class="seg" id="f-pago">' + PAGOS_FORM.concat(PAGOS_FORM.indexOf(d.metodo_pago) < 0 ? [d.metodo_pago] : []).map(function (k) {
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
      var x = {
        direccion: $('#f-dir').value.trim(),
        localidad: $('#f-loc').value.trim(),
        telefono: $('#f-tel').value.trim(),
        metodo_pago: pago,
        metodo_pago_detalle: pago === 'otro' ? $('#f-pago-det').value.trim() : '',
        prioridad: prio,
        hora_limite: prio === 'hora' ? $('#f-hora').value : '',
        nota: $('#f-nota').value.trim(),
      };
      if (sucs) x.sucursal_id = $('#f-suc').value;
      return x;
    }

    function validar(x) {
      if (sucs && !x.sucursal_id) { U.toast('Elegí la sucursal'); return false; }
      if (!x.direccion) { U.toast('Falta la dirección'); $('#f-dir').focus(); return false; }
      if (x.prioridad === 'hora' && !x.hora_limite) { U.toast('Poné la hora límite'); return false; }
      if (x.telefono && !U.telAR(x.telefono)) { U.toast('Revisá el teléfono: con característica, ej. 11 6455-4602'); $('#f-tel').focus(); return false; }
      return true;
    }

    function listo(x, g) {
      x.lat = g.lat; x.lng = g.lng; x.geo_fuente = g.fuente || 'manual';
      Routing.recordarGeo(x.direccion, x.localidad, g);
      o.alGuardar(x);
    }

    $('#f-parada').addEventListener('submit', function (e) {
      e.preventDefault();
      var x = datos();
      if (!validar(x)) return;
      var cambioDir = U.normalizar(x.direccion + '|' + x.localidad) !== dirOriginal;
      if (geo && !cambioDir) { listo(x, geo); return; }
      Ubicador.abrir(x.direccion, x.localidad, null, function (g) { listo(x, g); });
    });
    var reu = $('#f-reubicar');
    if (reu) reu.addEventListener('click', function () {
      var x = datos();
      if (!validar(x)) return;
      Ubicador.abrir(x.direccion, x.localidad, geo, function (g) { listo(x, g); });
    });
    if (!p) setTimeout(function () { $(sucs && sucs.length > 1 ? '#f-suc' : '#f-dir').focus(); }, 250);
  }

  return { abrir: abrir, opcionesLocalidad: opcionesLocalidad, PAGOS: PAGOS };
})();
