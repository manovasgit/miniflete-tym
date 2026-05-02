const Storage = (function () {
  const SERVICES_KEY = 'utm_services_v1';
  const GASTOS_KEY   = 'utm_gastos_v1';

  function readServices() {
    try { return JSON.parse(localStorage.getItem(SERVICES_KEY)) || []; }
    catch (_) { return []; }
  }
  function writeServices(arr) {
    localStorage.setItem(SERVICES_KEY, JSON.stringify(arr));
  }
  function readGastos() {
    try { return JSON.parse(localStorage.getItem(GASTOS_KEY)) || {}; }
    catch (_) { return {}; }
  }
  function writeGastos(obj) {
    localStorage.setItem(GASTOS_KEY, JSON.stringify(obj));
  }

  return {
    getAll() {
      return readServices();
    },

    getByDate(date) {
      return readServices().filter(s => s.date === date);
    },

    getByDateUnit(date, unit) {
      return readServices().filter(s => s.date === date && s.unit === unit);
    },

    getByUnit(unit) {
      return readServices().filter(s => s.unit === unit);
    },

    getByUnitDateRange(unit, startDate, endDate) {
      return readServices().filter(s => {
        if (s.unit !== unit) return false;
        if (startDate && s.date < startDate) return false;
        if (endDate   && s.date > endDate)   return false;
        return true;
      });
    },

    getByMonth(yearMonth) {
      return readServices().filter(s => s.date.startsWith(yearMonth));
    },

    saveService(service) {
      const services = readServices();
      const idx = services.findIndex(s => s.id === service.id);
      if (idx >= 0) services[idx] = service;
      else services.push(service);
      writeServices(services);
    },

    deleteService(id) {
      writeServices(readServices().filter(s => s.id !== id));
    },

    getGastos(date, unit) {
      return Number(readGastos()[`${date}__${unit}`]) || 0;
    },

    saveGastos(date, unit, amount) {
      const all = readGastos();
      const key = `${date}__${unit}`;
      if (amount > 0) all[key] = amount;
      else delete all[key];
      writeGastos(all);
    },

    generateId() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },
  };
})();
