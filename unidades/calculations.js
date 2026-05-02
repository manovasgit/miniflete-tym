// ── Unit catalogue ─────────────────────────────────────────────────────────
const UNITS = [
  'Fiorella', 'Scott', 'Rodeo', 'Belgrano',
  'Manolo', 'Eugenio', 'Juan Pablo', 'Luis', 'Tincho', 'Claudio',
];

const UNIT_CONFIG = {
  Fiorella:   { type: 'pct',   rate: 0.667, hasGastos: true  },
  Scott:      { type: 'fijo',              hasGastos: true  },
  Rodeo:      { type: 'mitad',             hasGastos: true  },
  Belgrano:   { type: 'pct',   rate: 0.20, hasGastos: false },
  Manolo:     { type: 'pct',   rate: 0.10, hasGastos: false },
  Eugenio:    { type: 'pct',   rate: 0.10, hasGastos: false },
  'Juan Pablo':{ type: 'pct', rate: 0.10, hasGastos: false },
  Luis:       { type: 'pct',   rate: 0.10, hasGastos: false },
  Tincho:     { type: 'pct',   rate: 0.10, hasGastos: false },
  Claudio:    { type: 'pct',   rate: 0.10, hasGastos: false },
};

function unitHasGastos(unit) {
  return UNIT_CONFIG[unit]?.hasGastos || false;
}

// ── Date helpers ───────────────────────────────────────────────────────────
function getDayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay(); // 0 Sun … 6 Sat
}

function getScottSalary(dateStr) {
  const dow = getDayOfWeek(dateStr);
  if (dow === 0) return 0;      // domingo – no trabaja
  if (dow === 6) return 50000;  // sábado
  return 80000;                 // lunes a viernes
}

// ── Core calculation ───────────────────────────────────────────────────────
// Returns ganancia neta de Martín para un día completo de una unidad.
function calcDayGanancia(unit, camionetaTotal, gastos, dateStr) {
  const cfg = UNIT_CONFIG[unit];
  if (!cfg) return 0;

  gastos        = Number(gastos)        || 0;
  camionetaTotal = Number(camionetaTotal) || 0;

  switch (cfg.type) {
    case 'pct':
      return Math.round(camionetaTotal * cfg.rate) - gastos;

    case 'fijo': {
      const salary = getScottSalary(dateStr);
      return camionetaTotal - salary - gastos;
    }

    case 'mitad':
      return Math.round(camionetaTotal / 2) - Math.round(gastos / 2);

    default:
      return 0;
  }
}

// Ganancia acumulada de un conjunto de servicios (agrupados por fecha
// para descontar los gastos correctamente por día).
function calcTotalGanancia(unit, services) {
  const byDate = {};
  services.forEach(s => {
    byDate[s.date] = (byDate[s.date] || 0) + (Number(s.camioneta) || 0);
  });

  return Object.entries(byDate).reduce((total, [date, cam]) => {
    const gastos = Storage.getGastos(date, unit);
    return total + calcDayGanancia(unit, cam, gastos, date);
  }, 0);
}

// Vista previa incremental para el formulario (sin descontar gastos,
// que son un dato del día, no del servicio).
function calcServicePreview(unit, camioneta) {
  const cfg = UNIT_CONFIG[unit];
  if (!cfg) return null;
  camioneta = Number(camioneta) || 0;

  switch (cfg.type) {
    case 'pct':
      return {
        amount: Math.round(camioneta * cfg.rate),
        label:  `${Math.round(cfg.rate * 100)}%`,
      };
    case 'mitad':
      return { amount: Math.round(camioneta / 2), label: '50%' };
    case 'fijo':
      return null; // sueldo fijo – no aplica por servicio
    default:
      return null;
  }
}

// ── Formatters ─────────────────────────────────────────────────────────────
function formatMoney(n) {
  if (n === null || n === undefined) return '—';
  const num = Math.round(Number(n) || 0);
  const abs = Math.abs(num).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (num < 0 ? '-$' : '$') + abs;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function formatDateShort(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function parseMoneyInput(val) {
  const n = parseInt(String(val || '').replace(/[^\d]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

function pad(n) { return String(n).padStart(2, '0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function firstDayOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

function currentMonthYearStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const names = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return `${names[m - 1]} ${y}`;
}
