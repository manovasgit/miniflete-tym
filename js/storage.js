const Storage = (() => {
  const K = {
    QUOTES: 'mftym_presupuestos',
    TARIFAS: 'mftym_tarifas'
  };

  const parse = (key, def) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  };

  return {
    getQuotes() { return parse(K.QUOTES, []); },

    getQuote(id) { return this.getQuotes().find(q => q.id === id) || null; },

    saveQuote(q) {
      const list = this.getQuotes();
      const idx = list.findIndex(x => x.id === q.id);
      if (idx >= 0) list[idx] = q;
      else list.unshift(q);
      localStorage.setItem(K.QUOTES, JSON.stringify(list));
    },

    deleteQuote(id) {
      const list = this.getQuotes().filter(q => q.id !== id);
      localStorage.setItem(K.QUOTES, JSON.stringify(list));
    },

    getTarifas() { return parse(K.TARIFAS, null); },

    saveTarifas(cfg) { localStorage.setItem(K.TARIFAS, JSON.stringify(cfg)); },

    clearTarifas() { localStorage.removeItem(K.TARIFAS); }
  };
})();
