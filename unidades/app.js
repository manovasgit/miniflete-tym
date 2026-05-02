(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────
  const state = {
    tab:        'carga',
    date:       todayStr(),
    unit:       UNITS[0],
    editingId:  null,
    histUnit:   UNITS[0],
    histStart:  firstDayOfMonth(),
    histEnd:    todayStr(),
    monthYear:  currentMonthYearStr(),
  };

  // ── Bootstrap ──────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    setupNav();
    setupModal();
    registerSW();
    render();
  });

  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────
  function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.tab = btn.dataset.tab;
        document.querySelectorAll('.nav-btn').forEach(function (b) {
          b.classList.toggle('active', b.dataset.tab === state.tab);
        });
        render();
      });
    });
  }

  function render() {
    var main = document.getElementById('main');
    switch (state.tab) {
      case 'carga':     renderCarga(main);     break;
      case 'dia':       renderDia(main);       break;
      case 'historial': renderHistorial(main); break;
      case 'mensual':   renderMensual(main);   break;
    }
  }

  // ── Escape HTML ────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ══════════════════════════════════════════════════════════════════════
  // CARGA TAB
  // ══════════════════════════════════════════════════════════════════════
  function renderCarga(main) {
    var services = Storage.getByDateUnit(state.date, state.unit);
    var gastos   = Storage.getGastos(state.date, state.unit);
    var camTotal = services.reduce(function (s, r) { return s + (Number(r.camioneta) || 0); }, 0);
    var adcTotal = services.reduce(function (s, r) { return s + (Number(r.adicionales) || 0); }, 0);

    main.innerHTML =
      '<div class="controls-row">' +
        '<input type="date" id="ctrl-date" value="' + state.date + '" class="ctrl-input">' +
        '<select id="ctrl-unit" class="ctrl-input">' +
          UNITS.map(function (u) {
            return '<option value="' + esc(u) + '"' + (u === state.unit ? ' selected' : '') + '>' + esc(u) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div class="section-header">' +
        '<span>Servicios del día</span>' +
        '<button id="btn-add" class="btn-add">+ Agregar</button>' +
      '</div>' +
      '<div id="service-list">' + buildServiceList(services) + '</div>' +
      buildGastosSection(gastos) +
      buildSummarySection(state.unit, camTotal, adcTotal, gastos, state.date);

    document.getElementById('ctrl-date').addEventListener('change', function (e) {
      state.date = e.target.value;
      renderCarga(main);
    });
    document.getElementById('ctrl-unit').addEventListener('change', function (e) {
      state.unit = e.target.value;
      renderCarga(main);
    });
    document.getElementById('btn-add').addEventListener('click', function () {
      openModal(null);
    });

    document.getElementById('service-list').addEventListener('click', function (e) {
      var editBtn = e.target.closest('[data-edit]');
      var delBtn  = e.target.closest('[data-del]');
      if (editBtn) openModal(editBtn.dataset.edit);
      if (delBtn)  confirmDelete(delBtn.dataset.del);
    });

    var gastosInput = document.getElementById('inp-gastos');
    if (gastosInput) {
      gastosInput.addEventListener('blur', function (e) {
        Storage.saveGastos(state.date, state.unit, parseMoneyInput(e.target.value));
        renderCarga(main);
      });
    }
  }

  function buildServiceList(services) {
    if (!services.length) {
      return '<p class="empty-msg">Sin servicios cargados para este día.</p>';
    }
    return services.map(function (s) {
      return '<div class="service-card">' +
        '<div class="service-card-main">' +
          '<span class="service-amount">' + formatMoney(s.camioneta) + '</span>' +
          (s.adicionales ? '<span class="service-adic">+ ' + formatMoney(s.adicionales) + ' adic.</span>' : '') +
        '</div>' +
        (s.observaciones ? '<div class="service-obs">' + esc(s.observaciones) + '</div>' : '') +
        '<div class="service-actions">' +
          '<button class="btn-ghost btn-sm" data-edit="' + s.id + '">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
            ' Editar' +
          '</button>' +
          '<button class="btn-ghost btn-danger btn-sm" data-del="' + s.id + '">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>' +
            ' Eliminar' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function buildGastosSection(gastos) {
    if (!unitHasGastos(state.unit)) return '';
    return '<div class="card gastos-card">' +
      '<div class="card-label">Gastos del día</div>' +
      '<div class="field" style="margin-bottom:0">' +
        '<label for="inp-gastos">Combustible, peajes, etc.</label>' +
        '<div class="input-money">' +
          '<span class="money-prefix">$</span>' +
          '<input type="number" id="inp-gastos" inputmode="numeric" placeholder="0" min="0" value="' + (gastos || '') + '">' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function buildSummarySection(unit, camTotal, adcTotal, gastos, dateStr) {
    if (camTotal === 0) return '';
    var cfg     = UNIT_CONFIG[unit];
    var ganancia = calcDayGanancia(unit, camTotal, gastos, dateStr);
    var breakdown = '';

    if (cfg.type === 'pct') {
      var pct = Math.round(cfg.rate * 100);
      breakdown =
        '<div class="summary-row">' +
          '<span>Comisión Martín (' + pct + '%)</span>' +
          '<span>' + formatMoney(Math.round(camTotal * cfg.rate)) + '</span>' +
        '</div>';
      if (gastos > 0) {
        breakdown +=
          '<div class="summary-row text-neg">' +
            '<span>Gastos del día</span>' +
            '<span>−' + formatMoney(gastos) + '</span>' +
          '</div>';
      }
    } else if (cfg.type === 'fijo') {
      var salary  = getScottSalary(dateStr);
      var dow     = getDayOfWeek(dateStr);
      var dayName = dow === 6 ? 'sábado' : (dow === 0 ? 'domingo' : 'L-V');
      breakdown =
        '<div class="summary-row text-neg">' +
          '<span>Sueldo chofer (' + dayName + ')</span>' +
          '<span>−' + formatMoney(salary) + '</span>' +
        '</div>';
      if (gastos > 0) {
        breakdown +=
          '<div class="summary-row text-neg">' +
            '<span>Gastos del día</span>' +
            '<span>−' + formatMoney(gastos) + '</span>' +
          '</div>';
      }
    } else if (cfg.type === 'mitad') {
      breakdown =
        '<div class="summary-row">' +
          '<span>Tu 50% de camioneta</span>' +
          '<span>' + formatMoney(Math.round(camTotal / 2)) + '</span>' +
        '</div>';
      if (gastos > 0) {
        breakdown +=
          '<div class="summary-row text-neg">' +
            '<span>Tu 50% de gastos</span>' +
            '<span>−' + formatMoney(Math.round(gastos / 2)) + '</span>' +
          '</div>';
      }
    }

    if (adcTotal > 0) {
      breakdown +=
        '<div class="summary-row text-muted">' +
          '<span>Adicionales (informativo)</span>' +
          '<span>' + formatMoney(adcTotal) + '</span>' +
        '</div>';
    }

    return '<div class="card summary-card">' +
      '<div class="card-label">Resumen del día – ' + esc(unit) + '</div>' +
      '<div class="summary-row">' +
        '<span>Total camioneta</span>' +
        '<span class="bold">' + formatMoney(camTotal) + '</span>' +
      '</div>' +
      breakdown +
      '<div class="summary-divider"></div>' +
      '<div class="summary-row ganancia-row' + (ganancia < 0 ? ' neg' : '') + '">' +
        '<span>Ganancia neta Martín</span>' +
        '<span class="ganancia-amount">' + formatMoney(ganancia) + '</span>' +
      '</div>' +
    '</div>';
  }

  function confirmDelete(id) {
    if (!confirm('¿Eliminar este servicio?')) return;
    Storage.deleteService(id);
    showToast('Servicio eliminado');
    render();
  }

  // ══════════════════════════════════════════════════════════════════════
  // MODAL – Add / Edit service
  // ══════════════════════════════════════════════════════════════════════
  function setupModal() {
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', function (e) {
      if (e.target === document.getElementById('modal-overlay')) closeModal();
    });
    document.getElementById('service-form').addEventListener('submit', handleSave);
    document.getElementById('f-camioneta').addEventListener('input', updatePreview);
  }

  function openModal(editId) {
    state.editingId = editId || null;

    var isEdit = !!editId;
    document.getElementById('modal-title').textContent = isEdit ? 'Editar servicio' : 'Agregar servicio';
    document.getElementById('f-id').value          = editId || '';
    document.getElementById('f-camioneta').value   = '';
    document.getElementById('f-adicionales').value = '';
    document.getElementById('f-obs').value         = '';
    var prev = document.getElementById('f-preview');
    prev.className = 'ganancia-preview hidden';
    prev.innerHTML = '';

    if (isEdit) {
      var s = Storage.getAll().find(function (x) { return x.id === editId; });
      if (s) {
        document.getElementById('f-camioneta').value   = s.camioneta   || '';
        document.getElementById('f-adicionales').value = s.adicionales || '';
        document.getElementById('f-obs').value         = s.observaciones || '';
        updatePreview();
      }
    }

    // Scott salary hint
    var hint = document.getElementById('scott-hint');
    if (hint) {
      var cfg = UNIT_CONFIG[state.unit];
      if (cfg && cfg.type === 'fijo') {
        var salary = getScottSalary(state.date);
        var dow    = getDayOfWeek(state.date);
        var day    = dow === 6 ? 'Sábado' : (dow === 0 ? 'Domingo' : 'L-V');
        hint.innerHTML = '<span class="info-pill">💰 Sueldo Scott (' + day + '): ' + formatMoney(salary) + '</span>';
        hint.style.display = '';
      } else {
        hint.style.display = 'none';
      }
    }

    document.getElementById('modal-overlay').classList.remove('hidden');
    setTimeout(function () {
      var inp = document.getElementById('f-camioneta');
      if (inp) inp.focus();
    }, 150);
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    state.editingId = null;
  }

  function updatePreview() {
    var camioneta = parseMoneyInput(document.getElementById('f-camioneta').value);
    var prev = document.getElementById('f-preview');

    if (!camioneta) {
      prev.className = 'ganancia-preview hidden';
      return;
    }

    var result = calcServicePreview(state.unit, camioneta);
    prev.className = 'ganancia-preview';

    if (!result) {
      prev.innerHTML = '<span class="preview-label">Chofer cobra sueldo fijo — la ganancia se calcula en el resumen del día.</span>';
    } else {
      prev.innerHTML =
        '<span class="preview-label">Tu parte de este servicio:</span> ' +
        '<span class="preview-amount">' + formatMoney(result.amount) + '</span> ' +
        '<span class="preview-pct">(' + result.label + ')</span>';
    }
  }

  function handleSave(e) {
    e.preventDefault();
    var camioneta = parseMoneyInput(document.getElementById('f-camioneta').value);
    if (!camioneta) { showToast('Ingresá el precio de camioneta'); return; }

    var editId = document.getElementById('f-id').value;
    var existing = editId ? Storage.getAll().find(function (x) { return x.id === editId; }) : null;

    Storage.saveService({
      id:           editId || Storage.generateId(),
      date:         state.date,
      unit:         state.unit,
      camioneta:    camioneta,
      adicionales:  parseMoneyInput(document.getElementById('f-adicionales').value),
      observaciones: document.getElementById('f-obs').value.trim(),
      createdAt:    existing ? existing.createdAt : Date.now(),
    });

    closeModal();
    showToast(editId ? 'Servicio actualizado' : 'Servicio guardado');
    render();
  }

  // ══════════════════════════════════════════════════════════════════════
  // DÍA TAB
  // ══════════════════════════════════════════════════════════════════════
  function renderDia(main) {
    var services = Storage.getByDate(state.date);

    // Group by unit
    var byUnit = {};
    services.forEach(function (s) {
      if (!byUnit[s.unit]) byUnit[s.unit] = [];
      byUnit[s.unit].push(s);
    });

    var totalFact = 0, totalGan = 0;

    var rows = UNITS.filter(function (u) { return byUnit[u]; }).map(function (u) {
      var uSvc  = byUnit[u];
      var cam   = uSvc.reduce(function (a, r) { return a + (Number(r.camioneta) || 0); }, 0);
      var adc   = uSvc.reduce(function (a, r) { return a + (Number(r.adicionales) || 0); }, 0);
      var gasto = Storage.getGastos(state.date, u);
      var gan   = calcDayGanancia(u, cam, gasto, state.date);
      totalFact += cam + adc;
      totalGan  += gan;
      return '<tr class="' + (gan < 0 ? 'row-neg' : '') + '">' +
        '<td class="td-unit">' + esc(u) + '</td>' +
        '<td class="td-num">' + formatMoney(cam) + '</td>' +
        '<td class="td-num">' + (adc   ? formatMoney(adc)   : '—') + '</td>' +
        '<td class="td-num">' + (gasto ? formatMoney(gasto) : '—') + '</td>' +
        '<td class="td-num bold ' + (gan < 0 ? 'text-neg' : 'text-pos') + '">' + formatMoney(gan) + '</td>' +
      '</tr>';
    });

    var tableHtml = rows.length
      ? '<div class="table-wrap">' +
          '<table class="data-table">' +
            '<thead><tr><th>Unidad</th><th>Camioneta</th><th>Adic.</th><th>Gastos</th><th>Ganancia</th></tr></thead>' +
            '<tbody>' + rows.join('') + '</tbody>' +
            '<tfoot><tr>' +
              '<td class="bold">TOTAL</td>' +
              '<td class="td-num bold">' + formatMoney(totalFact) + '</td>' +
              '<td></td><td></td>' +
              '<td class="td-num bold ' + (totalGan < 0 ? 'text-neg' : 'text-pos') + '">' + formatMoney(totalGan) + '</td>' +
            '</tr></tfoot>' +
          '</table>' +
        '</div>'
      : '<p class="empty-msg">Sin servicios registrados para este día.</p>';

    main.innerHTML =
      '<div class="controls-row">' +
        '<input type="date" id="ctrl-date-dia" value="' + state.date + '" class="ctrl-input">' +
      '</div>' +
      '<div class="section-header"><span>Resumen del día</span></div>' +
      tableHtml +
      (rows.length ? '<div class="card summary-card">' +
        '<div class="summary-row ganancia-row' + (totalGan < 0 ? ' neg' : '') + '">' +
          '<span>Ganancia total Martín</span>' +
          '<span class="ganancia-amount">' + formatMoney(totalGan) + '</span>' +
        '</div>' +
      '</div>' : '');

    document.getElementById('ctrl-date-dia').addEventListener('change', function (e) {
      state.date = e.target.value;
      renderDia(main);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // HISTORIAL TAB
  // ══════════════════════════════════════════════════════════════════════
  function renderHistorial(main) {
    var services = Storage.getByUnitDateRange(state.histUnit, state.histStart, state.histEnd);
    services.sort(function (a, b) {
      return b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
    });

    var camTotal = services.reduce(function (a, r) { return a + (Number(r.camioneta) || 0); }, 0);
    var adcTotal = services.reduce(function (a, r) { return a + (Number(r.adicionales) || 0); }, 0);
    var ganTotal = calcTotalGanancia(state.histUnit, services);

    var rows = services.map(function (s) {
      return '<div class="hist-row">' +
        '<div class="hist-date">' + formatDate(s.date) + '</div>' +
        '<div class="hist-amounts">' +
          '<span class="hist-cam">' + formatMoney(s.camioneta) + '</span>' +
          (s.adicionales ? '<span class="hist-adic">+ ' + formatMoney(s.adicionales) + ' adic.</span>' : '') +
        '</div>' +
        (s.observaciones ? '<div class="hist-obs">' + esc(s.observaciones) + '</div>' : '') +
        '<div class="hist-actions">' +
          '<button class="btn-ghost btn-sm" data-hedit="' + s.id + '">Editar</button>' +
          '<button class="btn-ghost btn-danger btn-sm" data-hdel="' + s.id + '">Eliminar</button>' +
        '</div>' +
      '</div>';
    });

    var listHtml = rows.length
      ? rows.join('<hr class="row-sep">')
      : '<p class="empty-msg" style="border:none;padding:20px 0">Sin servicios en este período.</p>';

    var totalesHtml = services.length
      ? '<div class="card summary-card">' +
          '<div class="card-label">Totales del período</div>' +
          '<div class="summary-row">' +
            '<span>Total camioneta</span>' +
            '<span class="bold">' + formatMoney(camTotal) + '</span>' +
          '</div>' +
          (adcTotal ? '<div class="summary-row text-muted"><span>Adicionales (informativo)</span><span>' + formatMoney(adcTotal) + '</span></div>' : '') +
          '<div class="summary-divider"></div>' +
          '<div class="summary-row ganancia-row' + (ganTotal < 0 ? ' neg' : '') + '">' +
            '<span>Ganancia neta Martín</span>' +
            '<span class="ganancia-amount">' + formatMoney(ganTotal) + '</span>' +
          '</div>' +
        '</div>'
      : '';

    main.innerHTML =
      '<div class="controls-row">' +
        '<select id="hist-unit" class="ctrl-input">' +
          UNITS.map(function (u) {
            return '<option value="' + esc(u) + '"' + (u === state.histUnit ? ' selected' : '') + '>' + esc(u) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div class="controls-row">' +
        '<div class="ctrl-group"><label class="ctrl-label">Desde</label>' +
          '<input type="date" id="hist-start" value="' + state.histStart + '" class="ctrl-input"></div>' +
        '<div class="ctrl-group"><label class="ctrl-label">Hasta</label>' +
          '<input type="date" id="hist-end" value="' + state.histEnd + '" class="ctrl-input"></div>' +
      '</div>' +
      '<div class="section-header"><span>Historial – ' + esc(state.histUnit) + '</span></div>' +
      '<div class="hist-list-wrap" id="hist-list">' + listHtml + '</div>' +
      totalesHtml;

    document.getElementById('hist-unit').addEventListener('change', function (e) {
      state.histUnit = e.target.value; renderHistorial(main);
    });
    document.getElementById('hist-start').addEventListener('change', function (e) {
      state.histStart = e.target.value; renderHistorial(main);
    });
    document.getElementById('hist-end').addEventListener('change', function (e) {
      state.histEnd = e.target.value; renderHistorial(main);
    });

    document.getElementById('hist-list').addEventListener('click', function (e) {
      var editBtn = e.target.closest('[data-hedit]');
      var delBtn  = e.target.closest('[data-hdel]');

      if (editBtn) {
        var s = Storage.getAll().find(function (x) { return x.id === editBtn.dataset.hedit; });
        if (s) {
          state.tab  = 'carga';
          state.date = s.date;
          state.unit = s.unit;
          document.querySelectorAll('.nav-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.tab === 'carga');
          });
          render();
          setTimeout(function () { openModal(s.id); }, 60);
        }
      }

      if (delBtn) {
        if (!confirm('¿Eliminar este servicio?')) return;
        Storage.deleteService(delBtn.dataset.hdel);
        showToast('Servicio eliminado');
        renderHistorial(main);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // MENSUAL TAB
  // ══════════════════════════════════════════════════════════════════════
  function renderMensual(main) {
    var services = Storage.getByMonth(state.monthYear);

    var byUnit = {};
    services.forEach(function (s) {
      if (!byUnit[s.unit]) byUnit[s.unit] = [];
      byUnit[s.unit].push(s);
    });

    var grandFact = 0, grandGan = 0;

    var rows = UNITS.filter(function (u) { return byUnit[u]; }).map(function (u) {
      var uSvc = byUnit[u];
      var cam  = uSvc.reduce(function (a, r) { return a + (Number(r.camioneta) || 0); }, 0);
      var adc  = uSvc.reduce(function (a, r) { return a + (Number(r.adicionales) || 0); }, 0);
      var gan  = calcTotalGanancia(u, uSvc);
      grandFact += cam + adc;
      grandGan  += gan;
      return '<tr class="' + (gan < 0 ? 'row-neg' : '') + '">' +
        '<td class="td-unit">' + esc(u) + '</td>' +
        '<td class="td-num">' + formatMoney(cam) + '</td>' +
        '<td class="td-num bold ' + (gan < 0 ? 'text-neg' : 'text-pos') + '">' + formatMoney(gan) + '</td>' +
      '</tr>';
    });

    var tableHtml = rows.length
      ? '<div class="table-wrap">' +
          '<table class="data-table">' +
            '<thead><tr><th>Unidad</th><th>Facturado</th><th>Ganancia</th></tr></thead>' +
            '<tbody>' + rows.join('') + '</tbody>' +
            '<tfoot><tr>' +
              '<td class="bold">TOTAL</td>' +
              '<td class="td-num bold">' + formatMoney(grandFact) + '</td>' +
              '<td class="td-num bold ' + (grandGan < 0 ? 'text-neg' : 'text-pos') + '">' + formatMoney(grandGan) + '</td>' +
            '</tr></tfoot>' +
          '</table>' +
        '</div>'
      : '<p class="empty-msg">Sin registros en ' + monthLabel(state.monthYear) + '.</p>';

    main.innerHTML =
      '<div class="controls-row month-nav">' +
        '<button id="btn-prev" class="btn-nav">◀</button>' +
        '<span class="month-label">' + monthLabel(state.monthYear) + '</span>' +
        '<button id="btn-next" class="btn-nav">▶</button>' +
      '</div>' +
      '<div class="section-header"><span>Resumen mensual</span></div>' +
      tableHtml +
      (rows.length
        ? '<div class="card summary-card">' +
            '<div class="summary-row ganancia-row' + (grandGan < 0 ? ' neg' : '') + '">' +
              '<span>Ganancia total Martín</span>' +
              '<span class="ganancia-amount">' + formatMoney(grandGan) + '</span>' +
            '</div>' +
          '</div>'
        : '');

    document.getElementById('btn-prev').addEventListener('click', function () {
      state.monthYear = shiftMonth(state.monthYear, -1);
      renderMensual(main);
    });
    document.getElementById('btn-next').addEventListener('click', function () {
      state.monthYear = shiftMonth(state.monthYear, +1);
      renderMensual(main);
    });
  }

  function shiftMonth(ym, delta) {
    var parts = ym.split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  // ── Toast ──────────────────────────────────────────────────────────────
  var toastTimer;
  function showToast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('visible'); }, 2500);
  }

})();
