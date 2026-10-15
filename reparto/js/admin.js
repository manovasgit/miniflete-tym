// Reparto TyM — administración (solo admin): usuarios, clientes, sucursales y bases.
// Nada se borra: se desactiva. El PIN se guarda con hash en el servidor y nunca vuelve al panel.

var Admin = (function () {
  var $ = U.$, $$ = U.$$, esc = U.esc;
  var ROLES = [
    ['admin', 'Administrador'], ['repartidor', 'Repartidor'], ['fletero', 'Fletero'],
    ['sucursal', 'Sucursal (cliente)'], ['duenio', 'Dueño del cliente'],
  ];
  var NOMBRE_ROL = {};
  ROLES.forEach(function (r) { NOMBRE_ROL[r[0]] = r[1]; });
  var d = null;        // { usuarios, clientes, sucursales }
  var cont = null;

  function mostrar(contenedor) {
    cont = contenedor;
    cont.innerHTML = '<div class="vacio"><div class="rueda"></div></div>';
    return cargar();
  }

  function cargar() {
    return Api.llamar('admin.datos', {}).then(function (r) {
      if (!r.ok) { cont.innerHTML = '<div class="vacio"><p class="txt-mal">' + esc(r.error) + '</p></div>'; return; }
      d = r;
      render();
    }).catch(function () {
      cont.innerHTML = '<div class="vacio"><p class="txt-mal">Sin conexión con el servidor.</p></div>';
    });
  }

  function cliente(id) { return d.clientes.filter(function (c) { return c.id === id; })[0]; }
  function sucursal(id) { return d.sucursales.filter(function (s) { return s.id === id; })[0]; }

  function render() {
    var html = '';

    // Clientes y sus sucursales
    html += '<section class="p-admin"><div class="p-admin-cab"><h2>Clientes y sucursales</h2>' +
      '<button class="btn btn-sec btn-chico" id="a-nuevo-cli">+ Cliente</button></div>';
    d.clientes.forEach(function (c) {
      var sucs = d.sucursales.filter(function (s) { return s.cliente_id === c.id; });
      html += '<div class="tarjeta' + (c.activo ? '' : ' inactivo') + '">' +
        '<div class="p-admin-fila"><strong>' + esc(c.nombre) + '</strong>' + (c.activo ? '' : ' <span class="chip">Inactivo</span>') +
        '<button class="btn-link btn-mini" data-cli="' + c.id + '">Editar</button></div>' +
        '<ul class="p-lista">' + sucs.map(function (s) {
          return '<li class="' + (s.activo ? '' : 'inactivo') + '"><div><b>' + esc(s.nombre) + '</b>' +
            '<div class="ayuda chico">' + (s.lat != null ? '📍 ' + esc(s.direccion + (s.localidad ? ', ' + s.localidad : '')) : '<span class="txt-mal">Falta la dirección de la sucursal</span>') + '</div></div>' +
            '<button class="btn-link btn-mini" data-suc="' + s.id + '">Editar</button></li>';
        }).join('') + '</ul>' +
        '<button class="btn-link btn-mini" data-nueva-suc="' + c.id + '">+ Sucursal</button></div>';
    });
    html += '</section>';

    // Usuarios
    var orden = d.usuarios.slice().sort(function (a, b) {
      return (b.activo - a.activo) || String(a.nombre).localeCompare(String(b.nombre));
    });
    html += '<section class="p-admin"><div class="p-admin-cab"><h2>Usuarios</h2>' +
      '<button class="btn btn-sec btn-chico" id="a-nuevo-usr">+ Usuario</button></div>' +
      '<ul class="p-lista tarjeta">' + orden.map(function (u) {
        var s = sucursal(u.sucursal_id), c = cliente(u.cliente_id);
        return '<li class="' + (u.activo ? '' : 'inactivo') + '"><div>' +
          '<b>' + esc(u.nombre_mostrar || u.nombre) + '</b> <span class="ayuda chico">(' + esc(u.nombre) + ')</span>' +
          '<div class="chips">' + u.roles.map(function (r) { return '<span class="chip chip-rol">' + NOMBRE_ROL[r] + '</span>'; }).join('') +
          (s ? '<span class="chip">' + esc(s.nombre) + '</span>' : c ? '<span class="chip">' + esc(c.nombre) + '</span>' : '') +
          (!u.tiene_pin ? '<span class="chip chip-tarde">Sin PIN</span>' : '') +
          (u.bloqueado ? '<span class="chip chip-tarde">Bloqueado</span>' : '') +
          (!u.activo ? '<span class="chip">Inactivo</span>' : '') +
          '</div></div><button class="btn-link btn-mini" data-usr="' + u.id + '">Editar</button></li>';
      }).join('') + '</ul></section>';

    cont.innerHTML = html;
    $('#a-nuevo-cli').addEventListener('click', function () { formCliente(null); });
    $('#a-nuevo-usr').addEventListener('click', function () { formUsuario(null); });
    $$('[data-cli]', cont).forEach(function (b) { b.addEventListener('click', function () { formCliente(b.dataset.cli); }); });
    $$('[data-suc]', cont).forEach(function (b) { b.addEventListener('click', function () { formSucursal(b.dataset.suc, null); }); });
    $$('[data-nueva-suc]', cont).forEach(function (b) { b.addEventListener('click', function () { formSucursal(null, b.dataset.nuevaSuc); }); });
    $$('[data-usr]', cont).forEach(function (b) { b.addEventListener('click', function () { formUsuario(b.dataset.usr); }); });
  }

  // Manda al servidor y, si sale bien, recarga la lista
  function guardar(accion, datos, boton, msgOk) {
    boton.disabled = true;
    var txt = boton.textContent;
    boton.textContent = 'Guardando…';
    return Api.llamar(accion, datos).then(function (r) {
      if (!r.ok) { mostrarError(r.error); return false; }
      Hoja.cerrar();
      U.toast(msgOk || 'Guardado ✓');
      cargar();
      return true;
    }).catch(function () {
      mostrarError('Sin conexión. No se guardó.');
      return false;
    }).finally(function () { boton.disabled = false; boton.textContent = txt; });
  }

  function mostrarError(msg) {
    var e = $('#a-error');
    if (e) { e.textContent = msg; e.hidden = false; } else U.toast(msg, 4000);
  }

  function chkActivo(activo) {
    return '<label class="chk"><input type="checkbox" id="a-activo"' + (activo !== false ? ' checked' : '') + '> Activo</label>';
  }

  // ── Cliente ────────────────────────────────────────────────────────────
  function formCliente(id) {
    var c = id ? cliente(id) : { nombre: '', activo: true };
    Hoja.abrir('<h2>' + (id ? 'Editar cliente' : 'Nuevo cliente') + '</h2>' +
      '<label class="campo"><span>Nombre de la empresa</span><input id="a-nombre" value="' + esc(c.nombre) + '"></label>' +
      chkActivo(c.activo) +
      '<p id="a-error" class="txt-mal" hidden></p>' +
      '<button class="btn btn-pri" id="a-ok">Guardar</button><button class="btn-link" data-cerrar>Cancelar</button>');
    $('#a-ok').addEventListener('click', function () {
      guardar('admin.cliente', { id: id || undefined, nombre: $('#a-nombre').value, activo: $('#a-activo').checked }, $('#a-ok'));
    });
  }

  // ── Sucursal (con la base en el mapa) ──────────────────────────────────
  function formSucursal(id, clienteId) {
    var s = id ? sucursal(id) : { nombre: '', cliente_id: clienteId, direccion: '', localidad: '', lat: null, lng: null, activo: true };
    var geo = s.lat != null ? { lat: s.lat, lng: s.lng } : null;
    Hoja.abrir('<h2>' + (id ? 'Editar sucursal' : 'Nueva sucursal') + '</h2>' +
      '<label class="campo"><span>Cliente</span><select id="a-cli">' + d.clientes.map(function (c) {
        return '<option value="' + c.id + '"' + (c.id === s.cliente_id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="campo"><span>Nombre de la sucursal</span><input id="a-nombre" value="' + esc(s.nombre) + '" placeholder="Ej: BELGRANO"></label>' +
      '<label class="campo"><span>Dirección de la sucursal</span><input id="a-dir" value="' + esc(s.direccion) + '" placeholder="Ej: Av. Cabildo 2040"></label>' +
      '<label class="campo"><span>Localidad o barrio</span><input id="a-loc" value="' + esc(s.localidad) + '"></label>' +
      '<p id="a-geo" class="ayuda">' + (geo ? '📍 Ubicada en el mapa' : 'Todavía sin ubicar en el mapa') + '</p>' +
      '<button class="btn btn-sec" id="a-ubicar">Ubicar en el mapa</button>' +
      chkActivo(s.activo) +
      '<p id="a-error" class="txt-mal" hidden></p>' +
      '<button class="btn btn-pri" id="a-ok">Guardar</button><button class="btn-link" data-cerrar>Cancelar</button>', true);

    var dirOrig = U.normalizar(s.direccion + '|' + s.localidad);
    $('#a-ubicar').addEventListener('click', function () {
      var dir = $('#a-dir').value.trim();
      if (!dir) { mostrarError('Escribí la dirección primero'); return; }
      var mismo = U.normalizar(dir + '|' + $('#a-loc').value.trim()) === dirOrig;
      Ubicador.abrir(dir, $('#a-loc').value.trim(), mismo ? geo : null, function (g) {
        geo = { lat: g.lat, lng: g.lng };
        dirOrig = U.normalizar(dir + '|' + $('#a-loc').value.trim());
        $('#a-geo').textContent = '📍 Ubicada en el mapa';
      });
    });
    $('#a-ok').addEventListener('click', function () {
      var dir = $('#a-dir').value.trim(), loc = $('#a-loc').value.trim();
      if (dir && (!geo || U.normalizar(dir + '|' + loc) !== dirOrig)) {
        mostrarError('Tocá "Ubicar en el mapa" para confirmar dónde queda la sucursal.');
        return;
      }
      guardar('admin.sucursal', {
        id: id || undefined, cliente_id: $('#a-cli').value, nombre: $('#a-nombre').value,
        direccion: dir, localidad: loc, lat: dir ? geo.lat : null, lng: dir ? geo.lng : null,
        activo: $('#a-activo').checked,
      }, $('#a-ok'));
    });
  }

  // ── Usuario ────────────────────────────────────────────────────────────
  function formUsuario(id) {
    var u = id ? d.usuarios.filter(function (x) { return x.id === id; })[0]
      : { nombre: '', nombre_mostrar: '', roles: [], sucursal_id: '', cliente_id: '', telefono: '', activo: true, tiene_pin: false };
    var sucOps = '<option value="">—</option>' + d.clientes.map(function (c) {
      var ss = d.sucursales.filter(function (s) { return s.cliente_id === c.id && (s.activo || s.id === u.sucursal_id); });
      if (!ss.length) return '';
      return '<optgroup label="' + esc(c.nombre) + '">' + ss.map(function (s) {
        return '<option value="' + s.id + '"' + (s.id === u.sucursal_id ? ' selected' : '') + '>' + esc(s.nombre) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    var cliOps = '<option value="">—</option>' + d.clientes.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === u.cliente_id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>';
    }).join('');

    Hoja.abrir('<h2>' + (id ? 'Editar usuario' : 'Nuevo usuario') + '</h2>' +
      '<label class="campo"><span>Nombre para entrar</span><input id="a-nombre" value="' + esc(u.nombre) + '" placeholder="Ej: Enzo, Belgrano" autocapitalize="words"></label>' +
      '<label class="campo"><span>Nombre que se muestra</span><input id="a-mostrar" value="' + esc(u.nombre_mostrar) + '" placeholder="Opcional"></label>' +
      '<div class="campo"><span>Roles</span><div class="chk-grupo">' + ROLES.map(function (r) {
        return '<label class="chk"><input type="checkbox" value="' + r[0] + '"' + (u.roles.indexOf(r[0]) >= 0 ? ' checked' : '') + '> ' + r[1] + '</label>';
      }).join('') + '</div></div>' +
      '<label class="campo" id="a-c-suc"><span>Sucursal <small class="ayuda">(repartidor: de dónde sale · sucursal: la que ve)</small></span><select id="a-suc">' + sucOps + '</select></label>' +
      '<label class="campo" id="a-c-cli"><span>Empresa <small class="ayuda">(dueño: ve todas sus sucursales)</small></span><select id="a-cli">' + cliOps + '</select></label>' +
      '<label class="campo"><span>Teléfono</span><input id="a-tel" type="tel" value="' + esc(u.telefono) + '"></label>' +
      '<label class="campo"><span>' + (u.tiene_pin ? 'PIN nuevo <small class="ayuda">(vacío = no se cambia; poner uno nuevo también lo desbloquea)</small>' : 'PIN <small class="ayuda">(sin PIN no puede entrar)</small>') + '</span>' +
      '<input id="a-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="new-password" placeholder="4 a 8 números"></label>' +
      chkActivo(u.activo) +
      '<p id="a-error" class="txt-mal" hidden></p>' +
      '<button class="btn btn-pri" id="a-ok">Guardar</button><button class="btn-link" data-cerrar>Cancelar</button>', true);

    function roles() { return $$('.chk-grupo input:checked').map(function (x) { return x.value; }); }
    function visibilidad() {
      var r = roles();
      $('#a-c-suc').hidden = !(r.indexOf('repartidor') >= 0 || r.indexOf('sucursal') >= 0);
      $('#a-c-cli').hidden = r.indexOf('duenio') < 0;
    }
    $$('.chk-grupo input').forEach(function (x) { x.addEventListener('change', visibilidad); });
    visibilidad();

    $('#a-ok').addEventListener('click', function () {
      var pin = $('#a-pin').value.trim();
      if (pin && !/^\d{4,8}$/.test(pin)) { mostrarError('El PIN tiene que tener de 4 a 8 números'); return; }
      var r = roles();
      guardar('admin.usuario', {
        id: id || undefined,
        nombre: $('#a-nombre').value, nombre_mostrar: $('#a-mostrar').value, roles: r,
        sucursal_id: $('#a-c-suc').hidden ? '' : $('#a-suc').value,
        cliente_id: $('#a-c-cli').hidden ? '' : $('#a-cli').value,
        telefono: $('#a-tel').value, activo: $('#a-activo').checked,
        pin: pin || undefined,
      }, $('#a-ok'), pin ? 'Guardado ✓ — pasale el PIN en persona o por WhatsApp' : 'Guardado ✓');
    });
  }

  return { mostrar: mostrar };
})();
