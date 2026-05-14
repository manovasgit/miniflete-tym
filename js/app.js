/* ═══════════════════════════════════════════════════════════
   Miniflete TyM — Presupuestos
   app.js — lógica principal
   ═══════════════════════════════════════════════════════════ */

const App = (() => {

  /* ── STATE ──────────────────────────────────────────────── */
  const state = {
    view: 'form',       // form | result | history | settings
    form: {},
    result: null,       // { breakdown, total, totalFinal, message, adjustedManually }
    installPrompt: null
  };

  /* ── HELPERS ────────────────────────────────────────────── */
  function uuid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toast(msg, dur = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), dur);
  }

  function blankForm() {
    return {
      serviceType: '', zona: '', distanciaKm: '', ciudadProvincial: '',
      descripcionCarga: '',
      horasEstimadas: '', cantidadPeones: '0',
      volumen: 'estandar',
      accesoOrigen: 'pb', pisoOrigen: '1', tipoEscaleraOrigen: 'completa', bultosEscaleraOrigen: '',
      accesoDestino: 'pb', pisoDestino: '1', tipoEscaleraDestino: 'completa', bultosEscaleraDestino: '',
      incluyePeajes: false, montoPeajes: '',
      fechaTentativa: '', formaPago: 'efectivo', aclaraciones: ''
    };
  }

  /* ── NAVIGATION ─────────────────────────────────────────── */
  function navigate(view) {
    state.view = view;
    window.scrollTo(0, 0);
    render();
  }

  function render() {
    const main = document.getElementById('main-content');
    const title = document.getElementById('page-title');

    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
      el.classList.toggle('active', el.dataset.view === state.view);
    });

    switch (state.view) {
      case 'form':
        title.textContent = 'Nuevo presupuesto';
        main.innerHTML = renderForm();
        bindFormEvents();
        break;
      case 'result':
        title.textContent = 'Presupuesto';
        main.innerHTML = renderResult();
        bindResultEvents();
        break;
      case 'history':
        title.textContent = 'Historial';
        main.innerHTML = renderHistory();
        bindHistoryEvents();
        break;
      case 'settings':
        title.textContent = 'Configuración de tarifas';
        main.innerHTML = renderSettings();
        bindSettingsEvents();
        break;
    }
  }

  /* ══════════════════════════════════════════════════════════
     FORM
  ══════════════════════════════════════════════════════════ */
  function renderForm() {
    const d = state.form;
    return `
    <div class="form-wrap">
      <!-- Tipo de servicio -->
      <div class="field">
        <label>Tipo de servicio <span class="req">*</span></label>
        <select id="f-serviceType">
          <option value="">Seleccioná el servicio...</option>
          <option value="miniflete"${d.serviceType==='miniflete'?' selected':''}>Miniflete / Flete puntual</option>
          <option value="camion"${d.serviceType==='camion'?' selected':''}>Mudanza con camión</option>
          <option value="reparto"${d.serviceType==='reparto'?' selected':''}>Reparto de mercadería</option>
          <option value="expreso"${d.serviceType==='expreso'?' selected':''}>Traslado desde/hacia expreso</option>
        </select>
      </div>

      <!-- Zona -->
      <div class="field">
        <label>Zona <span class="req">*</span></label>
        <select id="f-zona">
          <option value="">Seleccioná la zona...</option>
          <option value="caba"${d.zona==='caba'?' selected':''}>Solo CABA</option>
          <option value="gba"${d.zona==='gba'?' selected':''}>CABA ↔ GBA (hasta ~40km)</option>
          <option value="provincia"${d.zona==='provincia'?' selected':''}>CABA ↔ Provincia (más de ~40km)</option>
        </select>
      </div>

      <!-- Provincia extra -->
      <div class="field conditional" id="field-provincia">
        <label>Ciudad de origen/destino</label>
        <input type="text" id="f-ciudadProvincial" value="${esc(d.ciudadProvincial)}" placeholder="Ej: Pilar, Mar del Plata">
        <div class="hint">Ciudad fuera del GBA</div>
      </div>
      <div class="field conditional" id="field-distancia">
        <label>Distancia estimada (km)</label>
        <input type="number" id="f-distanciaKm" value="${esc(d.distanciaKm)}" placeholder="Ej: 80" inputmode="numeric">
      </div>

      <!-- Descripción carga -->
      <div class="field">
        <label>Descripción de la carga <span class="req">*</span></label>
        <textarea id="f-descripcionCarga" placeholder="Ej: heladera, sommier matrimonial, 10 cajas...">${esc(d.descripcionCarga)}</textarea>
      </div>

      <!-- Mudanza campos adicionales -->
      <div class="conditional" id="fields-camion">
        <div class="section-divider">Mudanza con camión</div>
        <div class="field">
          <label>Horas estimadas de trabajo <span class="req">*</span></label>
          <input type="number" id="f-horasEstimadas" value="${esc(d.horasEstimadas)}" placeholder="Ej: 3" min="0.5" step="0.5" inputmode="decimal">
          <div class="hint">Solo horas cargados (carga + viaje + descarga). El viaje vacío va por cuenta de la empresa.</div>
        </div>
        <div class="field">
          <label>Cantidad de peones</label>
          <select id="f-cantidadPeones">
            <option value="0"${(d.cantidadPeones||'0')==='0'?' selected':''}>Sin peones</option>
            <option value="1"${d.cantidadPeones==='1'?' selected':''}>1 peón</option>
            <option value="2"${d.cantidadPeones==='2'?' selected':''}>2 peones</option>
            <option value="3"${d.cantidadPeones==='3'?' selected':''}>3 peones</option>
          </select>
        </div>
      </div>

      <!-- Reparto volumen -->
      <div class="conditional" id="fields-reparto">
        <div class="section-divider">Reparto</div>
        <div class="field">
          <label>Volumen</label>
          <select id="f-volumen">
            <option value="estandar"${(d.volumen||'estandar')==='estandar'?' selected':''}>Estándar</option>
            <option value="alto"${d.volumen==='alto'?' selected':''}>Alto volumen</option>
          </select>
        </div>
      </div>

      <!-- Acceso origen -->
      <div class="section-divider">Acceso en origen</div>
      <div class="field">
        <label>Acceso en origen</label>
        <select id="f-accesoOrigen">
          <option value="pb"${d.accesoOrigen==='pb'?' selected':''}>Planta baja</option>
          <option value="ascensor"${d.accesoOrigen==='ascensor'?' selected':''}>Con ascensor</option>
          <option value="escalera"${d.accesoOrigen==='escalera'?' selected':''}>Por escalera</option>
        </select>
      </div>
      <div class="conditional" id="fields-escalera-origen">
        <div class="field">
          <label>Piso en origen <span class="req">*</span></label>
          <input type="number" id="f-pisoOrigen" value="${esc(d.pisoOrigen)||'1'}" min="1" max="20" inputmode="numeric">
        </div>
        <div class="field">
          <label>Tipo de escalera en origen</label>
          <select id="f-tipoEscaleraOrigen">
            <option value="completa"${(d.tipoEscaleraOrigen||'completa')==='completa'?' selected':''}>Mudanza completa por escalera</option>
            <option value="parcial"${d.tipoEscaleraOrigen==='parcial'?' selected':''}>Parcial (algunos bultos por escalera)</option>
            <option value="sueltos"${d.tipoEscaleraOrigen==='sueltos'?' selected':''}>Solo bultos sueltos</option>
          </select>
        </div>
        <div class="conditional" id="fields-bultos-origen">
          <div class="field">
            <label>Cantidad de bultos por escalera en origen</label>
            <input type="number" id="f-bultosEscaleraOrigen" value="${esc(d.bultosEscaleraOrigen)}" min="1" inputmode="numeric" placeholder="Ej: 3">
          </div>
        </div>
      </div>

      <!-- Acceso destino -->
      <div class="section-divider">Acceso en destino</div>
      <div class="field">
        <label>Acceso en destino</label>
        <select id="f-accesoDestino">
          <option value="pb"${d.accesoDestino==='pb'?' selected':''}>Planta baja</option>
          <option value="ascensor"${d.accesoDestino==='ascensor'?' selected':''}>Con ascensor</option>
          <option value="escalera"${d.accesoDestino==='escalera'?' selected':''}>Por escalera</option>
        </select>
      </div>
      <div class="conditional" id="fields-escalera-destino">
        <div class="field">
          <label>Piso en destino <span class="req">*</span></label>
          <input type="number" id="f-pisoDestino" value="${esc(d.pisoDestino)||'1'}" min="1" max="20" inputmode="numeric">
        </div>
        <div class="field">
          <label>Tipo de escalera en destino</label>
          <select id="f-tipoEscaleraDestino">
            <option value="completa"${(d.tipoEscaleraDestino||'completa')==='completa'?' selected':''}>Mudanza completa por escalera</option>
            <option value="parcial"${d.tipoEscaleraDestino==='parcial'?' selected':''}>Parcial (algunos bultos por escalera)</option>
            <option value="sueltos"${d.tipoEscaleraDestino==='sueltos'?' selected':''}>Solo bultos sueltos</option>
          </select>
        </div>
        <div class="conditional" id="fields-bultos-destino">
          <div class="field">
            <label>Cantidad de bultos por escalera en destino</label>
            <input type="number" id="f-bultosEscaleraDestino" value="${esc(d.bultosEscaleraDestino)}" min="1" inputmode="numeric" placeholder="Ej: 3">
          </div>
        </div>
      </div>

      <!-- Peajes -->
      <div class="section-divider">Otros</div>
      <div class="field-inline">
        <input type="checkbox" id="f-incluyePeajes"${d.incluyePeajes?' checked':''}>
        <label for="f-incluyePeajes">¿Incluye peajes?</label>
      </div>
      <div class="conditional" id="field-peajes">
        <div class="field" style="margin-top:14px">
          <label>Monto de peajes</label>
          <input type="number" id="f-montoPeajes" value="${esc(d.montoPeajes)}" placeholder="Ej: 3500" inputmode="numeric">
        </div>
      </div>

      <div class="field" style="margin-top:14px">
        <label>Fecha tentativa</label>
        <input type="date" id="f-fechaTentativa" value="${esc(d.fechaTentativa)}">
      </div>

      <div class="field">
        <label>Forma de pago</label>
        <select id="f-formaPago">
          <option value="efectivo"${(d.formaPago||'efectivo')==='efectivo'?' selected':''}>Efectivo</option>
          <option value="transferencia"${d.formaPago==='transferencia'?' selected':''}>Transferencia bancaria</option>
          <option value="efectivo_transferencia"${d.formaPago==='efectivo_transferencia'?' selected':''}>Efectivo o transferencia</option>
        </select>
      </div>

      <div class="field">
        <label>Aclaraciones adicionales <span class="hint-inline">(opcional)</span></label>
        <textarea id="f-aclaraciones" placeholder="Condiciones especiales, aclaraciones...">${esc(d.aclaraciones)}</textarea>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary btn-calc" id="btn-calcular">🧮 Calcular presupuesto</button>
      </div>
    </div>`;
  }

  function collectForm() {
    const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const cb = id => { const el = document.getElementById(id); return el ? el.checked : false; };
    state.form = {
      serviceType: v('f-serviceType'),
      zona: v('f-zona'),
      distanciaKm: v('f-distanciaKm'),
      ciudadProvincial: v('f-ciudadProvincial').trim(),
      descripcionCarga: v('f-descripcionCarga').trim(),
      horasEstimadas: v('f-horasEstimadas'),
      cantidadPeones: v('f-cantidadPeones') || '0',
      volumen: v('f-volumen') || 'estandar',
      accesoOrigen: v('f-accesoOrigen') || 'pb',
      pisoOrigen: v('f-pisoOrigen') || '1',
      tipoEscaleraOrigen: v('f-tipoEscaleraOrigen') || 'completa',
      bultosEscaleraOrigen: v('f-bultosEscaleraOrigen'),
      accesoDestino: v('f-accesoDestino') || 'pb',
      pisoDestino: v('f-pisoDestino') || '1',
      tipoEscaleraDestino: v('f-tipoEscaleraDestino') || 'completa',
      bultosEscaleraDestino: v('f-bultosEscaleraDestino'),
      incluyePeajes: cb('f-incluyePeajes'),
      montoPeajes: v('f-montoPeajes'),
      fechaTentativa: v('f-fechaTentativa'),
      formaPago: v('f-formaPago') || 'efectivo',
      aclaraciones: v('f-aclaraciones').trim()
    };
  }

  function updateConditionalFields() {
    const svc = (document.getElementById('f-serviceType') || {}).value || '';
    const zona = (document.getElementById('f-zona') || {}).value || '';
    const aOrigen = (document.getElementById('f-accesoOrigen') || {}).value || '';
    const aDestino = (document.getElementById('f-accesoDestino') || {}).value || '';
    const tEscOrigen = (document.getElementById('f-tipoEscaleraOrigen') || {}).value || '';
    const tEscDestino = (document.getElementById('f-tipoEscaleraDestino') || {}).value || '';
    const peajes = (document.getElementById('f-incluyePeajes') || {}).checked;

    show('field-provincia', zona === 'provincia');
    show('field-distancia', zona === 'provincia');
    show('fields-camion', svc === 'camion');
    show('fields-reparto', svc === 'reparto');
    show('fields-escalera-origen', aOrigen === 'escalera');
    show('fields-bultos-origen', aOrigen === 'escalera' && (tEscOrigen === 'parcial' || tEscOrigen === 'sueltos'));
    show('fields-escalera-destino', aDestino === 'escalera');
    show('fields-bultos-destino', aDestino === 'escalera' && (tEscDestino === 'parcial' || tEscDestino === 'sueltos'));
    show('field-peajes', peajes);
  }

  function show(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = visible ? '' : 'none';
  }

  function bindFormEvents() {
    updateConditionalFields();

    ['f-serviceType', 'f-zona', 'f-accesoOrigen', 'f-accesoDestino',
     'f-tipoEscaleraOrigen', 'f-tipoEscaleraDestino'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', updateConditionalFields);
    });
    document.getElementById('f-incluyePeajes')?.addEventListener('change', updateConditionalFields);

    document.getElementById('btn-calcular')?.addEventListener('click', () => {
      collectForm();
      if (!validateForm()) return;
      const { breakdown, total } = Pricing.calculate(state.form);
      const message = Pricing.generateMessage(state.form, breakdown, total);
      state.result = { breakdown, total, totalFinal: total, message, adjustedManually: false };
      navigate('result');
    });
  }

  function validateForm() {
    const d = state.form;
    if (!d.serviceType) { toast('Seleccioná el tipo de servicio'); return false; }
    if (!d.zona) { toast('Seleccioná la zona'); return false; }
    if (!d.descripcionCarga) { toast('Describí la carga'); return false; }
    if (d.serviceType === 'camion' && !d.horasEstimadas) { toast('Ingresá las horas estimadas'); return false; }
    if (d.accesoOrigen === 'escalera' && !d.pisoOrigen) { toast('Ingresá el piso en origen'); return false; }
    if (d.accesoDestino === 'escalera' && !d.pisoDestino) { toast('Ingresá el piso en destino'); return false; }
    return true;
  }

  /* ══════════════════════════════════════════════════════════
     RESULT
  ══════════════════════════════════════════════════════════ */
  function renderResult() {
    const r = state.result;
    if (!r) return '<div class="view-pad"><p>Sin resultado.</p></div>';

    const svcLabels = {
      miniflete: 'Miniflete / Flete puntual',
      camion: 'Mudanza con camión',
      reparto: 'Reparto de mercadería',
      expreso: 'Traslado desde/hacia expreso'
    };
    const zonaLabel = { caba: 'Solo CABA', gba: 'CABA ↔ GBA', provincia: 'CABA ↔ Provincia' }[state.form.zona] || '-';
    const zonaFull = state.form.zona === 'provincia' && state.form.ciudadProvincial
      ? `CABA ↔ ${state.form.ciudadProvincial}` : zonaLabel;

    const accesoLabel = (acc, piso) => {
      if (acc === 'pb') return 'Planta baja';
      if (acc === 'ascensor') return 'Con ascensor';
      if (acc === 'escalera') return `Escalera – piso ${piso || 1}`;
      return '-';
    };

    const desglose = r.breakdown
      .filter(i => i && typeof i.amount === 'number' && i.amount > 0)
      .map(i => `
      <div class="breakdown-item">
        <span class="b-label">${esc(i.label)}</span>
        <span class="b-amt">${Pricing.formatMonto(i.amount)}</span>
      </div>`).join('');

    return `
    <div class="view-pad">
      <!-- Resumen -->
      <div class="card">
        <div class="section-title">Resumen del servicio</div>
        <div class="detail-row"><span class="dl">Servicio</span><span class="dv">${svcLabels[state.form.serviceType] || '-'}</span></div>
        <div class="detail-row"><span class="dl">Zona</span><span class="dv">${zonaFull}</span></div>
        <div class="detail-row"><span class="dl">Carga</span><span class="dv">${esc(state.form.descripcionCarga)}</span></div>
        <div class="detail-row"><span class="dl">Origen</span><span class="dv">${accesoLabel(state.form.accesoOrigen, state.form.pisoOrigen)}</span></div>
        <div class="detail-row"><span class="dl">Destino</span><span class="dv">${accesoLabel(state.form.accesoDestino, state.form.pisoDestino)}</span></div>
      </div>

      <!-- Desglose -->
      <div class="card">
        <div class="section-title">Desglose del precio</div>
        <div class="breakdown-list">${desglose}</div>
        <div class="breakdown-total">
          <span>TOTAL CALCULADO</span>
          <span>${Pricing.formatMonto(r.total)}</span>
        </div>
      </div>

      <!-- Total ajustable -->
      <div class="card total-card">
        <div class="total-label">Total</div>
        <div class="total-amount" id="total-display">${Pricing.formatMonto(r.totalFinal)}</div>
        ${r.adjustedManually ? '<div class="total-adjusted">*(importe ajustado)*</div>' : ''}
        <button class="btn-adjust" id="btn-adjust">✏️ Ajustar importe</button>
        <div class="adjust-row hidden" id="adjust-row">
          <input type="number" id="input-adjust" value="${r.totalFinal}" inputmode="numeric" step="500">
          <button class="btn-apply" id="btn-apply-adjust">✓ Aplicar</button>
        </div>
      </div>

      <!-- Mensaje WhatsApp -->
      <div class="card">
        <div class="section-title">Mensaje para WhatsApp</div>
        <textarea class="message-box" id="message-box" readonly>${esc(r.message)}</textarea>
        <button class="btn btn-copy" id="btn-copy">📋 Copiar mensaje</button>
      </div>

      <!-- Acciones -->
      <div class="btn-row mt-12">
        <button class="btn btn-secondary" id="btn-guardar">💾 Guardar</button>
        <button class="btn btn-secondary" id="btn-nuevo">← Nuevo</button>
      </div>
    </div>`;
  }

  function regenerateMessage() {
    const r = state.result;
    r.message = Pricing.generateMessage(state.form, r.breakdown, r.totalFinal);
    const box = document.getElementById('message-box');
    if (box) box.value = r.message;
  }

  function bindResultEvents() {
    document.getElementById('btn-adjust')?.addEventListener('click', () => {
      const row = document.getElementById('adjust-row');
      const input = document.getElementById('input-adjust');
      row?.classList.remove('hidden');
      if (input) { input.value = state.result.totalFinal; input.focus(); input.select(); }
    });

    document.getElementById('btn-apply-adjust')?.addEventListener('click', () => {
      const val = parseFloat(document.getElementById('input-adjust')?.value);
      if (!val || val <= 0) { toast('Ingresá un importe válido'); return; }
      state.result.totalFinal = val;
      state.result.adjustedManually = true;
      regenerateMessage();
      const display = document.getElementById('total-display');
      if (display) display.textContent = Pricing.formatMonto(val);
      document.getElementById('adjust-row')?.classList.add('hidden');
      // Show "ajustado" label without full re-render
      const card = document.querySelector('.total-card');
      const existing = card?.querySelector('.total-adjusted');
      if (!existing && card) {
        const div = document.createElement('div');
        div.className = 'total-adjusted';
        div.textContent = '*(importe ajustado)*';
        card.querySelector('.btn-adjust').before(div);
      }
      toast('Importe actualizado ✓');
    });

    document.getElementById('btn-copy')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-copy');
      try {
        await navigator.clipboard.writeText(state.result.message);
        btn.textContent = '✓ ¡Copiado!';
        btn.style.background = '#1da851';
        setTimeout(() => { btn.textContent = '📋 Copiar mensaje'; btn.style.background = ''; }, 2000);
      } catch {
        // Fallback
        const box = document.getElementById('message-box');
        box?.select();
        document.execCommand('copy');
        toast('Mensaje copiado ✓');
      }
    });

    document.getElementById('btn-guardar')?.addEventListener('click', () => {
      const r = state.result;
      const q = {
        id: uuid(),
        savedAt: new Date().toISOString(),
        form: { ...state.form },
        breakdown: r.breakdown.filter(i => i && typeof i.amount === 'number'),
        totalCalculado: r.total,
        totalFinal: r.totalFinal,
        adjustedManually: r.adjustedManually,
        message: r.message
      };
      Storage.saveQuote(q);
      toast('Guardado en historial ✓');
    });

    document.getElementById('btn-nuevo')?.addEventListener('click', () => {
      navigate('form');
    });
  }

  /* ══════════════════════════════════════════════════════════
     HISTORY
  ══════════════════════════════════════════════════════════ */
  function renderHistory() {
    const quotes = Storage.getQuotes();
    if (!quotes.length) return `
    <div class="view-pad">
      <div class="empty-state">
        <div class="icon">📋</div>
        <h3>Sin presupuestos guardados</h3>
        <p>Todavía no guardaste ningún presupuesto.</p>
      </div>
    </div>`;

    const svcLabels = {
      miniflete: 'Miniflete', camion: 'Mudanza', reparto: 'Reparto', expreso: 'A expreso'
    };
    const zonaLabels = { caba: 'CABA', gba: 'CABA↔GBA', provincia: 'Provincia' };

    return `<div class="view-pad">
      ${quotes.map(q => {
        const f = q.form || {};
        const desc = (f.descripcionCarga || '').slice(0, 40) + (f.descripcionCarga?.length > 40 ? '…' : '');
        const dt = new Date(q.savedAt).toLocaleString('es-AR', {
          day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        return `
        <div class="quote-item card">
          <div class="quote-header">
            <div>
              <div class="quote-svc">${svcLabels[f.serviceType] || '-'} · ${zonaLabels[f.zona] || '-'}</div>
              <div class="quote-date">${dt}</div>
            </div>
            <div class="quote-total">${Pricing.formatMonto(q.totalFinal)}</div>
          </div>
          <div class="quote-desc">${esc(desc) || '-'}</div>
          <div class="quote-actions">
            <button class="btn btn-secondary btn-sm" data-action="ver-mensaje" data-id="${q.id}">Ver mensaje</button>
            <button class="btn btn-danger btn-sm" data-action="eliminar" data-id="${q.id}">🗑 Eliminar</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function bindHistoryEvents() {
    document.getElementById('main-content').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.action === 'ver-mensaje') {
        const q = Storage.getQuote(id);
        if (!q) return;
        showMessageModal(q.message);
      }
      if (btn.dataset.action === 'eliminar') {
        confirmDeleteQuote(id);
      }
    });
  }

  function showMessageModal(msg) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal">
      <h2>Mensaje de WhatsApp</h2>
      <textarea class="message-box" style="margin-bottom:16px" readonly>${esc(msg)}</textarea>
      <div class="btn-row">
        <button class="btn btn-secondary" id="modal-close">Cerrar</button>
        <button class="btn btn-copy" id="modal-copy">📋 Copiar</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#modal-close').onclick = () => overlay.remove();
    overlay.querySelector('#modal-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(msg);
        toast('Mensaje copiado ✓');
      } catch { document.execCommand('copy'); }
      overlay.remove();
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function confirmDeleteQuote(id) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal">
      <h2>¿Eliminar presupuesto?</h2>
      <p>Esta acción no se puede deshacer.</p>
      <div class="btn-row">
        <button class="btn btn-secondary" id="cancel-del">Cancelar</button>
        <button class="btn btn-danger" id="confirm-del">Eliminar</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cancel-del').onclick = () => overlay.remove();
    overlay.querySelector('#confirm-del').onclick = () => {
      Storage.deleteQuote(id);
      overlay.remove();
      toast('Presupuesto eliminado');
      navigate('history');
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  /* ══════════════════════════════════════════════════════════
     SETTINGS
  ══════════════════════════════════════════════════════════ */
  function renderSettings() {
    const cfg = Pricing.getConfig();
    const m = cfg.miniflete;
    const c = cfg.camion;
    const r = cfg.reparto;

    const numField = (id, val, label) => `
    <div class="field">
      <label>${label}</label>
      <input type="number" id="${id}" value="${val}" inputmode="numeric" step="500">
    </div>`;

    return `
    <div class="view-pad">
      <div class="card">
        <div class="section-title">Miniflete / Expreso</div>
        ${numField('s-base-caba', m.base_caba, 'Base – Solo CABA')}
        ${numField('s-base-gba', m.base_gba, 'Base – CABA ↔ GBA')}
        ${numField('s-base-provincia', m.base_provincia, 'Base – CABA ↔ Provincia')}
        ${numField('s-ascensor-chofer', m.ascensor_chofer, 'Ascensor (ayuda del chofer)')}
        ${numField('s-ascensor-peon', m.ascensor_peon, 'Ascensor (con peón)')}
        ${numField('s-esc-bultos', m.escalera_bultos_por_piso, 'Escalera – por bulto × piso')}
        ${numField('s-esc-p1', m.escalera_completa_piso1, 'Escalera completa – Piso 1')}
        ${numField('s-esc-p2', m.escalera_completa_piso2, 'Escalera completa – Piso 2')}
        ${numField('s-esc-p3', m.escalera_completa_piso3, 'Escalera completa – Piso 3')}
        ${numField('s-esc-p4', m.escalera_completa_piso4, 'Escalera completa – Piso 4')}
        ${numField('s-esc-p5', m.escalera_completa_piso5, 'Escalera completa – Piso 5')}
        ${numField('s-esc-extra', m.escalera_completa_incremento_extra, 'Escalera completa – incremento piso 6+')}
      </div>

      <div class="card">
        <div class="section-title">Mudanza con camión</div>
        ${numField('s-cam-h-caba', c.hora_caba, 'Tarifa hora – CABA')}
        ${numField('s-cam-h-gba', c.hora_gba, 'Tarifa hora – GBA')}
        ${numField('s-cam-h-prov', c.hora_provincia, 'Tarifa hora – Provincia')}
        <div class="field">
          <label>Mínimo horas – CABA</label>
          <input type="number" id="s-cam-min-caba" value="${c.minimo_caba_horas}" step="0.5" inputmode="decimal">
        </div>
        <div class="field">
          <label>Mínimo horas – GBA</label>
          <input type="number" id="s-cam-min-gba" value="${c.minimo_gba_horas}" step="0.5" inputmode="decimal">
        </div>
        <div class="field">
          <label>Mínimo horas – Provincia</label>
          <input type="number" id="s-cam-min-prov" value="${c.minimo_provincia_horas}" step="0.5" inputmode="decimal">
        </div>
        ${numField('s-peon-caba', c.peon_hora_caba, 'Peón/hora – CABA')}
        ${numField('s-peon-gba', c.peon_hora_gba, 'Peón/hora – GBA')}
        ${numField('s-peon-prov', c.peon_hora_provincia, 'Peón/hora – Provincia')}
      </div>

      <div class="card">
        <div class="section-title">Reparto de mercadería</div>
        ${numField('s-rep-est', r.hora_estandar, 'Tarifa hora – Estándar')}
        ${numField('s-rep-alto', r.hora_volumen_alto, 'Tarifa hora – Alto volumen')}
        <div class="field">
          <label>Mínimo de horas</label>
          <input type="number" id="s-rep-min" value="${r.minimo_horas}" step="0.5" inputmode="decimal">
        </div>
      </div>

      <button class="btn btn-primary" id="btn-save-settings">💾 Guardar cambios</button>
      <button class="btn btn-secondary mt-12" id="btn-reset-settings">↺ Restaurar valores por defecto</button>
      <div style="height:20px"></div>
    </div>`;
  }

  function bindSettingsEvents() {
    const v = id => parseFloat(document.getElementById(id)?.value) || 0;

    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      const cfg = {
        miniflete: {
          base_caba: v('s-base-caba'),
          base_gba: v('s-base-gba'),
          base_provincia: v('s-base-provincia'),
          ascensor_chofer: v('s-ascensor-chofer'),
          ascensor_peon: v('s-ascensor-peon'),
          escalera_bultos_por_piso: v('s-esc-bultos'),
          escalera_completa_piso1: v('s-esc-p1'),
          escalera_completa_piso2: v('s-esc-p2'),
          escalera_completa_piso3: v('s-esc-p3'),
          escalera_completa_piso4: v('s-esc-p4'),
          escalera_completa_piso5: v('s-esc-p5'),
          escalera_completa_incremento_extra: v('s-esc-extra')
        },
        camion: {
          hora_caba: v('s-cam-h-caba'),
          hora_gba: v('s-cam-h-gba'),
          hora_provincia: v('s-cam-h-prov'),
          minimo_caba_horas: v('s-cam-min-caba'),
          minimo_gba_horas: v('s-cam-min-gba'),
          minimo_provincia_horas: v('s-cam-min-prov'),
          peon_hora_caba: v('s-peon-caba'),
          peon_hora_gba: v('s-peon-gba'),
          peon_hora_provincia: v('s-peon-prov')
        },
        reparto: {
          hora_estandar: v('s-rep-est'),
          hora_volumen_alto: v('s-rep-alto'),
          minimo_horas: v('s-rep-min')
        }
      };
      Storage.saveTarifas(cfg);
      toast('Tarifas guardadas ✓');
    });

    document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
      Storage.clearTarifas();
      toast('Valores restaurados ✓');
      navigate('settings');
    });
  }

  /* ── PWA INSTALL BANNER ─────────────────────────────────── */
  function setupInstallBanner() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      state.installPrompt = e;
      const banner = document.getElementById('install-banner');
      if (banner) banner.classList.remove('hidden');
    });
    document.getElementById('btn-install')?.addEventListener('click', async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      const { outcome } = await state.installPrompt.userChoice;
      if (outcome === 'accepted') {
        document.getElementById('install-banner')?.classList.add('hidden');
        state.installPrompt = null;
      }
    });
    document.getElementById('btn-install-close')?.addEventListener('click', () => {
      document.getElementById('install-banner')?.classList.add('hidden');
    });
  }

  /* ── INIT ───────────────────────────────────────────────── */
  function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    state.form = blankForm();

    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => navigate(btn.dataset.view));
    });

    setupInstallBanner();
    render();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
