// storage.js — caché en memoria + localStorage (backup offline) + Google Sheets (nube)

const JOBS_KEY    = 'mtym_jobs_v3';
const GASTOS_KEY  = 'mtym_gastos_v3';
const ROW_MAP_KEY = 'mtym_rowmap';

var _jobs   = null;  // array en memoria, null = todavía no cargado
var _gastos = null;
var _rowMap = (function() {
  try { return JSON.parse(localStorage.getItem(ROW_MAP_KEY) || '{}'); }
  catch (e) { return {}; }
})();

function _saveRowMap() {
  localStorage.setItem(ROW_MAP_KEY, JSON.stringify(_rowMap));
}

// ── Helpers localStorage ──────────────────────────────────────────────────
function _loadJobsLocal() {
  try { return JSON.parse(localStorage.getItem(JOBS_KEY) || '[]'); }
  catch (e) { return []; }
}
function _saveJobsLocal() {
  localStorage.setItem(JOBS_KEY, JSON.stringify(_jobs || []));
}
function _loadGastosLocal() {
  try { return JSON.parse(localStorage.getItem(GASTOS_KEY) || '{}'); }
  catch (e) { return {}; }
}
function _saveGastosLocal() {
  localStorage.setItem(GASTOS_KEY, JSON.stringify(_gastos || {}));
}

// ── Carga inicial desde localStorage ─────────────────────────────────────
function _ensureLoaded() {
  if (_jobs   === null) _jobs   = _loadJobsLocal();
  if (_gastos === null) _gastos = _loadGastosLocal();
}

