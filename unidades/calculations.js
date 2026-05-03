// Catálogo de unidades
const UNIDADES = [
  { id: 'fiorella',   nombre: 'Fiorella',   tipo: 'propio_pct',  pct: 66.7 },
  { id: 'scott',      nombre: 'Scott',       tipo: 'propio_fijo' },
  { id: 'rodeo',      nombre: 'Rodeo',       tipo: 'mitad' },
  { id: 'belgrano',   nombre: 'Belgrano',    tipo: 'comision',    pct: 20 },
  { id: 'manolo',     nombre: 'Manolo',      tipo: 'comision',    pct: 10 },
  { id: 'eugenio',    nombre: 'Eugenio',     tipo: 'comision',    pct: 10 },
  { id: 'juan_pablo', nombre: 'Juan Pablo',  tipo: 'comision',    pct: 10 },
  { id: 'luis',       nombre: 'Luis',        tipo: 'comision',    pct: 10 },
  { id: 'tincho',     nombre: 'Tincho',      tipo: 'comision',    pct: 10 },
  { id: 'claudio',    nombre: 'Claudio',     tipo: 'comision',    pct: 10 },
];

function getUnidad(id) {
  return UNIDADES.find(u => u.id === id) || null;
}

// 0=Dom, 1=Lun, …, 6=Sáb
function getDow(fechaStr) {
  return new Date(fechaStr + 'T12:00:00').getDay();
}

function getSueldoScott(fechaStr) {
  const dow = getDow(fechaStr);
  if (dow === 0) return null;  // domingo — no trabaja
  if (dow === 6) return 50000; // sábado
  return 80000;                // lunes a viernes
}

function isScottDomingo(fechaStr) {
  return !!(fechaStr && getDow(fechaStr) === 0);
}

// Ganancia neta de Martín para un trabajo
// gastos: solo aplica para Fiorella, Scott y Rodeo (se pasan del total diario)
function calcGanancia(unidadId, precioCamioneta, gastos, fechaStr) {
  const precio = Math.round(precioCamioneta || 0);
  const gasto  = Math.round(gastos || 0);
  const u = getUnidad(unidadId);
  if (!u) return 0;
  switch (u.tipo) {
    case 'propio_pct':  // Fiorella: Martín 66.7%
      return Math.round(precio * 0.667) - gasto;
    case 'propio_fijo': { // Scott: precio - sueldo - gastos
      const sueldo = getSueldoScott(fechaStr) || 0;
      return precio - sueldo - gasto;
    }
    case 'mitad':        // Rodeo: 50/50
      return Math.round(precio / 2) - Math.round(gasto / 2);
    case 'comision':     // Belgrano 20%, resto 10%
      return Math.round(precio * u.pct / 100);
    default: return 0;
  }
}

// ¿Esta unidad tiene gastos a cargo de Martín?
function tieneGastos(unidadId) {
  const u = getUnidad(unidadId);
  if (!u) return false;
  return ['propio_pct', 'propio_fijo', 'mitad'].includes(u.tipo);
}

// Formateadores
function formatMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Math.round(Number(n) || 0);
  const abs = Math.abs(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (num < 0 ? '-$' : '$') + abs;
}

function parseMoney(str) {
  const n = parseInt(String(str || '').replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function getTodayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(fechaStr, n) {
  const d = new Date(fechaStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const pad = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatFecha(fechaStr) {
  if (!fechaStr) return '';
  const [y, m, d] = fechaStr.split('-');
  const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  return `${dias[getDow(fechaStr)]} ${d}/${m}/${y}`;
}

function formatFechaLarga(fechaStr) {
  if (!fechaStr) return '';
  const [y, m, d] = fechaStr.split('-');
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const dias  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  return `${dias[getDow(fechaStr)]} ${parseInt(d)} de ${meses[parseInt(m) - 1]}`;
}

function getMesStr(year, month) {
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${meses[month - 1]} ${year}`;
}

function prevMes(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

function nextMes(year, month) {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

function horasOpciones() {
  const opts = [];
  for (let h = 7; h <= 21; h++) {
    opts.push(String(h).padStart(2, '0') + ':00');
    if (h < 21) opts.push(String(h).padStart(2, '0') + ':30');
  }
  return opts;
}
