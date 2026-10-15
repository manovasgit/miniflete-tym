/**
 * Reparto TyM — backend en Google Apps Script (ligado al Google Sheet de Reparto TyM).
 *
 * Todo acceso a datos pasa por acá. El celular manda POST text/plain con
 *   { accion: 'nombre', token: '...', datos: {...} }
 * y recibe { ok: true, ... } o { ok: false, error: 'mensaje', codigo: 'auth'|'permiso'|'datos'|'interno' }.
 *
 * Seguridad:
 *  - PIN guardado como SHA-256(salt + PIN), salt aleatorio por usuario. 5 errores bloquean 15 min.
 *  - Token de sesión aleatorio; en la hoja Sesiones se guarda solo su hash.
 *  - Cada acción filtra los datos según el rol ANTES de armar la respuesta.
 *  - Este archivo no tiene claves ni datos de clientes: es público en el repo.
 */

var TZ = 'America/Argentina/Buenos_Aires';
var VERSION_API = '4.0.0';
var DIAS_SESION_CHOFER = 30;
var DIAS_SESION_PANEL = 7;
var MAX_INTENTOS = 5;
var MIN_BLOQUEO = 15;

var HOJAS = {
  Usuarios: ['id', 'nombre', 'nombre_mostrar', 'roles', 'cliente_id', 'sucursal_id', 'telefono',
    'pin_hash', 'pin_salt', 'intentos_fallidos', 'bloqueado_hasta', 'activo', 'creado', 'actualizado_ts'],
  Clientes: ['id', 'nombre', 'activo', 'creado', 'actualizado_ts'],
  Sucursales: ['id', 'cliente_id', 'nombre', 'direccion', 'localidad', 'lat', 'lng', 'activo', 'actualizado_ts'],
  Repartos: ['id', 'fecha', 'repartidor_id', 'cliente_id', 'sucursal_id', 'estado',
    'base_direccion', 'base_lat', 'base_lng', 'km_estimados', 'min_estimados', 'fuente_tiempos',
    'total_paradas', 'entregadas', 'no_entregadas', 'hora_armado', 'hora_inicio', 'hora_fin',
    'eliminado', 'actualizado_ts'],
  Paradas: ['id', 'reparto_id', 'cliente_id', 'sucursal_id', 'fecha', 'origen', 'creado_por', 'orden',
    'direccion', 'localidad', 'cliente_final', 'metodo_pago', 'metodo_pago_detalle', 'nota',
    'prioridad', 'hora_limite', 'lat', 'lng', 'geo_fuente', 'eta', 'aviso_horario',
    'estado', 'motivo', 'motivo_detalle',
    'hora_pendiente', 'hora_en_camino', 'hora_entregado', 'hora_no_entregado',
    'eliminada', 'actualizado_ts',
    // Columnas nuevas siempre al final, para no desalinear las filas que ya existían
    'telefono',   // 3.2.0: teléfono de quien recibe
    'recibio'],   // 3.3.0: comprobante de entrega ("Portería – Juan")
  Fletes: ['id', 'origen', 'unidades_job_id', 'fletero_id', 'cliente', 'telefono',
    'dir_retiro', 'loc_retiro', 'lat_retiro', 'lng_retiro',
    'dir_entrega', 'loc_entrega', 'lat_entrega', 'lng_entrega',
    'fecha', 'hora', 'nota', 'estado', 'motivo',
    'hora_asignado', 'hora_en_camino', 'hora_cargando', 'hora_en_viaje',
    'hora_realizado', 'hora_no_realizado', 'hora_cancelado',
    'creado_por', 'actualizado_ts'],
  Sesiones: ['token_hash', 'usuario_id', 'creado', 'expira', 'ultimo_uso', 'dispositivo'],
  // Celulares que aceptaron notificaciones push (etapa 3)
  Dispositivos: ['token', 'usuario_id', 'creado', 'actualizado', 'agente'],
};

var NUMEROS = ['lat', 'lng', 'orden', 'km_estimados', 'min_estimados', 'total_paradas', 'entregadas',
  'no_entregadas', 'intentos_fallidos', 'actualizado_ts', 'base_lat', 'base_lng',
  'lat_retiro', 'lng_retiro', 'lat_entrega', 'lng_entrega'];
var BOOLEANOS = ['activo', 'eliminada', 'eliminado', 'aviso_horario'];

var ROLES = ['admin', 'repartidor', 'fletero', 'sucursal', 'duenio'];
var ESTADOS_REPARTO = ['armado', 'en_curso', 'finalizado'];
var ESTADOS_PARADA = ['pendiente', 'en_camino', 'entregado', 'no_entregado'];
// cta_cte y otro quedan aceptados por las paradas cargadas antes de la v2.1 (la app ya no los ofrece)
var PAGOS = ['efectivo', 'debito', 'credito', 'transferencia', 'cta_cte', 'otro'];
var PRIORIDADES = ['normal', 'urgente', 'hora'];
var MOTIVOS = ['', 'ausente', 'dir_incorrecta', 'rechazo', 'otro'];

// Campos que nunca salen en una respuesta
var SECRETOS = ['pin_hash', 'pin_salt', 'token_hash'];

// ════════════════════════════════════════════════════════════════════════
// Entrada web
// ════════════════════════════════════════════════════════════════════════

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return salida({ ok: false, error: 'Pedido mal armado', codigo: 'datos' });
  }
  return salida(manejar(req));
}

function doGet() {
  return salida({ ok: true, servicio: 'Reparto TyM', version: VERSION_API });
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function Falla(mensaje, codigo) {
  this.message = mensaje;
  this.codigo = codigo || 'datos';
}

var ACCIONES = {
  'login':               { publica: true, escribe: true, fn: accLogin },
  'logout':              { escribe: true, fn: accLogout },
  'yo':                  { fn: accYo },
  'sync':                { escribe: true, roles: ['repartidor', 'fletero'], fn: accSync },
  'mis.repartos':        { roles: ['repartidor'], fn: accMisRepartos },
  'panel.dia':           { roles: ['admin', 'duenio', 'sucursal'], fn: accPanelDia },
  'panel.mes':           { roles: ['admin', 'duenio'], fn: accPanelMes },
  'admin.datos':         { roles: ['admin'], fn: accAdminDatos },
  'admin.usuario':       { escribe: true, roles: ['admin'], fn: accAdminUsuario },
  'admin.cliente':       { escribe: true, roles: ['admin'], fn: accAdminCliente },
  'admin.sucursal':      { escribe: true, roles: ['admin'], fn: accAdminSucursal },
  'fletes.mios':         { roles: ['fletero'], fn: accFletesMios },
  'fleteros':            { roles: ['admin'], fn: accFleteros },
  'admin.fletes':        { roles: ['admin'], fn: accAdminFletes },
  'admin.flete':         { escribe: true, roles: ['admin'], fn: accAdminFlete },
  'unidades.asignar':    { escribe: true, roles: ['admin'], fn: accUnidadesAsignar },
  'unidades.estados':    { roles: ['admin'], fn: accUnidadesEstados },
  'push.registrar':      { escribe: true, fn: accPushRegistrar },
  'sucursal.parada':     { escribe: true, roles: ['admin', 'sucursal'], fn: accSucursalParada },
  'sucursal.pendientes': { roles: ['repartidor'], fn: accSucursalPendientes },
};

// Separado de doPost para poder probarlo y para la verificación por rol
function manejar(req) {
  var lock = null;
  try {
    if (!req || typeof req !== 'object') throw new Falla('Pedido mal armado');
    var acc = ACCIONES[req.accion];
    if (!acc) throw new Falla('Acción desconocida');
    var datos = req.datos && typeof req.datos === 'object' ? req.datos : {};

    if (acc.escribe) {
      lock = LockService.getScriptLock();
      lock.waitLock(20000);
    }
    var ctx = { db: new Base(), token: req.token };
    if (!acc.publica) {
      ctx.usuario = sesionValida(ctx.db, req.token);
      if (acc.roles && !acc.roles.some(function (r) { return tiene(ctx.usuario, r); })) {
        throw new Falla('No tenés permiso para esto', 'permiso');
      }
    }
    var res = acc.fn(ctx, datos) || {};
    res.ok = true;
    return limpiarSecretos(res);
  } catch (err) {
    if (err instanceof Falla) return { ok: false, error: err.message, codigo: err.codigo };
    console.error(err && err.stack ? err.stack : err);
    return { ok: false, error: 'Error interno del servidor', codigo: 'interno' };
  } finally {
    if (lock) try { lock.releaseLock(); } catch (e) { /* nada */ }
  }
}

// Cinturón extra: aunque una acción se equivoque, los secretos no salen nunca
function limpiarSecretos(o) {
  if (Array.isArray(o)) return o.map(limpiarSecretos);
  if (o && typeof o === 'object') {
    var r = {};
    Object.keys(o).forEach(function (k) {
      if (SECRETOS.indexOf(k) < 0) r[k] = limpiarSecretos(o[k]);
    });
    return r;
  }
  return o;
}

// ════════════════════════════════════════════════════════════════════════
// Acceso a las hojas
// ════════════════════════════════════════════════════════════════════════

function Base() {
  this.ss = SpreadsheetApp.getActive();
  this.tablas = {};
}
Base.prototype.t = function (nombre) {
  if (!this.tablas[nombre]) this.tablas[nombre] = new Tabla(this.ss, nombre);
  return this.tablas[nombre];
};

function Tabla(ss, nombre) {
  this.nombre = nombre;
  this.cols = HOJAS[nombre];
  this.sh = ss.getSheetByName(nombre);
  if (!this.sh) throw new Falla('Falta la hoja ' + nombre + '. Corré "Inicializar planilla".', 'interno');
  // Columnas agregadas en una versión nueva: se crean solas, sin tener que volver a inicializar
  if (this.sh.getLastColumn() < this.cols.length) {
    var faltan = this.cols.length - this.sh.getMaxColumns();
    if (faltan > 0) this.sh.insertColumnsAfter(this.sh.getMaxColumns(), faltan);
    this.sh.getRange(1, 1, this.sh.getMaxRows(), this.cols.length).setNumberFormat('@');
    this.sh.getRange(1, 1, 1, this.cols.length).setValues([this.cols]).setFontWeight('bold');
  }
  this._filas = null;
  this._idx = null;
}

Tabla.prototype.todas = function () {
  if (this._filas) return this._filas;
  var n = this.sh.getLastRow() - 1;
  var vals = n > 0 ? this.sh.getRange(2, 1, n, this.cols.length).getValues() : [];
  var cols = this.cols;
  this._filas = vals.map(function (fila, i) {
    var o = { _fila: i + 2 };
    cols.forEach(function (c, j) { o[c] = desdeCelda(c, fila[j]); });
    return o;
  });
  this._idx = {};
  var idx = this._idx, clave = cols[0];
  this._filas.forEach(function (o) { if (o[clave] !== '') idx[o[clave]] = o; });
  return this._filas;
};

Tabla.prototype.buscar = function (id) {
  this.todas();
  return id ? (this._idx[id] || null) : null;
};

Tabla.prototype.filtrar = function (fn) {
  return this.todas().filter(fn);
};

// Inserta o actualiza por la primera columna (id). Devuelve el objeto como quedó guardado.
Tabla.prototype.guardar = function (obj) {
  this.todas();
  var cols = this.cols;
  var celdas = cols.map(function (c) { return aCelda(obj[c]); });
  var clave = obj[cols[0]];
  var existente = this._idx[clave];
  var r = obj._fila || (existente && existente._fila);
  if (!r) {
    r = this.sh.getLastRow() + 1;
    // Las filas nuevas heredan el formato de texto de la anterior
    if (r > this.sh.getMaxRows()) this.sh.insertRowsAfter(this.sh.getMaxRows(), 500);
  }
  this.sh.getRange(r, 1, 1, cols.length).setValues([celdas]);
  var guardado = { _fila: r };
  cols.forEach(function (c, j) { guardado[c] = desdeCelda(c, celdas[j]); });
  if (existente) return Object.assign(existente, guardado);
  this._filas.push(guardado);
  this._idx[clave] = guardado;
  return guardado;
};

// Reescribe la hoja entera (solo para limpiar Sesiones)
Tabla.prototype.reescribir = function (filas) {
  var n = this.sh.getLastRow() - 1;
  var ancho = this.cols.length;
  if (n > 0) this.sh.getRange(2, 1, n, ancho).clearContent();
  if (filas.length) {
    var cols = this.cols;
    this.sh.getRange(2, 1, filas.length, ancho).setValues(filas.map(function (o) {
      return cols.map(function (c) { return aCelda(o[c]); });
    }));
  }
  this._filas = null;
};

function aCelda(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return String(v);
}

function desdeCelda(col, v) {
  if (BOOLEANOS.indexOf(col) >= 0) return v === true || String(v).toUpperCase() === 'TRUE';
  if (NUMEROS.indexOf(col) >= 0) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }
  // Respaldo por si Sheets convirtió algún texto en fecha u hora
  if (v instanceof Date) {
    if (col === 'fecha') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    if (col === 'hora_limite' || col === 'eta' || col === 'hora') return Utilities.formatDate(v, TZ, 'HH:mm');
    return Utilities.formatDate(v, TZ, "yyyy-MM-dd'T'HH:mm:ss") + '-03:00';
  }
  return v === null || v === undefined ? '' : String(v);
}

