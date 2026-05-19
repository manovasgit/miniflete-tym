const JOBS_KEY   = 'mtym_jobs_v3';
const GASTOS_KEY = 'mtym_gastos_v3';

function _loadJobs() {
  try { return JSON.parse(localStorage.getItem(JOBS_KEY) || '[]'); }
  catch { return []; }
}
function _saveJobs(arr) { localStorage.setItem(JOBS_KEY, JSON.stringify(arr)); }

function _loadGastos() {
  try { return JSON.parse(localStorage.getItem(GASTOS_KEY) || '{}'); }
  catch { return {}; }
}
function _saveGastos(obj) { localStorage.setItem(GASTOS_KEY, JSON.stringify(obj)); }

function generateId() {
  return 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function getAll()      { return _loadJobs(); }
function getById(id)   { return _loadJobs().find(j => j.id === id) || null; }

function getByFecha(fechaStr) {
  return _loadJobs()
    .filter(j => j.fecha === fechaStr)
    .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
}

function getByMes(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return _loadJobs().filter(j => j.fecha && j.fecha.startsWith(prefix));
}

function saveJob(job) {
  const jobs = _loadJobs();
  const idx  = jobs.findIndex(j => j.id === job.id);
  job.actualizadoEn = Date.now();
  if (idx >= 0) jobs[idx] = { ...jobs[idx], ...job };
  else { job.id = job.id || generateId(); job.creadoEn = Date.now(); jobs.push(job); }
  _saveJobs(jobs);
  return job;
}

function deleteJob(id) { _saveJobs(_loadJobs().filter(j => j.id !== id)); }

// Gastos diarios por unidad (independientes de los trabajos)
function getGastos(fechaStr, unidadId) {
  return Number(_loadGastos()[`${fechaStr}__${unidadId}`]) || 0;
}

function saveGastos(fechaStr, unidadId, amount) {
  const all = _loadGastos();
  const key = `${fechaStr}__${unidadId}`;
  if (amount > 0) all[key] = amount;
  else delete all[key];
  _saveGastos(all);
}

function getAllGastos() { return _loadGastos(); }
