const Storage = (() => {
  const K = {
    PROPOSALS: 'mftym_proposals',
    COUNTERS: 'mftym_counters',
    SETTINGS: 'mftym_settings'
  };

  const parse = (key, def) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; }
    catch { return def; }
  };

  return {
    getProposals() { return parse(K.PROPOSALS, []); },

    getProposal(id) { return this.getProposals().find(p => p.id === id) || null; },

    saveProposal(proposal) {
      const list = this.getProposals();
      const idx = list.findIndex(p => p.id === proposal.id);
      proposal.updatedAt = new Date().toISOString();
      if (idx >= 0) list[idx] = proposal;
      else list.unshift(proposal);
      localStorage.setItem(K.PROPOSALS, JSON.stringify(list));
      return proposal;
    },

    deleteProposal(id) {
      const list = this.getProposals().filter(p => p.id !== id);
      localStorage.setItem(K.PROPOSALS, JSON.stringify(list));
    },

    getCounters() { return parse(K.COUNTERS, { '1': 0, '2': 0, '3': 0 }); },

    nextNumber(prefix) {
      const c = this.getCounters();
      c[prefix] = (c[prefix] || 0) + 1;
      localStorage.setItem(K.COUNTERS, JSON.stringify(c));
      return `${prefix}-${String(c[prefix]).padStart(4, '0')}`;
    },

    getSettings() { return parse(K.SETTINGS, { alertDays: 3 }); },

    saveSettings(s) { localStorage.setItem(K.SETTINGS, JSON.stringify(s)); },

    exportAll() {
      return JSON.stringify({
        proposals: this.getProposals(),
        counters: this.getCounters(),
        settings: this.getSettings(),
        exportedAt: new Date().toISOString()
      }, null, 2);
    },

    importAll(jsonStr) {
      const data = JSON.parse(jsonStr);
      if (data.proposals) localStorage.setItem(K.PROPOSALS, JSON.stringify(data.proposals));
      if (data.counters) localStorage.setItem(K.COUNTERS, JSON.stringify(data.counters));
      if (data.settings) localStorage.setItem(K.SETTINGS, JSON.stringify(data.settings));
    },

    clearAll() {
      [K.PROPOSALS, K.COUNTERS, K.SETTINGS].forEach(k => localStorage.removeItem(k));
    }
  };
})();