// ════════════════════════════════════════════════════════════════════════
// Utilidades
// ════════════════════════════════════════════════════════════════════════

function hoy() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function ahoraISO() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss") + '-03:00'; }

function sha256(texto) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join('');
}

function nuevoId(prefijo) {
  return prefijo + '_' + Date.now().toString(36) + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tiene(u, rol) { return u && rolesDe(u).indexOf(rol) >= 0; }
function rolesDe(u) {
  return String(u.roles || '').split(',').map(function (r) { return r.trim(); }).filter(Boolean);
}

function texto(v, max) {
  return String(v == null ? '' : v).slice(0, max || 300);
}
function esFecha(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function esHora(s) { return s === '' || /^\d{2}:\d{2}$/.test(String(s || '')); }
function esISO(s) { return !s || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(s)); }
function numOVacio(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}
function exigirUno(v, lista, campo) {
  if (lista.indexOf(v) < 0) throw new Falla('Valor inválido en ' + campo + ': ' + v);
  return v;
}

// ════════════════════════════════════════════════════════════════════════
// Sesiones
// ════════════════════════════════════════════════════════════════════════

function sesionValida(db, token) {
  if (!token || typeof token !== 'string' || token.length < 30) throw new Falla('Iniciá sesión', 'auth');
  var h = sha256(token);
  var cache = CacheService.getScriptCache();
  var uid = cache.get('s_' + h);
  if (!uid) {
    var s = db.t('Sesiones').buscar(h);
    if (!s || s.expira < ahoraISO()) throw new Falla('La sesión venció. Volvé a entrar.', 'auth');
    uid = s.usuario_id;
    cache.put('s_' + h, uid, 600);
  }
  var u = db.t('Usuarios').buscar(uid);
  if (!u || !u.activo) throw new Falla('Usuario desactivado', 'auth');
  return u;
}

function cerrarSesionesDe(db, usuarioId) {
  var t = db.t('Sesiones');
  var cache = CacheService.getScriptCache();
  var vencida = '2000-01-01T00:00:00-03:00';
  t.filtrar(function (s) { return s.usuario_id === usuarioId && s.expira > vencida; }).forEach(function (s) {
    s.expira = vencida;
    t.guardar(s);
    cache.remove('s_' + s.token_hash);
  });
}

function limpiarSesionesVencidas(db) {
  var t = db.t('Sesiones');
  var todas = t.todas();
  var ahora = ahoraISO();
  var vivas = todas.filter(function (s) { return s.expira > ahora; });
  if (vivas.length < todas.length) t.reescribir(vivas);
}

function usuarioPublico(db, u) {
  var suc = u.sucursal_id ? db.t('Sucursales').buscar(u.sucursal_id) : null;
  var cli = u.cliente_id ? db.t('Clientes').buscar(u.cliente_id) : null;
  return {
    id: u.id, nombre: u.nombre, nombre_mostrar: u.nombre_mostrar || u.nombre,
    roles: rolesDe(u), cliente_id: u.cliente_id, sucursal_id: u.sucursal_id,
    cliente: cli ? { id: cli.id, nombre: cli.nombre } : null,
    sucursal: suc ? { id: suc.id, nombre: suc.nombre, direccion: suc.direccion, localidad: suc.localidad, lat: suc.lat, lng: suc.lng } : null,
  };
}

// ════════════════════════════════════════════════════════════════════════
// Acciones: sesión
// ════════════════════════════════════════════════════════════════════════

function accLogin(ctx, d) {
  var db = ctx.db;
  var nombre = normalizar(d.nombre);
  var pin = String(d.pin || '');
  var malo = new Falla('Nombre o PIN incorrecto', 'auth');
  if (!nombre || !pin) throw malo;

  var u = db.t('Usuarios').filtrar(function (x) { return normalizar(x.nombre) === nombre; })[0];
  if (!u || !u.activo || !u.pin_hash) throw malo;

  var ahora = ahoraISO();
  if (u.bloqueado_hasta && u.bloqueado_hasta > ahora) {
    throw new Falla('Demasiados intentos. Probá de nuevo en ' + MIN_BLOQUEO + ' minutos.', 'auth');
  }
  if (sha256(u.pin_salt + pin) !== u.pin_hash) {
    u.intentos_fallidos = (u.intentos_fallidos || 0) + 1;
    if (u.intentos_fallidos >= MAX_INTENTOS) {
      u.bloqueado_hasta = Utilities.formatDate(new Date(Date.now() + MIN_BLOQUEO * 60000), TZ, "yyyy-MM-dd'T'HH:mm:ss") + '-03:00';
      u.intentos_fallidos = 0;
    }
    db.t('Usuarios').guardar(u);
    throw malo;
  }
  if (u.intentos_fallidos || u.bloqueado_hasta) {
    u.intentos_fallidos = 0;
    u.bloqueado_hasta = '';
    db.t('Usuarios').guardar(u);
  }

  var soloPanel = !tiene(u, 'repartidor') && !tiene(u, 'fletero');
  var dias = d.app === 'panel' || soloPanel ? DIAS_SESION_PANEL : DIAS_SESION_CHOFER;
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var ses = db.t('Sesiones');
  if (ses.todas().length > 300) limpiarSesionesVencidas(db);
  ses.guardar({
    token_hash: sha256(token), usuario_id: u.id, creado: ahora,
    expira: Utilities.formatDate(new Date(Date.now() + dias * 86400000), TZ, "yyyy-MM-dd'T'HH:mm:ss") + '-03:00',
    ultimo_uso: ahora, dispositivo: texto(d.dispositivo, 120),
  });
  return { token: token, usuario: usuarioPublico(db, u) };
}

// Cierra solo la sesión de este dispositivo
function accLogout(ctx) {
  var h = sha256(ctx.token);
  var t = ctx.db.t('Sesiones');
  var s = t.buscar(h);
  if (s) {
    s.expira = '2000-01-01T00:00:00-03:00';
    t.guardar(s);
  }
  CacheService.getScriptCache().remove('s_' + h);
  return {};
}

function accYo(ctx) {
  return { usuario: usuarioPublico(ctx.db, ctx.usuario), version: VERSION_API };
}

// ════════════════════════════════════════════════════════════════════════
// Acciones: repartidor
// ════════════════════════════════════════════════════════════════════════

var CAMPOS_REPARTO = ['fecha', 'estado', 'base_direccion', 'base_lat', 'base_lng', 'km_estimados',
  'min_estimados', 'fuente_tiempos', 'hora_armado', 'hora_inicio', 'hora_fin', 'eliminado', 'actualizado_ts'];
var CAMPOS_PARADA = ['reparto_id', 'fecha', 'orden', 'direccion', 'localidad', 'cliente_final',
  'metodo_pago', 'metodo_pago_detalle', 'nota', 'prioridad', 'hora_limite', 'lat', 'lng', 'geo_fuente',
  'eta', 'aviso_horario', 'estado', 'motivo', 'motivo_detalle',
  'hora_pendiente', 'hora_en_camino', 'hora_entregado', 'hora_no_entregado', 'eliminada', 'actualizado_ts', 'telefono', 'recibio'];

function tomar(origen, campos) {
  var o = {};
  campos.forEach(function (c) { if (origen[c] !== undefined) o[c] = origen[c]; });
  return o;
}

function validarReparto(r) {
  if (!esFecha(r.fecha)) throw new Falla('Fecha inválida');
  exigirUno(r.estado, ESTADOS_REPARTO, 'estado');
  ['hora_armado', 'hora_inicio', 'hora_fin'].forEach(function (c) { if (!esISO(r[c])) throw new Falla('Hora inválida en ' + c); });
  ['base_lat', 'base_lng', 'km_estimados', 'min_estimados'].forEach(function (c) { r[c] = numOVacio(r[c]); });
  r.base_direccion = texto(r.base_direccion, 200);
  r.fuente_tiempos = texto(r.fuente_tiempos, 20);
  r.eliminado = r.eliminado === true;
}

function validarParada(p) {
  if (!esFecha(p.fecha)) throw new Falla('Fecha inválida');
  exigirUno(p.estado, ESTADOS_PARADA, 'estado');
  exigirUno(p.metodo_pago, PAGOS, 'metodo_pago');
  exigirUno(p.prioridad, PRIORIDADES, 'prioridad');
  exigirUno(p.motivo || '', MOTIVOS, 'motivo');
  if (!esHora(p.hora_limite || '')) throw new Falla('Hora límite inválida');
  if (!esHora(p.eta || '')) p.eta = '';
  ['hora_pendiente', 'hora_en_camino', 'hora_entregado', 'hora_no_entregado'].forEach(function (c) {
    if (!esISO(p[c])) throw new Falla('Hora inválida en ' + c);
  });
  p.direccion = texto(p.direccion, 200);
  if (!p.direccion) throw new Falla('Parada sin dirección');
  p.localidad = texto(p.localidad, 100);
  p.cliente_final = texto(p.cliente_final, 120);
  p.telefono = texto(p.telefono, 30);
  p.recibio = p.estado === 'entregado' ? texto(p.recibio, 80) : '';
  p.metodo_pago_detalle = texto(p.metodo_pago_detalle, 80);
  p.nota = texto(p.nota, 500);
  p.motivo_detalle = texto(p.motivo_detalle, 300);
  p.geo_fuente = texto(p.geo_fuente, 20);
  p.lat = numOVacio(p.lat);
  p.lng = numOVacio(p.lng);
  p.orden = numOVacio(p.orden);
  p.aviso_horario = p.aviso_horario === true;
  p.eliminada = p.eliminada === true;
}

// Recibe la cola del celular. Upsert por ID: reenviar lo mismo no duplica, y una versión
// más vieja (actualizado_ts menor) que la guardada se ignora.
function accSync(ctx, d) {
  var db = ctx.db, u = ctx.usuario;
  var aplicados = [], ignorados = [], rechazados = [];
  var tocados = {};
  var repartos = Array.isArray(d.repartos) ? d.repartos.slice(0, 50) : [];
  var paradas = Array.isArray(d.paradas) ? d.paradas.slice(0, 400) : [];
  var fletes = Array.isArray(d.fletes) ? d.fletes.slice(0, 100) : [];
  var tR = db.t('Repartos'), tP = db.t('Paradas');
  if (!tiene(u, 'repartidor')) {
    repartos.concat(paradas).forEach(function (x) { rechazados.push({ id: texto(x && x.id, 80), error: 'No sos repartidor' }); });
    repartos = []; paradas = [];
  }
  syncFletes(db, u, fletes, aplicados, ignorados, rechazados);

  repartos.forEach(function (x) {
    var id = texto(x && x.id, 80);
    try {
      if (!/^rep_/.test(id)) throw new Falla('ID inválido');
      var viejo = tR.buscar(id);
      if (viejo && viejo.repartidor_id !== u.id) throw new Falla('El reparto es de otro repartidor', 'permiso');
      var nuevo = tomar(x, CAMPOS_REPARTO);
      nuevo.actualizado_ts = Number(nuevo.actualizado_ts) || 0;
      if (viejo && viejo.actualizado_ts > nuevo.actualizado_ts) { ignorados.push(id); return; }
      validarReparto(nuevo);
      var fila = Object.assign({}, viejo || { id: id, total_paradas: 0, entregadas: 0, no_entregadas: 0 }, nuevo, {
        repartidor_id: u.id, cliente_id: u.cliente_id, sucursal_id: u.sucursal_id,
      });
      var descartado = fila.eliminado && !(viejo && viejo.eliminado);   // antes de guardar: guardar pisa a "viejo"
      tR.guardar(fila);
      if (descartado) liberarParadasSucursal(db, id);
      tocados[id] = true;
      aplicados.push(id);
    } catch (err) {
      rechazados.push({ id: id, error: err.message || String(err) });
    }
  });

  paradas.forEach(function (x) {
    var id = texto(x && x.id, 80);
    try {
      if (!/^par_/.test(id)) throw new Falla('ID inválido');
      var viejo = tP.buscar(id);
      var nuevo = tomar(x, CAMPOS_PARADA);
      nuevo.actualizado_ts = Number(nuevo.actualizado_ts) || 0;
      var rep = tR.buscar(nuevo.reparto_id || (viejo && viejo.reparto_id));
      if (!rep) throw new Falla('El reparto de la parada no existe');
      if (rep.repartidor_id !== u.id) throw new Falla('La parada es de otro repartidor', 'permiso');
      // Paradas que cargó la sucursal (etapa 4)
      if (viejo && viejo.origen === 'sucursal') {
        // Sin tomar todavía: solo la puede tomar un repartidor de esa misma sucursal
        if (!viejo.reparto_id && viejo.sucursal_id !== u.sucursal_id) throw new Falla('La parada es de otra sucursal', 'permiso');
        if (!viejo.reparto_id && viejo.eliminada) throw new Falla('La sucursal quitó esta parada');
        if (nuevo.eliminada === true && !viejo.eliminada) throw new Falla('Las paradas de la sucursal no se pueden quitar');
        if (rep.eliminado) throw new Falla('El reparto se descartó');
      }
      if (viejo && viejo.reparto_id && viejo.reparto_id !== rep.id) {
        var repViejo = tR.buscar(viejo.reparto_id);
        if (!repViejo || repViejo.repartidor_id !== u.id) throw new Falla('La parada es de otro repartidor', 'permiso');
      }
      if (viejo && viejo.actualizado_ts > nuevo.actualizado_ts) { ignorados.push(id); return; }
      var fila = Object.assign({}, viejo || { id: id, origen: 'repartidor', creado_por: u.id }, nuevo, {
        reparto_id: rep.id, cliente_id: rep.cliente_id, sucursal_id: rep.sucursal_id,
      });
      validarParada(fila);
      tP.guardar(fila);
      tocados[rep.id] = true;
      if (viejo && viejo.reparto_id && viejo.reparto_id !== rep.id) tocados[viejo.reparto_id] = true;
      aplicados.push(id);
    } catch (err) {
      rechazados.push({ id: id, error: err.message || String(err) });
    }
  });

  Object.keys(tocados).forEach(function (rid) { recontar(db, rid); });
  return { aplicados: aplicados, ignorados: ignorados, rechazados: rechazados };
}

// Los contadores del reparto los calcula el servidor a partir de las paradas
function recontar(db, repartoId) {
  var r = db.t('Repartos').buscar(repartoId);
  if (!r) return;
  var ps = db.t('Paradas').filtrar(function (p) { return p.reparto_id === repartoId && !p.eliminada; });
  var t = ps.length;
  var e = ps.filter(function (p) { return p.estado === 'entregado'; }).length;
  var n = ps.filter(function (p) { return p.estado === 'no_entregado'; }).length;
  if (r.total_paradas !== t || r.entregadas !== e || r.no_entregadas !== n) {
    r.total_paradas = t; r.entregadas = e; r.no_entregadas = n;
    db.t('Repartos').guardar(r);
  }
}

// Para recuperar el reparto del día si el celular perdió los datos
function accMisRepartos(ctx, d) {
  var db = ctx.db, u = ctx.usuario;
  var fecha = esFecha(d.fecha) ? d.fecha : hoy();
  var reps = db.t('Repartos').filtrar(function (r) { return r.repartidor_id === u.id && r.fecha === fecha && !r.eliminado; });
  var ids = reps.map(function (r) { return r.id; });
  var ps = db.t('Paradas').filtrar(function (p) { return ids.indexOf(p.reparto_id) >= 0 && !p.eliminada; });
  return {
    fecha: fecha,
    repartos: reps.map(function (r) { return sinFila(r); }),
    paradas: ps.map(function (p) { return sinFila(p); }),
  };
}

function sinFila(o) {
  var r = Object.assign({}, o);
  delete r._fila;
  return r;
}

// ════════════════════════════════════════════════════════════════════════
// Acciones: paneles
// ════════════════════════════════════════════════════════════════════════

// Qué sucursales puede ver cada rol. El más amplio gana (admin > dueño > sucursal).
function alcance(db, u) {
  var sucs = db.t('Sucursales').todas();
  if (tiene(u, 'admin')) return { rol: 'admin', sucursales: sucs };
  if (tiene(u, 'duenio')) {
    if (!u.cliente_id) throw new Falla('Tu usuario no tiene empresa asignada', 'permiso');
    return { rol: 'duenio', sucursales: sucs.filter(function (s) { return s.cliente_id === u.cliente_id; }) };
  }
  if (tiene(u, 'sucursal')) {
    if (!u.sucursal_id) throw new Falla('Tu usuario no tiene sucursal asignada', 'permiso');
    return { rol: 'sucursal', sucursales: sucs.filter(function (s) { return s.id === u.sucursal_id; }) };
  }
  throw new Falla('No tenés permiso para esto', 'permiso');
}

var CAMPOS_PARADA_PANEL = ['id', 'reparto_id', 'sucursal_id', 'orden', 'origen', 'direccion', 'localidad', 'cliente_final', 'telefono',
  'metodo_pago', 'metodo_pago_detalle', 'nota', 'prioridad', 'hora_limite', 'lat', 'lng', 'eta', 'aviso_horario',
  'estado', 'motivo', 'motivo_detalle', 'hora_pendiente', 'hora_en_camino', 'hora_entregado', 'hora_no_entregado', 'recibio'];
var CAMPOS_REPARTO_PANEL = ['id', 'fecha', 'sucursal_id', 'estado', 'km_estimados', 'min_estimados',
  'total_paradas', 'entregadas', 'no_entregadas', 'hora_armado', 'hora_inicio', 'hora_fin'];

function accPanelDia(ctx, d) {
  var db = ctx.db;
  var al = alcance(db, ctx.usuario);
  var fecha = esFecha(d.fecha) ? d.fecha : hoy();
  var sucIds = al.sucursales.map(function (s) { return s.id; });
  if (d.sucursal_id) sucIds = sucIds.filter(function (x) { return x === d.sucursal_id; });
  if (d.cliente_id && al.rol === 'admin') {
    sucIds = al.sucursales.filter(function (s) { return s.cliente_id === d.cliente_id && sucIds.indexOf(s.id) >= 0; })
      .map(function (s) { return s.id; });
  }
  var usuarios = db.t('Usuarios');
  var reps = db.t('Repartos').filtrar(function (r) {
    return r.fecha === fecha && !r.eliminado && sucIds.indexOf(r.sucursal_id) >= 0;
  });
  var repIds = reps.map(function (r) { return r.id; });
  var ps = db.t('Paradas').filtrar(function (p) { return repIds.indexOf(p.reparto_id) >= 0 && !p.eliminada; });

  return {
    fecha: fecha,
    rol: al.rol,
    sucursales: al.sucursales.filter(function (s) { return sucIds.indexOf(s.id) >= 0; }).map(function (s) {
      return { id: s.id, nombre: s.nombre, cliente_id: s.cliente_id };
    }),
    repartos: reps.map(function (r) {
      var o = tomar(r, CAMPOS_REPARTO_PANEL);
      var rep = usuarios.buscar(r.repartidor_id);
      o.repartidor = rep ? (rep.nombre_mostrar || rep.nombre) : '';
      if (al.rol === 'admin') { o.repartidor_id = r.repartidor_id; o.cliente_id = r.cliente_id; o.actualizado_ts = r.actualizado_ts; }
      return o;
    }),
    paradas: ps.map(function (p) { return tomar(p, CAMPOS_PARADA_PANEL); }),
    sin_tomar: db.t('Paradas').filtrar(function (p) {
      return p.origen === 'sucursal' && !p.reparto_id && !p.eliminada && p.fecha === fecha && sucIds.indexOf(p.sucursal_id) >= 0;
    }).map(function (p) { return tomar(p, CAMPOS_PARADA_PANEL); }),
  };
}

// Resumen mensual: una fila por reparto (los totales por día y por sucursal se arman en el panel)
function accPanelMes(ctx, d) {
  var db = ctx.db;
  var al = alcance(db, ctx.usuario);
  var mes = /^\d{4}-\d{2}$/.test(String(d.mes || '')) ? d.mes : hoy().slice(0, 7);
  var sucIds = al.sucursales.map(function (s) { return s.id; });
  if (d.cliente_id && al.rol === 'admin') {
    sucIds = al.sucursales.filter(function (s) { return s.cliente_id === d.cliente_id; }).map(function (s) { return s.id; });
  }
  var usuarios = db.t('Usuarios');
  var reps = db.t('Repartos').filtrar(function (r) {
    return String(r.fecha).slice(0, 7) === mes && !r.eliminado && sucIds.indexOf(r.sucursal_id) >= 0;
  });
  return {
    mes: mes,
    rol: al.rol,
    sucursales: al.sucursales.filter(function (s) { return sucIds.indexOf(s.id) >= 0; }).map(function (s) {
      return { id: s.id, nombre: s.nombre, cliente_id: s.cliente_id };
    }),
    repartos: reps.map(function (r) {
      var o = tomar(r, CAMPOS_REPARTO_PANEL);
      var rep = usuarios.buscar(r.repartidor_id);
      o.repartidor = rep ? (rep.nombre_mostrar || rep.nombre) : '';
      return o;
    }),
  };
}

// ════════════════════════════════════════════════════════════════════════
// Etapa 4: paradas que carga la sucursal
// Quedan con origen 'sucursal' y reparto_id vacío hasta que el repartidor de esa sucursal las
// toma (su app las suma al reparto y las manda en el próximo sync). Mientras nadie las tomó, la
// sucursal las puede corregir o quitar; después ya no: el chofer las tiene en el celular.
// ════════════════════════════════════════════════════════════════════════

var CAMPOS_PARADA_SUCURSAL = ['direccion', 'localidad', 'telefono', 'metodo_pago', 'metodo_pago_detalle',
  'nota', 'prioridad', 'hora_limite', 'lat', 'lng', 'geo_fuente'];
var MAX_SIN_TOMAR = 80;   // por sucursal y por día

// La sucursal con la que trabaja el usuario: la suya, o la que elige el admin
function sucursalDe(db, u, sucursalId) {
  var esAdmin = tiene(u, 'admin');
  var id = esAdmin ? texto(sucursalId, 80) : u.sucursal_id;
  var s = id ? db.t('Sucursales').buscar(id) : null;
  if (!s || !s.activo) throw new Falla(esAdmin ? 'Elegí la sucursal' : 'Tu usuario no tiene sucursal asignada', 'permiso');
  return s;
}

function accSucursalParada(ctx, d) {
  var db = ctx.db, u = ctx.usuario, t = db.t('Paradas');
  var id = texto(d.id, 80);
  var viejo = id ? t.buscar(id) : null;
  if (id && !viejo) throw new Falla('La parada no existe');
  var suc = sucursalDe(db, u, viejo ? viejo.sucursal_id : d.sucursal_id);
  if (viejo) {
    if (viejo.origen !== 'sucursal' || viejo.sucursal_id !== suc.id) throw new Falla('Esa parada no es de tu sucursal', 'permiso');
    if (viejo.eliminada) throw new Falla('La parada ya estaba quitada');
    if (viejo.reparto_id) throw new Falla('El repartidor ya la tiene en su recorrido. Avisale por teléfono.');
  }

  if (d.eliminada === true) {
    if (!viejo) throw new Falla('La parada no existe');
    viejo.eliminada = true;
    viejo.actualizado_ts = Date.now();
    t.guardar(viejo);
    return { parada: tomar(viejo, CAMPOS_PARADA_PANEL) };
  }

  var fecha = viejo ? viejo.fecha : (esFecha(d.fecha) ? d.fecha : hoy());
  if (!viejo) {
    if (fecha < hoy()) throw new Falla('No se pueden cargar paradas en días que ya pasaron');
    var cargadas = t.filtrar(function (p) {
      return p.origen === 'sucursal' && p.sucursal_id === suc.id && p.fecha === fecha && !p.reparto_id && !p.eliminada;
    }).length;
    if (cargadas >= MAX_SIN_TOMAR) throw new Falla('Hay demasiadas paradas sin tomar para ese día');
  }
  var fila = Object.assign({}, viejo || {
    id: nuevoId('par'), reparto_id: '', cliente_id: suc.cliente_id, sucursal_id: suc.id, fecha: fecha,
    origen: 'sucursal', creado_por: u.id, orden: null, estado: 'pendiente', hora_pendiente: ahoraISO(),
    cliente_final: '', recibio: '', eta: '', aviso_horario: false, motivo: '', motivo_detalle: '', eliminada: false,
    metodo_pago: 'efectivo', prioridad: 'normal', hora_limite: '',
  }, tomar(d, CAMPOS_PARADA_SUCURSAL), { actualizado_ts: Date.now() });
  if (fila.prioridad !== 'hora') fila.hora_limite = '';
  validarParada(fila);
  if (fila.lat === null || fila.lng === null) throw new Falla('Falta ubicar la dirección en el mapa');
  if (fila.prioridad === 'hora' && !fila.hora_limite) throw new Falla('Falta la hora límite');
  t.guardar(fila);
  return { parada: tomar(fila, CAMPOS_PARADA_PANEL), avisados: viejo ? 0 : avisarRepartidores(db, fila) };
}

// Si el repartidor de la sucursal ya armó o salió con su reparto de hoy, le llega una notificación
// y su app suma la parada y recalcula. Si todavía no armó nada, la ve al abrir la app.
function avisarRepartidores(db, p) {
  if (p.fecha !== hoy()) return 0;
  var ids = {};
  db.t('Repartos').filtrar(function (r) {
    return r.fecha === p.fecha && r.sucursal_id === p.sucursal_id && !r.eliminado && r.estado !== 'finalizado';
  }).forEach(function (r) { ids[r.repartidor_id] = true; });
  var n = 0;
  Object.keys(ids).forEach(function (uid) {
    if (enviarPush(db, uid, '📦 Nueva parada de la sucursal', p.direccion + (p.localidad ? ', ' + p.localidad : ''), { tipo: 'parada', id: p.id })) n++;
  });
  return n;
}

// Las paradas de la sucursal que el repartidor todavía no tomó. Van también las quitadas: si el
// celular ya las había sumado y todavía no las mandó, así sabe que tiene que sacarlas.
function accSucursalPendientes(ctx, d) {
  var u = ctx.usuario;
  var fecha = esFecha(d.fecha) ? d.fecha : hoy();
  if (!u.sucursal_id) return { fecha: fecha, paradas: [] };
  var campos = ['id', 'origen', 'cliente_id', 'sucursal_id'].concat(CAMPOS_PARADA);
  var ps = ctx.db.t('Paradas').filtrar(function (p) {
    return p.origen === 'sucursal' && p.sucursal_id === u.sucursal_id && p.fecha === fecha && !p.reparto_id;
  });
  return { fecha: fecha, paradas: ps.map(function (p) { return tomar(p, campos); }) };
}

// Reparto descartado: las paradas de la sucursal que no se hicieron vuelven a quedar para tomar
function liberarParadasSucursal(db, repartoId) {
  var t = db.t('Paradas');
  t.filtrar(function (p) {
    return p.reparto_id === repartoId && p.origen === 'sucursal' && !p.eliminada && (p.estado === 'pendiente' || p.estado === 'en_camino');
  }).forEach(function (p) {
    p.reparto_id = '';
    p.estado = 'pendiente';
    p.orden = null;
    p.eta = '';
    p.aviso_horario = false;
    p.hora_en_camino = '';
    p.actualizado_ts = Date.now();
    t.guardar(p);
  });
}

// ════════════════════════════════════════════════════════════════════════
// Acciones: administración
// ════════════════════════════════════════════════════════════════════════

function accAdminDatos(ctx) {
  var db = ctx.db;
  var ahora = ahoraISO();
  return {
    usuarios: db.t('Usuarios').todas().map(function (u) {
      return {
        id: u.id, nombre: u.nombre, nombre_mostrar: u.nombre_mostrar, roles: rolesDe(u),
        cliente_id: u.cliente_id, sucursal_id: u.sucursal_id, telefono: u.telefono, activo: u.activo,
        tiene_pin: !!u.pin_hash, bloqueado: !!(u.bloqueado_hasta && u.bloqueado_hasta > ahora),
      };
    }),
    clientes: db.t('Clientes').todas().map(function (c) { return tomar(c, ['id', 'nombre', 'activo']); }),
    sucursales: db.t('Sucursales').todas().map(function (s) {
      return tomar(s, ['id', 'cliente_id', 'nombre', 'direccion', 'localidad', 'lat', 'lng', 'activo']);
    }),
  };
}

function accAdminUsuario(ctx, d) {
  var db = ctx.db, yo = ctx.usuario;
  var t = db.t('Usuarios');
  var u = d.id ? t.buscar(d.id) : null;
  if (d.id && !u) throw new Falla('Usuario no encontrado');

  var nombre = texto(d.nombre, 40).trim();
  if (!nombre) throw new Falla('Falta el nombre de usuario');
  var repetido = t.filtrar(function (x) { return normalizar(x.nombre) === normalizar(nombre) && (!u || x.id !== u.id); });
  if (repetido.length) throw new Falla('Ya existe un usuario "' + nombre + '"');

  var roles = (Array.isArray(d.roles) ? d.roles : String(d.roles || '').split(','))
    .map(function (r) { return String(r).trim(); }).filter(function (r) { return ROLES.indexOf(r) >= 0; });
  if (!roles.length) throw new Falla('Elegí al menos un rol');

  var sucursal = d.sucursal_id ? db.t('Sucursales').buscar(d.sucursal_id) : null;
  if (d.sucursal_id && !sucursal) throw new Falla('Sucursal inexistente');
  var clienteId = sucursal ? sucursal.cliente_id : (d.cliente_id || '');
  if (clienteId && !db.t('Clientes').buscar(clienteId)) throw new Falla('Cliente inexistente');
  if ((roles.indexOf('repartidor') >= 0 || roles.indexOf('sucursal') >= 0) && !sucursal) {
    throw new Falla('Repartidor y Sucursal necesitan una sucursal');
  }
  if (roles.indexOf('duenio') >= 0 && !clienteId) throw new Falla('El dueño necesita una empresa (cliente)');

  var activo = d.activo !== false;
  if (u && u.id === yo.id && (roles.indexOf('admin') < 0 || !activo)) {
    throw new Falla('No podés sacarte el rol de administrador ni desactivarte a vos mismo');
  }

  var fila = Object.assign({}, u || { id: nuevoId('usr'), creado: ahoraISO(), intentos_fallidos: 0, bloqueado_hasta: '' });
  fila.nombre = nombre;
  fila.nombre_mostrar = texto(d.nombre_mostrar, 60).trim() || nombre;
  fila.roles = roles.join(',');
  fila.sucursal_id = sucursal ? sucursal.id : '';
  fila.cliente_id = clienteId;
  fila.telefono = texto(d.telefono, 30);
  fila.activo = activo;
  fila.actualizado_ts = Date.now();

  var cambioPin = false;
  if (d.pin !== undefined && d.pin !== '') {
    if (!/^\d{4,8}$/.test(String(d.pin))) throw new Falla('El PIN tiene que tener de 4 a 8 números');
    fila.pin_salt = Utilities.getUuid().replace(/-/g, '');
    fila.pin_hash = sha256(fila.pin_salt + String(d.pin));
    fila.intentos_fallidos = 0;
    fila.bloqueado_hasta = '';
    cambioPin = true;
  }
  t.guardar(fila);
  if (u && (cambioPin || !activo) && u.id !== yo.id) cerrarSesionesDe(db, u.id);
  return { id: fila.id };
}

function accAdminCliente(ctx, d) {
  var t = ctx.db.t('Clientes');
  var c = d.id ? t.buscar(d.id) : null;
  if (d.id && !c) throw new Falla('Cliente no encontrado');
  var nombre = texto(d.nombre, 80).trim();
  if (!nombre) throw new Falla('Falta el nombre');
  var fila = Object.assign({}, c || { id: nuevoId('cli'), creado: ahoraISO() });
  fila.nombre = nombre;
  fila.activo = d.activo !== false;
  fila.actualizado_ts = Date.now();
  t.guardar(fila);
  return { id: fila.id };
}

function accAdminSucursal(ctx, d) {
  var db = ctx.db;
  var t = db.t('Sucursales');
  var s = d.id ? t.buscar(d.id) : null;
  if (d.id && !s) throw new Falla('Sucursal no encontrada');
  var nombre = texto(d.nombre, 60).trim();
  if (!nombre) throw new Falla('Falta el nombre');
  var cli = db.t('Clientes').buscar(d.cliente_id);
  if (!cli) throw new Falla('Elegí el cliente');
  var lat = numOVacio(d.lat), lng = numOVacio(d.lng);
  if ((lat === null) !== (lng === null)) throw new Falla('Ubicación incompleta');
  var fila = Object.assign({}, s || { id: nuevoId('suc') });
  fila.cliente_id = cli.id;
  fila.nombre = nombre;
  fila.direccion = texto(d.direccion, 200);
  fila.localidad = texto(d.localidad, 100);
  fila.lat = lat;
  fila.lng = lng;
  fila.activo = d.activo !== false;
  fila.actualizado_ts = Date.now();
  t.guardar(fila);
  // Los usuarios de la sucursal heredan el cliente
  db.t('Usuarios').filtrar(function (u) { return u.sucursal_id === fila.id && u.cliente_id !== cli.id; })
    .forEach(function (u) { u.cliente_id = cli.id; db.t('Usuarios').guardar(u); });
  return { id: fila.id };
}

// ════════════════════════════════════════════════════════════════════════
// Fletes (etapa 3)
// Los crea y asigna el admin (desde el panel o desde Unidades). El fletero solo ve los suyos
// y solo puede cambiar el estado. Nunca aparecen en los paneles de los clientes.
// ════════════════════════════════════════════════════════════════════════

var ESTADOS_FLETE = ['asignado', 'en_camino', 'cargando', 'en_viaje', 'realizado', 'no_realizado', 'cancelado'];
var ESTADOS_FLETE_CHOFER = ['asignado', 'en_camino', 'cargando', 'en_viaje', 'realizado', 'no_realizado'];
var CAMPOS_FLETE_CHOFER = ['estado', 'motivo', 'hora_en_camino', 'hora_cargando', 'hora_en_viaje',
  'hora_realizado', 'hora_no_realizado', 'actualizado_ts'];
var CAMPOS_FLETE_VISIBLES = ['id', 'fletero_id', 'cliente', 'telefono', 'dir_retiro', 'loc_retiro', 'lat_retiro', 'lng_retiro',
  'dir_entrega', 'loc_entrega', 'lat_entrega', 'lng_entrega', 'fecha', 'hora', 'nota', 'estado', 'motivo',
  'hora_asignado', 'hora_en_camino', 'hora_cargando', 'hora_en_viaje', 'hora_realizado', 'hora_no_realizado',
  'hora_cancelado', 'actualizado_ts'];

function fleteroValido(db, id) {
  var f = id ? db.t('Usuarios').buscar(id) : null;
  if (!f || !f.activo || !tiene(f, 'fletero')) throw new Falla('Elegí un fletero activo');
  return f;
}

function fletePublico(db, f, conAdmin) {
  var o = tomar(f, CAMPOS_FLETE_VISIBLES);
  var u = db.t('Usuarios').buscar(f.fletero_id);
  o.fletero = u ? (u.nombre_mostrar || u.nombre) : '';
  if (conAdmin) { o.origen = f.origen; o.unidades_job_id = f.unidades_job_id; }
  return o;
}

// Lo que el fletero ve: sus fletes sin terminar, más los de los últimos 2 días (para el historial
// y para que se entere si se lo cancelaron)
function accFletesMios(ctx) {
  var db = ctx.db, u = ctx.usuario;
  var desde = Utilities.formatDate(new Date(Date.now() - 2 * 86400000), TZ, 'yyyy-MM-dd');
  var abiertos = ['asignado', 'en_camino', 'cargando', 'en_viaje'];
  var lista = db.t('Fletes').filtrar(function (f) {
    return f.fletero_id === u.id && (abiertos.indexOf(f.estado) >= 0 || f.fecha >= desde);
  });
  return { fletes: lista.map(function (f) { return fletePublico(db, f, false); }) };
}

// Cambios de estado que manda el fletero (por la cola, igual que las paradas)
function syncFletes(db, u, lista, aplicados, ignorados, rechazados) {
  var t = db.t('Fletes');
  lista.forEach(function (x) {
    var id = texto(x && x.id, 80);
    try {
      if (!tiene(u, 'fletero')) throw new Falla('No sos fletero', 'permiso');
      var viejo = t.buscar(id);
      if (!viejo) throw new Falla('Flete inexistente');
      if (viejo.fletero_id !== u.id) throw new Falla('El flete no es tuyo', 'permiso');
      if (viejo.estado === 'cancelado') throw new Falla('El flete fue cancelado');
      var nuevo = tomar(x, CAMPOS_FLETE_CHOFER);
      nuevo.actualizado_ts = Number(nuevo.actualizado_ts) || 0;
      if (viejo.actualizado_ts > nuevo.actualizado_ts) { ignorados.push(id); return; }
      exigirUno(nuevo.estado, ESTADOS_FLETE_CHOFER, 'estado');
      ['hora_en_camino', 'hora_cargando', 'hora_en_viaje', 'hora_realizado', 'hora_no_realizado'].forEach(function (c) {
        if (!esISO(nuevo[c])) throw new Falla('Hora inválida en ' + c);
      });
      nuevo.motivo = texto(nuevo.motivo, 300);
      t.guardar(Object.assign({}, viejo, nuevo));
      aplicados.push(id);
    } catch (err) {
      rechazados.push({ id: id, error: err.message || String(err) });
    }
  });
}

function accAdminFletes(ctx, d) {
  var db = ctx.db;
  var desde = esFecha(d.desde) ? d.desde : hoy();
  var hasta = esFecha(d.hasta) ? d.hasta : desde;
  var lista = db.t('Fletes').filtrar(function (f) { return f.fecha >= desde && f.fecha <= hasta; });
  lista.sort(function (a, b) { return (a.fecha + a.hora).localeCompare(b.fecha + b.hora); });
  return { fletes: lista.map(function (f) { return fletePublico(db, f, true); }) };
}

function accFleteros(ctx) {
  return {
    fleteros: ctx.db.t('Usuarios').filtrar(function (u) { return u.activo && tiene(u, 'fletero'); })
      .map(function (u) { return { id: u.id, nombre: u.nombre_mostrar || u.nombre }; }),
  };
}

// Crear, editar, reasignar o cancelar (admin)
function accAdminFlete(ctx, d) {
  var res = guardarFlete(ctx.db, ctx.usuario, d, 'admin');
  return { flete: fletePublico(ctx.db, res, true) };
}

function guardarFlete(db, admin, d, origen) {
  var t = db.t('Fletes');
  var viejo = d.id ? t.buscar(d.id) : null;
  if (d.id && !viejo) throw new Falla('Flete no encontrado');
  var ahora = ahoraISO();
  var f = Object.assign({}, viejo || {
    id: nuevoId('fle'), origen: origen, unidades_job_id: '', estado: 'asignado',
    hora_asignado: ahora, creado_por: admin.id, motivo: '',
  });
  var avisar = null;

  if (d.cancelar === true) {
    if (!viejo) throw new Falla('Flete no encontrado');
    if (viejo.estado === 'cancelado') return viejo;
    f.estado = 'cancelado';
    f.hora_cancelado = ahora;
    f.motivo = texto(d.motivo, 300);
    avisar = { usuario: f.fletero_id, titulo: 'Flete cancelado', cuerpo: (f.cliente || 'Flete') + ' · ' + fechaCorta(f.fecha) + ' ' + (f.hora || '') };
  } else {
    var cliente = texto(d.cliente, 120).trim();
    if (!cliente) throw new Falla('Falta el cliente');
    if (!texto(d.dir_retiro, 200).trim() || !texto(d.dir_entrega, 200).trim()) throw new Falla('Faltan las direcciones de retiro y entrega');
    if (!esFecha(d.fecha)) throw new Falla('Fecha inválida');
    if (d.hora && !/^\d{2}:\d{2}$/.test(String(d.hora))) throw new Falla('Hora inválida');
    var fletero = fleteroValido(db, d.fletero_id);

    f.cliente = cliente;
    f.telefono = texto(d.telefono, 40);
    f.dir_retiro = texto(d.dir_retiro, 200);
    f.loc_retiro = texto(d.loc_retiro, 100);
    f.dir_entrega = texto(d.dir_entrega, 200);
    f.loc_entrega = texto(d.loc_entrega, 100);
    ['lat_retiro', 'lng_retiro', 'lat_entrega', 'lng_entrega'].forEach(function (c) { f[c] = numOVacio(d[c]); });
    f.fecha = d.fecha;
    f.hora = texto(d.hora, 5);
    f.nota = texto(d.nota, 2000);
    if (d.unidades_job_id) f.unidades_job_id = texto(d.unidades_job_id, 80);

    var resumen = cliente + ' · ' + fechaCorta(f.fecha) + (f.hora ? ' ' + f.hora : '');
    if (!viejo || viejo.estado === 'cancelado') {
      // Nuevo, o uno cancelado que se vuelve a asignar: arranca de cero
      f.estado = 'asignado';
      f.hora_asignado = ahora;
      ['hora_en_camino', 'hora_cargando', 'hora_en_viaje', 'hora_realizado', 'hora_no_realizado', 'hora_cancelado']
        .forEach(function (c) { f[c] = ''; });
      f.motivo = '';
      f.fletero_id = fletero.id;
      avisar = { usuario: fletero.id, titulo: 'Flete nuevo', cuerpo: resumen };
    } else if (viejo.fletero_id !== fletero.id) {
      // Reasignado: el anterior deja de verlo y el nuevo arranca de cero
      if (viejo.fletero_id) enviarPush(db, viejo.fletero_id, 'Flete reasignado', resumen + ' ya no está a tu cargo', { tipo: 'flete', id: f.id });
      f.fletero_id = fletero.id;
      f.estado = 'asignado';
      f.hora_asignado = ahora;
      ['hora_en_camino', 'hora_cargando', 'hora_en_viaje', 'hora_realizado', 'hora_no_realizado']
        .forEach(function (c) { f[c] = ''; });
      avisar = { usuario: fletero.id, titulo: 'Flete nuevo', cuerpo: resumen };
    } else {
      avisar = { usuario: fletero.id, titulo: 'Flete modificado', cuerpo: resumen };
    }
  }
  f.actualizado_ts = Date.now();
  var guardado = t.guardar(f);
  if (avisar) enviarPush(db, avisar.usuario, avisar.titulo, avisar.cuerpo, { tipo: 'flete', id: f.id });
  return guardado;
}

function fechaCorta(f) {
  var p = String(f || '').split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : f;
}

// ── Enganche con Unidades ─────────────────────────────────────────────────
// Unidades manda un trabajo; se crea o actualiza el flete con ese ID de Unidades.
// La nota del flete es la comanda de Unidades (con precios, como la que se copia para WhatsApp).
// Los fletes nunca llegan a los paneles de los clientes.
function accUnidadesAsignar(ctx, d) {
  var db = ctx.db;
  var job = d.job || {};
  var jobId = texto(job.id, 80);
  if (!jobId) throw new Falla('Falta el ID del trabajo de Unidades');
  var existente = db.t('Fletes').filtrar(function (f) { return f.unidades_job_id === jobId; })
    .sort(function (a, b) { return (b.actualizado_ts || 0) - (a.actualizado_ts || 0); })[0];
  // Si Unidades manda su comanda (la misma que se copia para WhatsApp), va tal cual, sin los
  // asteriscos de negrita. Si no (versión vieja de Unidades), se arma la nota con los datos sueltos.
  var nota = job.comanda ? String(job.comanda).replace(/\*/g, '').replace(/\n{3,}/g, '\n\n').trim() : [
    job.inventario ? 'Inventario: ' + job.inventario : '',
    job.peones ? 'Peones: ' + job.peones : '',
    job.viaja ? 'Viaja en la unidad: ' + job.viaja : '',
    job.telefonoEntrega ? 'Tel. entrega: ' + job.telefonoEntrega : '',
    job.aclaraciones ? 'Aclaraciones: ' + job.aclaraciones : '',
  ].filter(Boolean).join('\n');
  var f = guardarFlete(db, ctx.usuario, {
    id: existente ? existente.id : undefined,
    unidades_job_id: jobId,
    cliente: job.nombre, telefono: job.telefono,
    dir_retiro: job.dirRetiro, loc_retiro: job.locRetiro,
    dir_entrega: job.dirEntrega, loc_entrega: job.locEntrega,
    fecha: job.fecha, hora: job.hora, nota: nota,
    fletero_id: d.fletero_id,
  }, 'unidades');
  return { flete: fletePublico(db, f, true) };
}

// Solo lectura: estado de los fletes de una lista de trabajos de Unidades
function accUnidadesEstados(ctx, d) {
  var db = ctx.db;
  var ids = Array.isArray(d.ids) ? d.ids.slice(0, 200).map(function (x) { return String(x); }) : [];
  var res = {};
  db.t('Fletes').filtrar(function (f) { return f.unidades_job_id && ids.indexOf(f.unidades_job_id) >= 0; })
    .forEach(function (f) {
      var prev = res[f.unidades_job_id];
      if (prev && prev.actualizado_ts > f.actualizado_ts) return;
      var u = db.t('Usuarios').buscar(f.fletero_id);
      res[f.unidades_job_id] = {
        flete_id: f.id, estado: f.estado, fletero: u ? (u.nombre_mostrar || u.nombre) : '',
        hora: f['hora_' + f.estado] || f.hora_asignado, motivo: f.estado === 'no_realizado' ? f.motivo : '',
        actualizado_ts: f.actualizado_ts,
      };
    });
  return { estados: res };
}

// ════════════════════════════════════════════════════════════════════════
// Notificaciones push (Firebase Cloud Messaging)
// Apagadas hasta que se cargue la cuenta de servicio de Firebase con el menú
// "Configurar notificaciones". La clave queda en las propiedades del script, nunca en el código.
// ════════════════════════════════════════════════════════════════════════

function accPushRegistrar(ctx, d) {
  var tok = texto(d.token, 400);
  if (tok.length < 20) throw new Falla('Token inválido');
  var t = ctx.db.t('Dispositivos');
  var viejo = t.buscar(tok);
  t.guardar(Object.assign({}, viejo || { token: tok, creado: ahoraISO() }, {
    usuario_id: ctx.usuario.id, actualizado: ahoraISO(), agente: texto(d.agente, 120),
  }));
  return { activo: !!PropertiesService.getScriptProperties().getProperty('FCM_CUENTA') };
}

function cuentaFCM() {
  var raw = PropertiesService.getScriptProperties().getProperty('FCM_CUENTA');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function b64url(x) {
  return Utilities.base64EncodeWebSafe(x).replace(/=+$/, '');
}

function tokenFCM(cta) {
  var cache = CacheService.getScriptCache();
  var t = cache.get('fcm_token');
  if (t) return t;
  var ahora = Math.floor(Date.now() / 1000);
  var cab = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var cuerpo = b64url(JSON.stringify({
    iss: cta.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600,
  }));
  var firma = b64url(Utilities.computeRsaSha256Signature(cab + '.' + cuerpo, cta.private_key));
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: cab + '.' + cuerpo + '.' + firma },
  });
  var j = JSON.parse(r.getContentText());
  if (!j.access_token) throw new Error('FCM: no se pudo obtener el token (' + r.getResponseCode() + ')');
  cache.put('fcm_token', j.access_token, 3000);
  return j.access_token;
}

