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

// ── Google Sheets: exportación manual (bajo demanda, un trabajo a la vez) ──
// No hay sync automático: la app nunca sube ni trae nada del Sheet por sí sola.
// _rowMap guarda, por job id, en qué hoja (mes) y en qué fila quedó exportado,
// para que exportar el mismo día dos veces actualice en vez de duplicar.
// { [jobId]: { sheet: 'Julio 2026', row: 15 } }
function exportJobToSheet(job) {
  if (typeof GS === 'undefined' || !GS.isConnected()) {
    return Promise.reject(new Error('Conectate a Google Sheets primero'));
  }
  _ensureLoaded();
  var gastos    = getGastos(job.fecha, job.unidad);
  var sheetName = GS.monthSheetName(job.fecha);
  var entry     = _rowMap[job.id];

  if (entry && entry.sheet === sheetName) {
    return GS.updateJob(entry.row, job, gastos, sheetName);
  }

  return GS.appendJob(job, gastos, sheetName).then(function (resp) {
    if (resp && resp.updates && resp.updates.updatedRange) {
      var m = resp.updates.updatedRange.match(/(\d+)$/);
      if (m) { _rowMap[job.id] = { sheet: sheetName, row: Number(m[1]) }; _saveRowMap(); }
    }
  });
}

// Elimina la fila del job en el Sheet, si fue exportado antes (localmente o
// en otro dispositivo, en cuyo caso se busca en la hoja del mes de esa fecha).
function syncDeleteFromSheet(job) {
  if (typeof GS === 'undefined' || !GS.isConnected()) return Promise.resolve();

  var entry = _rowMap[job.id];
  delete _rowMap[job.id];
  _saveRowMap();

  var sheetName = (entry && entry.sheet) || GS.monthSheetName(job.fecha);
  var lookup = entry ? Promise.resolve(entry.row) : GS.findRowByJobId(job.id, sheetName);

  return lookup.then(function (row) {
    if (row) return GS.deleteJob(row, sheetName);
  }).catch(function (e) {
    console.warn('Sheet delete failed:', e.message);
  });
}
