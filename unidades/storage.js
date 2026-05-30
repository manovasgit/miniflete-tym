// storage.js — caché en memoria + localStorage (backup offline) + Google Sheets (nube)

const JOBS_KEY   = 'mtym_jobs_v3';
const GASTOS_KEY = 'mtym_gastos_v3';

var _jobs   = null;  // array en memoria, null = todavía no cargado
var _gastos = null;
var _rowMap = {};    // { jobId: rowNumber (1-based) } para updates/deletes en Sheet

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
    _rowMap = {};
    var sheetJobs = [];

    rows.forEach(function (row, i) {
      var id = row[0];
      if (!id) return;
      _rowMap[id] = i + 2; // 1-based + 1 por cabecera

      // Columna O (índice 14): JSON completo del job
      var job = null;
      if (row[14]) {
        try { job = JSON.parse(row[14]); } catch (e) {}
      }
      if (!job) job = _rowToJob(row);
      sheetJobs.push(job);
    });

    _ensureLoaded();

    // Conservar trabajos locales que todavía no llegaron al Sheet
    var sheetIds = {};
    sheetJobs.forEach(function (j) { sheetIds[j.id] = true; });
    var localOnly = (_jobs || []).filter(function (j) { return !sheetIds[j.id]; });

    _jobs = sheetJobs.concat(localOnly);
    _saveJobsLocal();

    return { source: 'sheets', count: sheetJobs.length };
  }).catch(function (e) {
    console.warn('Sheet load failed, usando localStorage:', e.message);
    return { source: 'local', error: e.message };
  });
}

// Reconstruye un job desde columnas A-N (fallback si no hay columna O)
function _rowToJob(row) {
  var unidadId = null;
  if (typeof UNIDADES !== 'undefined') {
    for (var k = 0; k < UNIDADES.length; k++) {
      if (UNIDADES[k].nombre === row[2]) { unidadId = UNIDADES[k].id; break; }
    }
  }
  return {
    id:              row[0]           || generateId(),
    fecha:           row[1]           || '',
    unidad:          unidadId,
    nombre:          row[3]           || '',
    barrioRetiro:    row[4]           || '',
    calleRetiro:     '',
    barrioEntrega:   row[5]           || '',
    calleEntrega:    '',
    precioCamioneta: Number(row[6])   || 0,
    peones:          row[7]           || 'sin_peones',
    adicionales:     Number(row[8])   || 0,
    costoPeones:     0,
    estado:          row[10]          || 'nuevo',
    gananciaNeta:    Number(row[12])  || 0,
    actualizadoEn:   Number(row[13])  || Date.now(),
    canal: 'whatsapp', hora: '09:00', telefonoRetiro: '', telefonoEntrega: '',
    inventario: '', pisoRetiro: '', pisoEntrega: '', formaPago: 'efectivo',
    viajaEnUnidad: 'no', aclaraciones: '', comprobante: 'no_aplica',
    totalCobrado: 0, creadoEn: Date.now(),
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
      if (m) _rowMap[job.id] = Number(m[1]);
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