// Manda una notificación a todos los celulares del usuario. Nunca rompe la acción que la llama.
function enviarPush(db, usuarioId, titulo, cuerpo, datos) {
  try {
    var cta = cuentaFCM();
    if (!cta || !usuarioId) return 0;
    var t = db.t('Dispositivos');
    var dispositivos = t.filtrar(function (x) { return x.usuario_id === usuarioId && x.token; });
    if (!dispositivos.length) return 0;
    var acceso = tokenFCM(cta);
    var url = 'https://fcm.googleapis.com/v1/projects/' + cta.project_id + '/messages:send';
    var data = Object.assign({ titulo: String(titulo), cuerpo: String(cuerpo) }, datos || {});
    Object.keys(data).forEach(function (k) { data[k] = String(data[k]); });
    var pedidos = dispositivos.map(function (x) {
      return {
        url: url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + acceso },
        payload: JSON.stringify({ message: { token: x.token, data: data, webpush: { headers: { Urgency: 'high', TTL: '86400' } } } }),
      };
    });
    var resps = UrlFetchApp.fetchAll(pedidos);
    var ok = 0;
    resps.forEach(function (r, i) {
      var c = r.getResponseCode();
      if (c === 200) ok++;
      // Celular que desinstaló la app o revocó el permiso: se lo saca de la lista
      else if (c === 404 || (c === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(r.getContentText()))) {
        var d = dispositivos[i];
        d.token = '';
        d.usuario_id = '';
        t.guardar(d);
      }
    });
    return ok;
  } catch (err) {
    console.error('Push: ' + (err && err.message));
    return 0;
  }
}