function generateId() {
  return 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

// ── API sincrónica (sin cambios de interfaz para app.js) ──────────────────
function getAll() {
  _ensureLoaded();
  return _jobs.slice();
}

function getById(id) {
  _ensureLoaded();
  return _jobs.filter(function (j) { return j.id === id; })[0] || null;
}

function getByFecha(fechaStr) {
  _ensureLoaded();
  return _jobs
    .filter(function (j) { return j.fecha === fechaStr; })
    .sort(function (a, b) { return (a.hora || '').localeCompare(b.hora || ''); });
}

function getByMes(year, month) {
  _ensureLoaded();
  var prefix = year + '-' + String(month).padStart(2, '0');
  return _jobs.filter(function (j) { return j.fecha && j.fecha.startsWith(prefix); });
}

function saveJob(job) {
  _ensureLoaded();
  var idx = -1;
  for (var i = 0; i < _jobs.length; i++) {
    if (_jobs[i].id === job.id) { idx = i; break; }
  }
  job.actualizadoEn = Date.now();
  if (idx >= 0) {
    _jobs[idx] = Object.assign({}, _jobs[idx], job);
    job = _jobs[idx];
  } else {
    job.id       = job.id || generateId();
    job.creadoEn = Date.now();
    _jobs.push(job);
  }
  _saveJobsLocal();
  return job;
}

function deleteJob(id) {
  _ensureLoaded();
  _jobs = _jobs.filter(function (j) { return j.id !== id; });
  _saveJobsLocal();
}

function getGastos(fechaStr, unidadId) {
  _ensureLoaded();
  return Number(_gastos[fechaStr + '__' + unidadId]) || 0;
}

function saveGastos(fechaStr, unidadId, amount) {
  _ensureLoaded();
  var key = fechaStr + '__' + unidadId;
  if (amount > 0) _gastos[key] = amount;
  else            delete _gastos[key];
  _saveGastosLocal();
}

function getAllGastos() { _ensureLoaded(); return Object.assign({}, _gastos); }

// ── Google Sheets: carga inicial ──────────────────────────────────────────
// Lee todos los trabajos del Sheet y los fusiona con el caché local.
// Retorna Promise<{ source, count? }>
function initFromSheets() {
  if (typeof GS === 'undefined' || !GS.isConnected()) {
    return Promise.resolve({ source: 'local' });
  }

  return GS.readAll().then(function (data) {
    var rows = (data.values || []).slice(1); // omitir fila de cabecera
    _rowMap = {};   // se reconstruye desde el sheet
    var sheetJobs = [];

    rows.forEach(function (row, i) {
      // Nuevo formato: ID en columna Y (índice 24), JSON en Z (índice 25)
      // Formato viejo: ID en columna A (índice 0), JSON en O (índice 14)
      var id = row[24] || (String(row[0] || '').startsWith('job_') ? row[0] : null);
      if (!id) return;
      _rowMap[id] = i + 2;

      var job = null;
      if (row[25]) { try { job = JSON.parse(row[25]); } catch (e) {} }
      if (!job && row[14]) { try { job = JSON.parse(row[14]); } catch (e) {} }
      if (!job) job = _rowToJob(row);
      sheetJobs.push(job);
    });

    _ensureLoaded();

    // Merge: si hay versión local más nueva que el Sheet (por actualizadoEn), usarla.
    // Esto evita que un cambio local (ej: editar camioneta) se pise al recargar la app
    // cuando el Sheet todavía no recibió la actualización (fallo de red, sync parcial).
    var localMap = {};
    (_jobs || []).forEach(function (j) { if (j.id) localMap[j.id] = j; });

    var merged = sheetJobs.map(function (sheetJob) {
      var localJob = localMap[sheetJob.id];
      if (localJob && (localJob.actualizadoEn || 0) > (sheetJob.actualizadoEn || 0)) {
        return localJob; // versión local más nueva → la preservamos
      }
      return sheetJob;
    });

    // Trabajos que solo existen en local (todavía no sincronizados al Sheet)
    var sheetIds = {};
    sheetJobs.forEach(function (j) { sheetIds[j.id] = true; });
    var localOnly = (_jobs || []).filter(function (j) { return !sheetIds[j.id]; });

    _jobs = merged.concat(localOnly);
    _saveJobsLocal();
    _saveRowMap();  // persistir el mapa para evitar duplicados en próxima sesión

    return { source: 'sheets', count: sheetJobs.length };
  }).catch(function (e) {
    console.warn('Sheet load failed, usando localStorage:', e.message);
    return { source: 'local', error: e.message };
  });
}

// Reconstruye un job desde las columnas del sheet (nuevo formato A-Z)
function _rowToJob(row) {
  var unidadId = null;
  if (typeof UNIDADES !== 'undefined') {
    for (var k = 0; k < UNIDADES.length; k++) {
      if (UNIDADES[k].nombre === row[14]) { unidadId = UNIDADES[k].id; break; } // O: Unidad
    }
  }
  // Fecha: D/M/YYYY → YYYY-MM-DD
  var fechaStr = row[0] || '';
  if (fechaStr && fechaStr.indexOf('/') >= 0) {
    var fp = fechaStr.split('/');
    if (fp.length === 3) fechaStr = fp[2] + '-' + fp[1].padStart(2,'0') + '-' + fp[0].padStart(2,'0');
  }
  // Peones: etiqueta → clave
  var pLbl = (row[13] || '').toLowerCase();
  var peones = pLbl.indexOf('escalera') >= 0 ? 'escaleras'
             : pLbl.indexOf('ascensor') >= 0 ? 'ascensor'
             : pLbl.indexOf('no') >= 0        ? 'no_se'
             : 'sin_peones';
  return {
    id:              row[24]          || generateId(),   // Y
    fecha:           fechaStr,
    hora:            row[1]           || '09:00',        // B
    estado:          row[2]           || 'nuevo',        // C
    nombre:          row[3]           || '',             // D
    telefonoRetiro:  row[4]           || '',             // E
    telefonoEntrega: row[5]           || '',             // F
    inventario:      row[6]           || '',             // G
    calleRetiro:     row[7]           || '',             // H
    pisoRetiro:      row[8]           || '',             // I
    barrioRetiro:    row[9]           || '',             // J
    calleEntrega:    row[10]          || '',             // K
    pisoEntrega:     row[11]          || '',             // L
    barrioEntrega:   row[12]          || '',             // M
    peones:          peones,                             // N
    unidad:          unidadId,                           // O
    canal:           row[15]          || 'web',          // P
    formaPago:       /transfer/i.test(row[16] || '') ? 'transferencia' : 'efectivo', // Q
    viajaEnUnidad:   /^s[ií]/i.test(row[17] || '') ? 'si' : (/movilidad/i.test(row[17] || '') ? 'movilidad' : 'no'), // R
    precioCamioneta: Number(row[18])  || 0,             // S
    adicionales:     Number(row[19])  || 0,             // T
    costoPeones:     Number(row[20])  || 0,             // U
    totalCobrado:    Number(row[21])  || 0,             // V
    gananciaNeta:    Number(row[22])  || 0,             // W
    aclaraciones:    row[23]          || '',             // X
    cobroCamioneta:  0, comprobante: 'no_aplica', creadoEn: Date.now(), actualizadoEn: Date.now(),
  };
}

// ── Google Sheets: sync de escritura ─────────────────────────────────────
// Llama fire-and-forget desde app.js (no bloquea la UI)
function syncJobToSheet(job, gastosOverride) {
  if (typeof GS === 'undefined' || !GS.isConnected()) return Promise.resolve();
  _ensureLoaded();
  var gastos = (gastosOverride !== undefined)
    ? gastosOverride
    : getGastos(job.fecha, job.unidad);

  if (_rowMap[job.id]) {
    return GS.updateJob(_rowMap[job.id], job, gastos).catch(function (e) {
      console.warn('Sheet update failed:', e.message);
    });
  }

  return GS.appendJob(job, gastos).then(function (resp) {
    if (resp && resp.updates && resp.updates.updatedRange) {
      var m = resp.updates.updatedRange.match(/(\d+)$/);
      if (m) { _rowMap[job.id] = Number(m[1]); _saveRowMap(); }
    }
  }).catch(function (e) {
    console.warn('Sheet append failed:', e.message);
  });
}

// Elimina la fila del job en el Sheet
function syncDeleteFromSheet(id) {
  if (typeof GS === 'undefined' || !GS.isConnected()) return Promise.resolve();

  var rowNum = _rowMap[id];
  delete _rowMap[id];
  _saveRowMap();

  if (rowNum) {
    return GS.deleteJob(rowNum).catch(function (e) {
      console.warn('Sheet delete failed:', e.message);
    });
  }

  // Si no está en el mapa local, buscar en el Sheet
  return GS.findRowByJobId(id).then(function (found) {
    if (found) return GS.deleteJob(found);
  }).catch(function (e) {
    console.warn('Sheet delete failed:', e.message);
  });
}