function menuConfigurarPush() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Notificaciones push',
    'Pegá el contenido COMPLETO del archivo .json de la cuenta de servicio de Firebase\n(Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada):',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var j;
  try { j = JSON.parse(r.getResponseText()); } catch (e) { ui.alert('Eso no es un JSON válido. Copiá el archivo entero, desde la primera { hasta la última }.'); return; }
  if (!j.project_id || !j.client_email || !j.private_key) { ui.alert('El archivo no parece una cuenta de servicio de Firebase (faltan project_id, client_email o private_key).'); return; }
  PropertiesService.getScriptProperties().setProperty('FCM_CUENTA', JSON.stringify({ project_id: j.project_id, client_email: j.client_email, private_key: j.private_key }));
  CacheService.getScriptCache().remove('fcm_token');
  try {
    tokenFCM(cuentaFCM());
    ui.alert('Listo: notificaciones activadas para el proyecto ' + j.project_id + '.');
  } catch (e) {
    ui.alert('Se guardó, pero Google no aceptó la clave: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Menú de la planilla
// ════════════════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Reparto TyM')
    .addItem('1. Inicializar planilla', 'inicializar')
    .addItem('Cambiar PIN de un usuario', 'menuCambiarPin')
    .addItem('Verificar accesos por rol', 'verificarAccesos')
    .addItem('Limpiar sesiones vencidas', 'menuLimpiarSesiones')
    .addItem('Configurar notificaciones push', 'menuConfigurarPush')
    .addToUi();
}

// Crea las hojas, los encabezados y la precarga. Se puede correr más de una vez: no duplica.
function inicializar() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  Object.keys(HOJAS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    var cols = HOJAS[nombre];
    // Texto plano en todas las celdas: así Sheets no convierte "10:30" ni "2026-10-11" en fechas
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (nombre === 'Sesiones' || nombre === 'Dispositivos') sh.hideSheet();
  });
  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && hoja1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);

  var db = new Base();
  var precargado = precargar(db);

  var admin = db.t('Usuarios').filtrar(function (u) { return tiene(u, 'admin'); })[0];
  if (admin && !admin.pin_hash) {
    var r = ui.prompt('PIN del administrador',
      'Elegí el PIN de ' + admin.nombre_mostrar + ' (4 a 8 números). Con eso entrás al panel.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() === ui.Button.OK) {
      var pin = r.getResponseText().trim();
      if (/^\d{4,8}$/.test(pin)) {
        admin.pin_salt = Utilities.getUuid().replace(/-/g, '');
        admin.pin_hash = sha256(admin.pin_salt + pin);
        db.t('Usuarios').guardar(admin);
      } else {
        ui.alert('El PIN tiene que tener de 4 a 8 números. Volvé a correr "Inicializar planilla".');
      }
    }
  }
  ui.alert('Listo.' + (precargado ? ' Se cargaron el cliente, las 3 sucursales y los 6 choferes.' : ' Las hojas ya estaban creadas.'));
}

function precargar(db) {
  var tC = db.t('Clientes'), tS = db.t('Sucursales'), tU = db.t('Usuarios');
  if (tC.todas().length || tU.todas().length) return false;
  var ahora = ahoraISO(), ts = Date.now();
  var cli = tC.guardar({ id: nuevoId('cli'), nombre: 'Veterinaria', activo: true, creado: ahora, actualizado_ts: ts });
  var suc = {};
  ['BELGRANO', 'TRIUNVIRATO', 'WARNES'].forEach(function (n) {
    suc[n] = tS.guardar({ id: nuevoId('suc'), cliente_id: cli.id, nombre: n, direccion: '', localidad: '', lat: null, lng: null, activo: true, actualizado_ts: ts });
  });
  var usuarios = [
    ['Martin', 'Martín', 'admin,repartidor', 'TRIUNVIRATO'],
    ['Enzo', 'Enzo', 'repartidor', 'WARNES'],
    ['Mariano', 'Mariano', 'repartidor', 'BELGRANO'],
    ['Rodeo', 'Rodeo', 'fletero', null],
    ['Marcelo', 'Marcelo', 'fletero', null],
    ['Manolo', 'Manolo', 'fletero', null],
  ];
  usuarios.forEach(function (x) {
    tU.guardar({
      id: nuevoId('usr'), nombre: x[0], nombre_mostrar: x[1], roles: x[2],
      cliente_id: x[3] ? cli.id : '', sucursal_id: x[3] ? suc[x[3]].id : '', telefono: '',
      pin_hash: '', pin_salt: '', intentos_fallidos: 0, bloqueado_hasta: '', activo: true, creado: ahora, actualizado_ts: ts,
    });
  });
  return true;
}

// Rescate: si el administrador se olvida el PIN, se cambia desde la planilla
function menuCambiarPin() {
  var ui = SpreadsheetApp.getUi();
  var r1 = ui.prompt('Cambiar PIN', 'Nombre de usuario:', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  var db = new Base();
  var u = db.t('Usuarios').filtrar(function (x) { return normalizar(x.nombre) === normalizar(r1.getResponseText()); })[0];
  if (!u) { ui.alert('No existe ese usuario.'); return; }
  var r2 = ui.prompt('Cambiar PIN', 'Nuevo PIN para ' + u.nombre_mostrar + ' (4 a 8 números):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  var pin = r2.getResponseText().trim();
  if (!/^\d{4,8}$/.test(pin)) { ui.alert('El PIN tiene que tener de 4 a 8 números.'); return; }
  u.pin_salt = Utilities.getUuid().replace(/-/g, '');
  u.pin_hash = sha256(u.pin_salt + pin);
  u.intentos_fallidos = 0;
  u.bloqueado_hasta = '';
  db.t('Usuarios').guardar(u);
  cerrarSesionesDe(db, u.id);
  ui.alert('PIN cambiado. Las sesiones abiertas de ' + u.nombre_mostrar + ' se cerraron.');
}

function menuLimpiarSesiones() {
  limpiarSesionesVencidas(new Base());
  SpreadsheetApp.getUi().alert('Sesiones vencidas borradas.');
}

// ════════════════════════════════════════════════════════════════════════
// Verificación de accesos por rol
// Para cada rol toma un usuario real, abre una sesión de prueba, llama a cada acción por
// el mismo camino que el celular (manejar) y revisa la RESPUESTA del script: que no traiga
// datos de otra sucursal, de otra empresa, de otro repartidor, ni secretos, ni fletes.
// Escribe el detalle en la hoja "Verificación".
// ════════════════════════════════════════════════════════════════════════

function verificarAccesos() {
  var res = correrVerificacion();
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Verificación') || ss.insertSheet('Verificación');
  sh.clear();
  var filas = [['Resultado', 'Rol', 'Usuario', 'Acción', 'Detalle']].concat(res.filas);
  sh.getRange(1, 1, filas.length, 5).setValues(filas);
  sh.getRange(1, 1, 1, 5).setFontWeight('bold');
  SpreadsheetApp.getUi().alert(res.fallas ? '⚠ ' + res.fallas + ' problema(s). Mirá la hoja "Verificación".' : '✓ Todos los roles reciben solo sus datos. Detalle en la hoja "Verificación".');
}

function correrVerificacion() {
  var db = new Base();
  var filas = [], fallas = 0;
  var sesiones = [];
  function anotar(ok, rol, u, acc, det) {
    if (!ok) fallas++;
    filas.push([ok ? 'OK' : 'FALLA', rol, u ? u.nombre : '-', acc, det]);
  }
  function abrir(u) {
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    db.t('Sesiones').guardar({ token_hash: sha256(token), usuario_id: u.id, creado: ahoraISO(),
      expira: Utilities.formatDate(new Date(Date.now() + 600000), TZ, "yyyy-MM-dd'T'HH:mm:ss") + '-03:00',
      ultimo_uso: ahoraISO(), dispositivo: 'verificación' });
    sesiones.push(sha256(token));
    return token;
  }
  function llamar(token, accion, datos) {
    return manejar({ accion: accion, token: token, datos: datos || {} });
  }
  function sinSecretosF(res) { return !/pin_hash|pin_salt|token_hash|unidades_job_id|creado_por/.test(JSON.stringify(res)); }
  function sinSecretos(res) {
    var s = JSON.stringify(res);
    return !/pin_hash|pin_salt|token_hash/.test(s) && !/"fletero_id"|"unidades_job_id"/.test(s);
  }

  var usuarios = db.t('Usuarios').filtrar(function (u) { return u.activo; });
  var fechas = {};
  db.t('Repartos').todas().forEach(function (r) { fechas[r.fecha] = true; });
  var listaFechas = Object.keys(fechas).sort().slice(-5);
  if (!listaFechas.length) listaFechas = [hoy()];
  var meses = {};
  listaFechas.forEach(function (f) { meses[f.slice(0, 7)] = true; });

  // Sin token y con token inventado: nada
  ['panel.dia', 'admin.datos', 'mis.repartos', 'sync', 'fletes.mios', 'admin.fletes', 'unidades.estados'].forEach(function (a) {
    var r = manejar({ accion: a, token: '', datos: {} });
    anotar(!r.ok && r.codigo === 'auth', 'sin sesión', null, a, r.ok ? 'respondió datos' : 'rechazado');
    var r2 = manejar({ accion: a, token: 'x'.repeat(64), datos: {} });
    anotar(!r2.ok && r2.codigo === 'auth', 'token falso', null, a, r2.ok ? 'respondió datos' : 'rechazado');
  });

  ['sucursal', 'duenio', 'repartidor', 'fletero', 'admin'].forEach(function (rol) {
    // Primero alguien que tenga SOLO ese rol (Martín es admin y repartidor: no sirve para probar al repartidor)
    var u = usuarios.filter(function (x) { return rolesDe(x).join() === rol && x.pin_hash; })[0] ||
      usuarios.filter(function (x) { return tiene(x, rol); })[0];
    if (!u) { filas.push(['—', rol, '-', '-', 'No hay usuarios con este rol todavía']); return; }
    var tk = abrir(u);
    var esAdmin = tiene(u, 'admin');
    var veDuenio = !esAdmin && tiene(u, 'duenio');
    var veSuc = !esAdmin && !veDuenio && tiene(u, 'sucursal');

    // panel.dia
    listaFechas.forEach(function (f) {
      var r = llamar(tk, 'panel.dia', { fecha: f });
      if (!esAdmin && !veDuenio && !veSuc) {
        anotar(!r.ok && r.codigo === 'permiso', rol, u, 'panel.dia ' + f, r.ok ? 'recibió datos del panel' : 'rechazado');
        return;
      }
      if (!r.ok) { anotar(false, rol, u, 'panel.dia ' + f, r.error); return; }
      var ajenos = r.repartos.filter(function (x) {
        var suc = db.t('Sucursales').buscar(x.sucursal_id);
        if (veSuc) return x.sucursal_id !== u.sucursal_id;
        if (veDuenio) return !suc || suc.cliente_id !== u.cliente_id;
        return false;
      });
      var repIds = r.repartos.map(function (x) { return x.id; });
      var paradasAjenas = r.paradas.filter(function (p) { return repIds.indexOf(p.reparto_id) < 0; });
      var sinTomarAjenas = (r.sin_tomar || []).filter(function (p) {
        var suc = db.t('Sucursales').buscar(p.sucursal_id);
        return veSuc ? p.sucursal_id !== u.sucursal_id : veDuenio ? !suc || suc.cliente_id !== u.cliente_id : false;
      });
      var sucAjenas = r.sucursales.filter(function (s) {
        return veSuc ? s.id !== u.sucursal_id : veDuenio ? s.cliente_id !== u.cliente_id : false;
      });
      var esperados = db.t('Repartos').filtrar(function (x) {
        if (x.fecha !== f || x.eliminado) return false;
        if (esAdmin) return true;
        var suc = db.t('Sucursales').buscar(x.sucursal_id);
        return veSuc ? x.sucursal_id === u.sucursal_id : suc && suc.cliente_id === u.cliente_id;
      }).length;
      var ok = !ajenos.length && !paradasAjenas.length && !sucAjenas.length && !sinTomarAjenas.length && sinSecretos(r) && r.repartos.length === esperados;
      anotar(ok, rol, u, 'panel.dia ' + f, r.repartos.length + ' repartos / ' + r.paradas.length + ' paradas' +
        (ajenos.length ? ' · ' + ajenos.length + ' repartos AJENOS' : '') +
        (sucAjenas.length ? ' · sucursales ajenas' : '') +
        (sinTomarAjenas.length ? ' · ' + sinTomarAjenas.length + ' paradas sin tomar AJENAS' : '') +
        (r.repartos.length !== esperados ? ' · esperaba ' + esperados : ''));
    });

    // panel.mes
    Object.keys(meses).forEach(function (m) {
      var r = llamar(tk, 'panel.mes', { mes: m });
      if (!esAdmin && !veDuenio) {
        anotar(!r.ok && r.codigo === 'permiso', rol, u, 'panel.mes ' + m, r.ok ? 'recibió el resumen mensual' : 'rechazado');
        return;
      }
      if (!r.ok) { anotar(false, rol, u, 'panel.mes ' + m, r.error); return; }
      var ajenos = r.repartos.filter(function (x) {
        if (esAdmin) return false;
        var suc = db.t('Sucursales').buscar(x.sucursal_id);
        return !suc || suc.cliente_id !== u.cliente_id;
      });
      anotar(!ajenos.length && sinSecretos(r), rol, u, 'panel.mes ' + m, r.repartos.length + ' repartos' + (ajenos.length ? ' · ' + ajenos.length + ' AJENOS' : ''));
    });

    // admin.datos
    var ad = llamar(tk, 'admin.datos', {});
    if (esAdmin) anotar(ad.ok && sinSecretos(ad), rol, u, 'admin.datos', ad.ok ? ad.usuarios.length + ' usuarios, sin PIN ni hash' : ad.error);
    else anotar(!ad.ok && ad.codigo === 'permiso', rol, u, 'admin.datos', ad.ok ? 'recibió usuarios' : 'rechazado');

    // mis.repartos
    listaFechas.forEach(function (f) {
      var mr = llamar(tk, 'mis.repartos', { fecha: f });
      if (!tiene(u, 'repartidor')) {
        anotar(!mr.ok && mr.codigo === 'permiso', rol, u, 'mis.repartos ' + f, mr.ok ? 'recibió repartos' : 'rechazado');
        return;
      }
      var ajenos = (mr.repartos || []).filter(function (x) { return x.repartidor_id !== u.id; });
      var ids = (mr.repartos || []).map(function (x) { return x.id; });
      var pAjenas = (mr.paradas || []).filter(function (p) { return ids.indexOf(p.reparto_id) < 0; });
      anotar(mr.ok && !ajenos.length && !pAjenas.length && sinSecretos(mr), rol, u, 'mis.repartos ' + f,
        mr.ok ? mr.repartos.length + ' repartos propios' + (ajenos.length + pAjenas.length ? ' · DATOS AJENOS' : '') : mr.error);
    });

    // Fletes: el fletero ve solo los suyos; nadie más que el admin ve los de todos
    var fm = llamar(tk, 'fletes.mios', {});
    if (tiene(u, 'fletero')) {
      var ajenosF = (fm.fletes || []).filter(function (x) { return x.fletero_id !== u.id; });
      anotar(fm.ok && !ajenosF.length && sinSecretosF(fm), rol, u, 'fletes.mios',
        fm.ok ? fm.fletes.length + ' fletes propios' + (ajenosF.length ? ' · ' + ajenosF.length + ' AJENOS' : '') : fm.error);
    } else {
      anotar(!fm.ok && fm.codigo === 'permiso', rol, u, 'fletes.mios', fm.ok ? 'recibió fletes' : 'rechazado');
    }
    ['admin.fletes', 'unidades.estados', 'fleteros'].forEach(function (a) {
      var r = llamar(tk, a, { ids: [] });
      if (esAdmin) anotar(r.ok, rol, u, a, r.ok ? 'ok' : r.error);
      else anotar(!r.ok && r.codigo === 'permiso', rol, u, a, r.ok ? 'recibió datos de fletes' : 'rechazado');
    });
    if (tiene(u, 'fletero')) {
      var fAjeno = db.t('Fletes').filtrar(function (x) { return x.fletero_id && x.fletero_id !== u.id; })[0];
      if (fAjeno) {
        var sf = llamar(tk, 'sync', { fletes: [{ id: fAjeno.id, estado: 'realizado', actualizado_ts: Date.now() + 1e9 }] });
        anotar(sf.ok && sf.rechazados.length === 1 && !sf.aplicados.length, rol, u, 'sync flete ajeno', sf.ok ? (sf.rechazados.length ? 'rechazado' : 'APLICADO') : sf.error);
      }
    }

    // Etapa 4: cargar paradas solo sucursal y admin; las sin tomar, solo las de la propia sucursal
    var sp = llamar(tk, 'sucursal.parada', { id: 'par_no_existe' });
    if (esAdmin || tiene(u, 'sucursal')) anotar(!sp.ok && sp.codigo !== 'permiso' && sp.codigo !== 'auth', rol, u, 'sucursal.parada', sp.ok ? 'aceptó una parada inexistente' : 'permitido (' + sp.error + ')');
    else anotar(!sp.ok && sp.codigo === 'permiso', rol, u, 'sucursal.parada', sp.ok ? 'pudo cargar paradas' : 'rechazado');
    var pend = llamar(tk, 'sucursal.pendientes', {});
    if (tiene(u, 'repartidor')) {
      var pAj = (pend.paradas || []).filter(function (p) { return p.sucursal_id !== u.sucursal_id || p.reparto_id; });
      anotar(pend.ok && !pAj.length && sinSecretos(pend), rol, u, 'sucursal.pendientes', pend.ok ? pend.paradas.length + ' sin tomar' + (pAj.length ? ' · AJENAS' : '') : pend.error);
    } else anotar(!pend.ok && pend.codigo === 'permiso', rol, u, 'sucursal.pendientes', pend.ok ? 'recibió paradas' : 'rechazado');

    // sync sobre un reparto ajeno: tiene que rechazarse
    if (tiene(u, 'repartidor')) {
      var ajeno = db.t('Repartos').filtrar(function (x) { return x.repartidor_id && x.repartidor_id !== u.id; })[0];
      if (ajeno) {
        var s = llamar(tk, 'sync', { repartos: [{ id: ajeno.id, fecha: ajeno.fecha, estado: ajeno.estado, actualizado_ts: Date.now() + 1e9 }] });
        anotar(s.ok && s.rechazados.length === 1 && !s.aplicados.length, rol, u, 'sync reparto ajeno', s.ok ? (s.rechazados.length ? 'rechazado' : 'APLICADO') : s.error);
      }
    } else if (!tiene(u, 'fletero')) {
      var s2 = llamar(tk, 'sync', { repartos: [] });
      anotar(!s2.ok && s2.codigo === 'permiso', rol, u, 'sync', s2.ok ? 'aceptado' : 'rechazado');
    } else {
      var rAj = db.t('Repartos').filtrar(function (x) { return x.repartidor_id; })[0];
      if (rAj) {
        var s3 = llamar(tk, 'sync', { repartos: [{ id: rAj.id, fecha: rAj.fecha, estado: 'finalizado', actualizado_ts: Date.now() + 1e9 }] });
        anotar(s3.ok && s3.rechazados.length === 1 && !s3.aplicados.length, rol, u, 'sync reparto (siendo fletero)', s3.ok ? (s3.rechazados.length ? 'rechazado' : 'APLICADO') : s3.error);
      }
    }
  });

  // Borrar las sesiones de prueba
  var t = db.t('Sesiones');
  t._filas = null;
  t.reescribir(t.todas().filter(function (s) { return sesiones.indexOf(s.token_hash) < 0; }));
  return { filas: filas, fallas: fallas };
}
