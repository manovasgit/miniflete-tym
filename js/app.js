/* ═══════════════════════════════════════════════════════════
   Miniflete TyM — Generador de Propuestas
   app.js — lógica principal
   ═══════════════════════════════════════════════════════════ */

const App = (() => {
  /* ── STATE ──────────────────────────────────────────────── */
  const state = {
    view: 'home',          // home | form | history | stats | settings | detail
    historyFilter: 'all',
    historySearch: '',
    detailId: null,
    form: null,            // current form data
    formStep: 1,
  };

  const STATUS_LIST = ['Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Sin respuesta'];
  const STATUS_MAP = {
    'Borrador':      { cls: 'borrador', label: 'Borrador' },
    'Enviada':       { cls: 'enviada',  label: 'Enviada' },
    'Aceptada':      { cls: 'aceptada', label: 'Aceptada' },
    'Rechazada':     { cls: 'rechazada',label: 'Rechazada' },
    'Sin respuesta': { cls: 'sin',      label: 'Sin resp.' }
  };

  /* ── HELPERS ────────────────────────────────────────────── */
  function uuid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function daysDiff(iso) {
    if (!iso) return 0;
    return Math.floor((Date.now() - new Date(iso)) / 86400000);
  }

  function toast(msg, dur = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), dur);
  }

  function badge(status) {
    const s = STATUS_MAP[status] || STATUS_MAP['Borrador'];
    return `<span class="badge badge-${s.cls}">${s.label}</span>`;
  }

  function blankForm() {
    return {
      id: uuid(),
      // Step 1 – Cliente
      clientName: '', clientRubro: '', clientContact: '', clientPhone: '', clientEmail: '',
      // Step 2 – Servicio
      serviceType: '', originZone: '', destZone: '', frequency: 'Puntual', inventory: '',
      // Step 3 – Precio
      vehicleType: 'utilitario', hasElevator: false, camionetaPrice: '',
      serviceMode: 'traslado', hours: 2, peones: 2,
      floorOrigin: 0, floorDest: 0, looseItems: 0,
      // Step 4 – Final
      basePrice: 0, finalPrice: 0, priceBreakdown: [],
      notes: '', status: 'Borrador',
      // Meta
      proposalNumber: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }

  /* ── NAVIGATION ─────────────────────────────────────────── */
  function navigate(view, extra = {}) {
    state.view = view;
    Object.assign(state, extra);
    render();
  }

  function render() {
    const main = document.getElementById('main-content');
    const title = document.getElementById('page-title');
    const backBtn = document.getElementById('btn-back');

    // Nav active state
    document.querySelectorAll('.nav-item[data-view]').forEach(el => {
      el.classList.toggle('active', el.dataset.view === state.view);
    });

    const showBack = ['form', 'detail'].includes(state.view);
    backBtn.classList.toggle('hidden', !showBack);

    switch (state.view) {
      case 'home':     title.textContent = 'Miniflete TyM'; main.innerHTML = renderHome(); break;
      case 'history':  title.textContent = 'Historial'; main.innerHTML = renderHistory(); break;
      case 'form':     title.textContent = state.form?.proposalNumber
                         ? `Editar ${state.form.proposalNumber}` : 'Nueva Propuesta';
                       main.innerHTML = renderForm(); break;
      case 'stats':    title.textContent = 'Estadísticas'; main.innerHTML = renderStats(); break;
      case 'settings': title.textContent = 'Configuración'; main.innerHTML = renderSettings(); break;
      case 'detail':   title.textContent = 'Propuesta'; main.innerHTML = renderDetail(); break;
    }
    bindEvents();
  }

  /* ══════════════════════════════════════════════════════════
     HOME
  ══════════════════════════════════════════════════════════ */
  function renderHome() {
    const proposals = Storage.getProposals();
    const settings = Storage.getSettings();
    const alertDays = settings.alertDays || 3;

    const total = proposals.length;
    const accepted = proposals.filter(p => p.status === 'Aceptada').length;
    const pending = proposals.filter(p => p.status === 'Enviada' || p.status === 'Sin respuesta').length;
    const rate = total > 0 ? Math.round((accepted / total) * 100) : 0;

    const alerts = proposals.filter(p =>
      (p.status === 'Enviada' || p.status === 'Sin respuesta') &&
      daysDiff(p.updatedAt) >= alertDays
    );

    const recent = proposals.slice(0, 5);

    return `
    <div class="home-view">
      <div class="hero-banner">
        <img src="icons/logo.png" alt="Miniflete TyM" style="width:120px;height:120px;object-fit:contain;border-radius:50%;margin-bottom:16px;display:block;margin-left:auto;margin-right:auto;box-shadow:0 4px 16px rgba(0,0,0,.3)">
        <h2>Generador de Propuestas</h2>
        <p>Crea propuestas profesionales en segundos</p>
        <button class="hero-btn" data-action="new-proposal">+ Nueva Propuesta</button>
      </div>

      ${alerts.length ? `
      <div class="alert-banner">
        ⚠️ <strong>${alerts.length} propuesta${alerts.length > 1 ? 's' : ''}</strong> sin respuesta hace más de ${alertDays} días:
        ${alerts.map(p => `<br>• ${p.proposalNumber} – ${p.clientName}`).join('')}
      </div>` : ''}

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-num">${total}</div>
          <div class="stat-label">Total propuestas</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:var(--success)">${accepted}</div>
          <div class="stat-label">Aceptadas</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:var(--info)">${pending}</div>
          <div class="stat-label">Pendientes</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${rate}%</div>
          <div class="stat-label">Tasa aceptación</div>
        </div>
      </div>

      ${recent.length ? `
      <div class="section-title">Propuestas recientes</div>
      ${recent.map(p => proposalItem(p)).join('')}
      ${proposals.length > 5 ? `<button class="btn btn-ghost text-center mt-8" style="width:100%" data-action="go-history">Ver todas (${proposals.length})</button>` : ''}
      ` : `
      <div class="empty-state">
        <div class="icon">📋</div>
        <h3>Sin propuestas aún</h3>
        <p>Tocá el botón rojo "+" para crear tu primera propuesta comercial</p>
      </div>
      `}
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     HISTORY
  ══════════════════════════════════════════════════════════ */
  function renderHistory() {
    const all = Storage.getProposals();
    const filters = ['all', 'Borrador', 'Enviada', 'Aceptada', 'Rechazada', 'Sin respuesta'];
    const fLabels = { all: 'Todas', Borrador: 'Borrador', Enviada: 'Enviada',
                      Aceptada: 'Aceptada', Rechazada: 'Rechazada', 'Sin respuesta': 'Sin resp.' };

    let filtered = all;
    if (state.historyFilter !== 'all') {
      filtered = filtered.filter(p => p.status === state.historyFilter);
    }
    if (state.historySearch) {
      const q = state.historySearch.toLowerCase();
      filtered = filtered.filter(p =>
        (p.clientName || '').toLowerCase().includes(q) ||
        (p.proposalNumber || '').toLowerCase().includes(q) ||
        (p.originZone || '').toLowerCase().includes(q) ||
        (p.destZone || '').toLowerCase().includes(q)
      );
    }

    return `
    <div class="search-bar">
      <input type="search" id="hist-search" placeholder="Buscar cliente, número..." value="${state.historySearch || ''}">
    </div>
    <div class="filter-bar">
      ${filters.map(f => `
        <button class="filter-chip${state.historyFilter === f ? ' active' : ''}" data-filter="${f}">${fLabels[f]} ${f === 'all' ? `(${all.length})` : `(${all.filter(p => p.status === f).length})`}</button>
      `).join('')}
    </div>
    <div class="view-pad">
      ${filtered.length ? filtered.map(p => proposalItem(p, true)).join('') : `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <h3>Sin resultados</h3>
        <p>No hay propuestas que coincidan con el filtro</p>
      </div>`}
    </div>`;
  }

  function proposalItem(p, showActions = false) {
    const s = STATUS_MAP[p.status] || STATUS_MAP['Borrador'];
    const days = daysDiff(p.updatedAt);
    const settings = Storage.getSettings();
    const isAlert = (p.status === 'Enviada' || p.status === 'Sin respuesta') && days >= (settings.alertDays || 3);
    const badgeCls = isAlert ? 'badge-alerta' : `badge-${s.cls}`;

    return `
    <div class="proposal-item" data-action="view-detail" data-id="${p.id}">
      <div>
        <div class="proposal-num">${p.proposalNumber || '---'}</div>
        <div class="text-sm text-sub mt-8">${fmtDate(p.createdAt)}</div>
      </div>
      <div class="proposal-info">
        <div class="proposal-client">${p.clientName || '(sin nombre)'}</div>
        <div class="proposal-meta">${p.serviceType || '-'} · ${p.originZone || '-'} → ${p.destZone || '-'}</div>
        <div class="mt-8"><span class="badge ${badgeCls}">${isAlert ? '⚠️ ' : ''}${s.label}</span></div>
      </div>
      <div style="text-align:right">
        <div class="proposal-price">${p.finalPrice ? Pricing.fmt(p.finalPrice) : '-'}</div>
        ${showActions ? `
        <div class="proposal-actions mt-8">
          <button class="action-btn" data-action="edit-proposal" data-id="${p.id}" title="Editar">✏️</button>
          <button class="action-btn" data-action="gen-pdf" data-id="${p.id}" title="PDF">📄</button>
          <button class="action-btn" data-action="delete-proposal" data-id="${p.id}" title="Eliminar">🗑️</button>
        </div>` : ''}
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     DETAIL VIEW
  ══════════════════════════════════════════════════════════ */
  function renderDetail() {
    const p = Storage.getProposal(state.detailId);
    if (!p) return '<div class="view-pad"><p>Propuesta no encontrada.</p></div>';

    const s = STATUS_MAP[p.status] || STATUS_MAP['Borrador'];
    const breakdown = (p.priceBreakdown || []);
    const fp = p.finalPrice || 0;
    const dp = Math.round(fp * 0.3);

    return `
    <div class="view-pad">
      <!-- Header card -->
      <div class="card" style="background:linear-gradient(135deg,var(--red-dark),var(--red));color:#fff;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:.75rem;opacity:.8">Propuesta</div>
            <div style="font-size:1.3rem;font-weight:800">${p.proposalNumber || '---'}</div>
          </div>
          <div style="text-align:right">
            <span class="badge badge-${s.cls}">${s.label}</span>
            <div style="font-size:.75rem;opacity:.8;margin-top:4px">${fmtDate(p.createdAt)}</div>
          </div>
        </div>
      </div>

      <!-- Client -->
      <div class="detail-section card">
        <h3>Cliente</h3>
        <div class="detail-row"><span class="dl">Empresa/Persona</span><span class="dv">${p.clientName||'-'}</span></div>
        <div class="detail-row"><span class="dl">Rubro</span><span class="dv">${p.clientRubro||'-'}</span></div>
        <div class="detail-row"><span class="dl">Contacto</span><span class="dv">${p.clientContact||'-'}</span></div>
        <div class="detail-row"><span class="dl">Teléfono</span><span class="dv"><a href="tel:${p.clientPhone}">${p.clientPhone||'-'}</a></span></div>
        ${p.clientEmail ? `<div class="detail-row"><span class="dl">Email</span><span class="dv"><a href="mailto:${p.clientEmail}">${p.clientEmail}</a></span></div>` : ''}
      </div>

      <!-- Service -->
      <div class="detail-section card">
        <h3>Servicio</h3>
        <div class="detail-row"><span class="dl">Tipo</span><span class="dv">${p.serviceType||'-'}</span></div>
        ${p.frequency && p.frequency !== 'Puntual' ? `<div class="detail-row"><span class="dl">Frecuencia</span><span class="dv">${p.frequency}</span></div>` : ''}
        <div class="detail-row"><span class="dl">Origen</span><span class="dv">${p.originZone||'-'}</span></div>
        <div class="detail-row"><span class="dl">Destino</span><span class="dv">${p.destZone||'-'}</span></div>
        <div class="detail-row"><span class="dl">Vehículo</span><span class="dv">${Pricing.VEHICLE_LABELS[p.vehicleType]||'-'}</span></div>
        <div class="detail-row"><span class="dl">Modalidad</span><span class="dv">${p.serviceMode === 'peones' ? 'Con peones' : 'Solo traslado'}</span></div>
        ${p.serviceMode === 'peones' ? `<div class="detail-row"><span class="dl">Peones / hs</span><span class="dv">${p.peones} peones · ${p.hours} horas</span></div>` : ''}
      </div>

      ${p.inventory ? `
      <div class="detail-section card">
        <h3>Inventario</h3>
        <div style="font-size:.88rem;white-space:pre-wrap;color:var(--text)">${p.inventory}</div>
      </div>` : ''}

      <!-- Price -->
      <div class="detail-section card">
        <h3>Precios</h3>
        <div class="breakdown-list">
          ${breakdown.map(i => `
          <div class="breakdown-item">
            <span class="b-label">${i.label}</span>
            <span class="b-amt">${Pricing.fmt(i.amount)}</span>
          </div>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1rem;color:var(--red-dark);border-top:2px solid var(--red-dark);padding-top:8px">
          <span>TOTAL</span><span>${Pricing.fmt(fp)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-top:6px">
          <span>Seña (30%)</span><span>${Pricing.fmt(dp)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-top:4px">
          <span>Saldo</span><span>${Pricing.fmt(fp - dp)}</span>
        </div>
      </div>

      ${p.notes ? `<div class="card"><div class="text-sm text-sub fw-700">Notas</div><div class="text-sm mt-8">${p.notes}</div></div>` : ''}

      <!-- Status -->
      <div class="card">
        <div class="section-title" style="margin-bottom:10px">Cambiar estado</div>
        <div class="status-chips">
          ${STATUS_LIST.map(st => {
            const sc = STATUS_MAP[st];
            return `<button class="status-chip chip-${sc.cls}${p.status === st ? ' selected' : ''}" data-action="change-status" data-id="${p.id}" data-status="${st}">${st}</button>`;
          }).join('')}
        </div>
      </div>

      <!-- Actions -->
      <div class="btn-row mt-8">
        <button class="btn btn-secondary" data-action="edit-proposal" data-id="${p.id}">✏️ Editar</button>
        <button class="btn btn-primary" data-action="gen-pdf" data-id="${p.id}">📄 PDF</button>
      </div>
      <button class="btn btn-secondary mt-8" data-action="whatsapp" data-id="${p.id}" style="width:100%;background:#25d366;color:#fff;border:none">
        📱 Compartir por WhatsApp
      </button>
      <button class="btn mt-8" style="width:100%;color:var(--danger);font-size:.85rem" data-action="delete-proposal" data-id="${p.id}">
        🗑️ Eliminar propuesta
      </button>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     FORM — multi-step
  ══════════════════════════════════════════════════════════ */
  function renderForm() {
    if (!state.form) state.form = blankForm();
    const d = state.form;
    const step = state.formStep;
    const TOTAL_STEPS = 4;

    const stepLabels = ['Cliente', 'Servicio', 'Precio', 'Resumen'];
    const indicators = Array.from({ length: TOTAL_STEPS }, (_, i) => {
      const cls = i + 1 < step ? 'done' : i + 1 === step ? 'active' : '';
      return `<div class="step ${cls}"></div>`;
    }).join('');

    let content = '';
    if (step === 1) content = renderStep1(d);
    else if (step === 2) content = renderStep2(d);
    else if (step === 3) content = renderStep3(d);
    else if (step === 4) content = renderStep4(d);

    return `
    <div class="form-wrap">
      <div class="step-indicator">
        ${indicators}
        <span class="step-label">${stepLabels[step - 1]} ${step}/${TOTAL_STEPS}</span>
      </div>
      ${content}
      <div class="btn-row mt-12">
        ${step > 1 ? `<button class="btn btn-secondary" data-action="form-prev">← Anterior</button>` : ''}
        ${step < TOTAL_STEPS
          ? `<button class="btn btn-primary" data-action="form-next">Siguiente →</button>`
          : `<button class="btn btn-primary" data-action="form-save">💾 Guardar propuesta</button>`}
      </div>
      ${step === TOTAL_STEPS ? `<button class="btn btn-success mt-8" style="width:100%" data-action="form-save-pdf">💾 Guardar y generar PDF</button>` : ''}
    </div>`;
  }

  function renderStep1(d) {
    return `
    <div class="section-divider">Datos del Cliente</div>
    <div class="field">
      <label>Empresa o Persona <span class="req">*</span></label>
      <input type="text" id="f-clientName" value="${esc(d.clientName)}" placeholder="Nombre del cliente">
    </div>
    <div class="field">
      <label>Rubro <span class="req">*</span></label>
      <select id="f-clientRubro">
        <option value="">Seleccioná un rubro...</option>
        ${Pricing.RUBROS.map(r => `<option${d.clientRubro === r ? ' selected' : ''}>${r}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Nombre del contacto</label>
      <input type="text" id="f-clientContact" value="${esc(d.clientContact)}" placeholder="Quién atiende">
    </div>
    <div class="field">
      <label>Teléfono <span class="req">*</span></label>
      <input type="tel" id="f-clientPhone" value="${esc(d.clientPhone)}" placeholder="11 xxxx-xxxx">
    </div>
    <div class="field">
      <label>Email <span class="text-sub">(opcional)</span></label>
      <input type="email" id="f-clientEmail" value="${esc(d.clientEmail)}" placeholder="correo@ejemplo.com">
    </div>`;
  }

  function renderStep2(d) {
    const freqVisible = ['Reparto', 'Logística regular'].includes(d.serviceType);
    return `
    <div class="section-divider">Datos del Servicio</div>
    <div class="field">
      <label>Tipo de servicio <span class="req">*</span></label>
      <select id="f-serviceType">
        <option value="">Seleccioná el servicio...</option>
        ${Pricing.SERVICE_TYPES.map(s => `<option${d.serviceType === s ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="field${freqVisible ? '' : ' hidden'}" id="field-freq">
      <label>Frecuencia</label>
      <select id="f-frequency">
        ${Pricing.FREQUENCIES.map(f => `<option${d.frequency === f ? ' selected' : ''}>${f}</option>`).join('')}
      </select>
    </div>
    <div class="field-row">
      <div class="field">
        <label>Zona de origen <span class="req">*</span></label>
        <input type="text" id="f-originZone" value="${esc(d.originZone)}" placeholder="Ej: Palermo">
      </div>
      <div class="field">
        <label>Zona de destino <span class="req">*</span></label>
        <input type="text" id="f-destZone" value="${esc(d.destZone)}" placeholder="Ej: Belgrano">
      </div>
    </div>
    <div class="field">
      <label>Inventario / Descripción del traslado</label>
      <textarea id="f-inventory" placeholder="Detallá qué se traslada: muebles, cajas, electrodomésticos... (protección ante discrepancias)">${esc(d.inventory)}</textarea>
      <div class="hint">Este detalle quedará en el PDF como respaldo</div>
    </div>`;
  }

  function renderStep3(d) {
    const isUtilitario = d.vehicleType === 'utilitario';
    const isCamion = d.vehicleType === 'camion';
    const isCamioneta = d.vehicleType === 'camioneta';
    const withPeones = d.serviceMode === 'peones';

    return `
    <div class="section-divider">Vehículo</div>
    <div class="field">
      <label>Tipo de vehículo <span class="req">*</span></label>
      <select id="f-vehicleType">
        <option value="utilitario"${d.vehicleType === 'utilitario' ? ' selected' : ''}>Utilitario (Fiorino/Berlingo)</option>
        <option value="camioneta"${d.vehicleType === 'camioneta' ? ' selected' : ''}>Camioneta con furgón</option>
        <option value="camion"${d.vehicleType === 'camion' ? ' selected' : ''}>Camión mudancero</option>
      </select>
    </div>

    <div class="field${isUtilitario ? '' : ' hidden'}" id="field-elevator">
      <div class="field-inline">
        <input type="checkbox" id="f-hasElevator"${d.hasElevator ? ' checked' : ''}>
        <label for="f-hasElevator">Incluye ascensor / electrodomésticos (+precio)</label>
      </div>
      <div class="hint">Sin elev.: $35.000–$40.000 · Con elev.: $45.000–$50.000</div>
    </div>

    <div class="field${isCamioneta ? '' : ' hidden'}" id="field-camioneta-price">
      <label>Precio de camioneta con furgón <span class="req">*</span></label>
      <input type="number" id="f-camionetaPrice" value="${d.camionetaPrice || ''}" placeholder="Ej: 55000" inputmode="numeric">
      <div class="hint">Ingresá el precio acordado para este servicio</div>
    </div>

    <div class="section-divider">Modalidad</div>
    <div class="field">
      <label>Modalidad de servicio</label>
      <select id="f-serviceMode">
        <option value="traslado"${d.serviceMode === 'traslado' ? ' selected' : ''}>Solo traslado (sin peones)</option>
        <option value="peones"${d.serviceMode === 'peones' ? ' selected' : ''}>Con peones</option>
      </select>
    </div>

    <div class="${(withPeones || isCamion) ? '' : 'hidden'}" id="fields-hours">
      <div class="field">
        <label>Horas estimadas <span class="req">*</span></label>
        <input type="number" id="f-hours" value="${d.hours || 2}" min="2" step="0.5" inputmode="decimal">
        <div class="hint">Mínimo 2 horas · La hora empieza al llegar</div>
      </div>
    </div>

    <div class="${withPeones ? '' : 'hidden'}" id="fields-peones">
      <div class="field">
        <label>Cantidad de peones</label>
        <input type="number" id="f-peones" value="${d.peones || 2}" min="2" inputmode="numeric">
        <div class="hint">Mínimo 2 peones · $25.000/hora por peón</div>
      </div>

      <div class="section-divider">Escalera / Piso</div>
      <div class="field-row">
        <div class="field">
          <label>Piso origen</label>
          <select id="f-floorOrigin">
            ${Pricing.FLOORS.map(f => `<option value="${f.value}"${d.floorOrigin == f.value ? ' selected' : ''}>${f.label}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Piso destino</label>
          <select id="f-floorDest">
            ${Pricing.FLOORS.map(f => `<option value="${f.value}"${d.floorDest == f.value ? ' selected' : ''}>${f.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="hint" style="margin-top:-8px;margin-bottom:10px">P1: $30k · P2: $50k · P3: $70k · P4: $80k · P5+: $80k+$20k/piso (por peón)</div>

      <div class="field">
        <label>Bultos sueltos</label>
        <input type="number" id="f-looseItems" value="${d.looseItems || 0}" min="0" inputmode="numeric">
        <div class="hint">$5.000 por piso por bulto (precio por los dos peones)</div>
      </div>
    </div>`;
  }

  function renderStep4(d) {
    const { total, breakdown } = Pricing.calculate(d);
    const finalPrice = d.finalPrice || total;
    const downPayment = Math.round(finalPrice * 0.3);

    // Save calculated values
    state.form.basePrice = total;
    state.form.priceBreakdown = breakdown;
    if (!d.finalPrice || d.finalPrice === d.basePrice) {
      state.form.finalPrice = total;
    }

    return `
    <div class="section-divider">Resumen y Precio</div>
    <div class="price-display">
      <div class="label">Precio calculado automáticamente</div>
      <div class="amount">${Pricing.fmt(total)}</div>
      <div class="senia">Seña (30%): ${Pricing.fmt(Math.round(total * 0.3))}</div>
    </div>

    ${breakdown.length ? `
    <div class="section-title">Detalle del cálculo</div>
    <div class="breakdown-list card">
      ${breakdown.map(i => `
      <div class="breakdown-item">
        <span class="b-label">${i.label}</span>
        <span class="b-amt">${Pricing.fmt(i.amount)}</span>
      </div>`).join('')}
    </div>` : ''}

    <div class="field">
      <label>Precio final ajustado</label>
      <input type="number" id="f-finalPrice" value="${finalPrice}" inputmode="numeric" step="1000">
      <div class="hint">Podés ajustar el precio calculado. Seña = 30% = <strong id="senia-display">${Pricing.fmt(downPayment)}</strong></div>
    </div>

    <div class="field">
      <label>Estado de la propuesta</label>
      <div class="status-chips" style="margin-top:4px">
        ${STATUS_LIST.map(st => {
          const sc = STATUS_MAP[st];
          return `<button type="button" class="status-chip chip-${sc.cls}${d.status === st ? ' selected' : ''}" data-action="set-status" data-status="${st}">${st}</button>`;
        }).join('')}
      </div>
    </div>

    <div class="field">
      <label>Notas adicionales</label>
      <textarea id="f-notes" placeholder="Aclaraciones, condiciones especiales...">${esc(d.notes || '')}</textarea>
    </div>

    <div class="card" style="background:#f8f8f8">
      <div class="section-title">Resumen del servicio</div>
      <div class="detail-row"><span class="dl">Cliente</span><span class="dv">${d.clientName||'-'}</span></div>
      <div class="detail-row"><span class="dl">Servicio</span><span class="dv">${d.serviceType||'-'}</span></div>
      <div class="detail-row"><span class="dl">Vehículo</span><span class="dv">${Pricing.VEHICLE_LABELS[d.vehicleType]||'-'}</span></div>
      <div class="detail-row"><span class="dl">Origen → Destino</span><span class="dv">${d.originZone||'-'} → ${d.destZone||'-'}</span></div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     STATS
  ══════════════════════════════════════════════════════════ */
  function renderStats() {
    const proposals = Storage.getProposals();
    if (!proposals.length) return `
    <div class="view-pad">
      <div class="empty-state"><div class="icon">📊</div><h3>Sin datos aún</h3><p>Creá propuestas para ver estadísticas</p></div>
    </div>`;

    const total = proposals.length;
    const accepted = proposals.filter(p => p.status === 'Aceptada');
    const rate = Math.round((accepted.length / total) * 100);

    // By service type
    const byService = {};
    proposals.forEach(p => {
      if (!p.serviceType) return;
      if (!byService[p.serviceType]) byService[p.serviceType] = { total: 0, accepted: 0, revenue: 0 };
      byService[p.serviceType].total++;
      if (p.status === 'Aceptada') { byService[p.serviceType].accepted++; byService[p.serviceType].revenue += (p.finalPrice || 0); }
    });

    // By zone (origin)
    const byZone = {};
    proposals.forEach(p => {
      const z = (p.originZone || 'Sin zona').split(' ')[0];
      byZone[z] = (byZone[z] || 0) + 1;
    });
    const topZones = Object.entries(byZone).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxZone = topZones[0]?.[1] || 1;

    // Avg accepted price
    const avgPrice = accepted.length
      ? Math.round(accepted.reduce((s, p) => s + (p.finalPrice || 0), 0) / accepted.length)
      : 0;

    // Monthly (last 6 months)
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { label: d.toLocaleDateString('es-AR', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() };
    });
    const monthlyData = months.map(m => ({
      ...m,
      count: proposals.filter(p => {
        const d = new Date(p.createdAt);
        return d.getFullYear() === m.year && d.getMonth() === m.month;
      }).length
    }));
    const maxMonth = Math.max(...monthlyData.map(m => m.count), 1);

    return `
    <div class="view-pad">
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">Total</div></div>
        <div class="stat-card"><div class="stat-num" style="color:var(--success)">${accepted.length}</div><div class="stat-label">Aceptadas</div></div>
        <div class="stat-card"><div class="stat-num">${rate}%</div><div class="stat-label">Tasa cierre</div></div>
        <div class="stat-card"><div class="stat-num" style="font-size:1.1rem">${avgPrice ? Pricing.fmt(avgPrice) : '-'}</div><div class="stat-label">Precio promedio</div></div>
      </div>

      <div class="card">
        <div class="section-title">Propuestas por mes (últimos 6)</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:80px;margin-top:10px">
          ${monthlyData.map(m => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">
            <div style="font-size:.65rem;color:var(--text-sub)">${m.count || ''}</div>
            <div style="width:100%;background:var(--red-dark);border-radius:3px 3px 0 0;height:${Math.max(4, (m.count / maxMonth) * 60)}px"></div>
            <div style="font-size:.62rem;color:var(--text-sub)">${m.label}</div>
          </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="section-title">Por tipo de servicio</div>
        ${Object.entries(byService).sort((a, b) => b[1].total - a[1].total).map(([svc, data]) => {
          const r = data.total ? Math.round((data.accepted / data.total) * 100) : 0;
          return `
          <div class="stat-bar">
            <div class="stat-bar-label">
              <span>${svc}</span>
              <span style="color:var(--text-sub)">${data.accepted}/${data.total} (${r}%)</span>
            </div>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${r}%"></div></div>
          </div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="section-title">Zonas más activas (origen)</div>
        ${topZones.map(([zone, count]) => `
        <div class="stat-bar">
          <div class="stat-bar-label"><span>${zone}</span><span>${count} propuesta${count > 1 ? 's' : ''}</span></div>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round((count / maxZone) * 100)}%"></div></div>
        </div>`).join('')}
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     SETTINGS
  ══════════════════════════════════════════════════════════ */
  function renderSettings() {
    const s = Storage.getSettings();
    const total = Storage.getProposals().length;

    return `
    <div class="view-pad">
      <div class="card">
        <div class="section-title">Miniflete TyM</div>
        <div class="detail-row"><span class="dl">Tel/WA</span><span class="dv">11 6455-4602</span></div>
        <div class="detail-row"><span class="dl">Email</span><span class="dv">minifletestym@gmail.com</span></div>
        <div class="detail-row"><span class="dl">Web</span><span class="dv">minifletetym.com.ar</span></div>
      </div>

      <div class="settings-item card">
        <div>
          <div class="title">Alerta sin respuesta</div>
          <div class="sub">Propuestas enviadas sin respuesta</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <input type="number" id="s-alertDays" value="${s.alertDays}" min="1" max="30"
            style="width:55px;text-align:center;padding:6px">
          <span style="font-size:.8rem;color:var(--text-sub)">días</span>
        </div>
      </div>
      <button class="btn btn-primary mt-8" data-action="save-settings" style="margin-bottom:14px">Guardar configuración</button>

      <div class="section-title">Datos — ${total} propuestas guardadas</div>
      <div class="btn-row">
        <button class="btn btn-secondary btn-sm" data-action="export-data">📤 Exportar</button>
        <button class="btn btn-secondary btn-sm" data-action="import-data">📥 Importar</button>
      </div>
      <input type="file" id="import-file" accept=".json" class="hidden">

      <button class="btn btn-danger mt-12" style="width:100%" data-action="clear-data">🗑️ Borrar todos los datos</button>

      <div class="card mt-12" style="text-align:center;color:var(--text-sub);font-size:.78rem">
        <div>Miniflete TyM · Generador de Propuestas</div>
        <div style="margin-top:4px">Datos guardados localmente en tu dispositivo</div>
      </div>
    </div>`;
  }

  /* ══════════════════════════════════════════════════════════
     FORM VALIDATION & COLLECT
  ══════════════════════════════════════════════════════════ */
  function collectForm() {
    const d = state.form;
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const cb = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

    if (state.formStep === 1) {
      d.clientName    = v('f-clientName').trim();
      d.clientRubro   = v('f-clientRubro');
      d.clientContact = v('f-clientContact').trim();
      d.clientPhone   = v('f-clientPhone').trim();
      d.clientEmail   = v('f-clientEmail').trim();
    } else if (state.formStep === 2) {
      d.serviceType = v('f-serviceType');
      d.frequency   = v('f-frequency') || 'Puntual';
      d.originZone  = v('f-originZone').trim();
      d.destZone    = v('f-destZone').trim();
      d.inventory   = v('f-inventory').trim();
    } else if (state.formStep === 3) {
      d.vehicleType    = v('f-vehicleType');
      d.hasElevator    = cb('f-hasElevator');
      d.camionetaPrice = v('f-camionetaPrice');
      d.serviceMode    = v('f-serviceMode');
      d.hours          = parseFloat(v('f-hours')) || 2;
      d.peones         = parseInt(v('f-peones')) || 2;
      d.floorOrigin    = parseInt(v('f-floorOrigin')) || 0;
      d.floorDest      = parseInt(v('f-floorDest')) || 0;
      d.looseItems     = parseInt(v('f-looseItems')) || 0;
    } else if (state.formStep === 4) {
      d.finalPrice = parseFloat(v('f-finalPrice')) || d.basePrice;
      d.notes      = v('f-notes').trim();
    }
  }

  function validateStep() {
    const d = state.form;
    if (state.formStep === 1) {
      if (!d.clientName) { toast('Ingresá el nombre del cliente'); return false; }
      if (!d.clientRubro) { toast('Seleccioná el rubro'); return false; }
      if (!d.clientPhone) { toast('Ingresá el teléfono'); return false; }
    } else if (state.formStep === 2) {
      if (!d.serviceType) { toast('Seleccioná el tipo de servicio'); return false; }
      if (!d.originZone) { toast('Ingresá la zona de origen'); return false; }
      if (!d.destZone) { toast('Ingresá la zona de destino'); return false; }
    } else if (state.formStep === 3) {
      if (d.vehicleType === 'camioneta' && !d.camionetaPrice) { toast('Ingresá el precio de la camioneta'); return false; }
    } else if (state.formStep === 4) {
      if (!d.finalPrice || d.finalPrice <= 0) { toast('El precio final debe ser mayor a $0'); return false; }
    }
    return true;
  }

  function saveProposal(andGenPDF = false) {
    collectForm();
    const d = state.form;

    // Assign proposal number on first save
    if (!d.proposalNumber) {
      const prefix = Pricing.VEHICLE_PREFIXES[d.vehicleType] || '1';
      d.proposalNumber = Storage.nextNumber(prefix);
    }

    // Recalculate breakdown
    const { total, breakdown } = Pricing.calculate(d);
    d.basePrice = total;
    d.priceBreakdown = breakdown;
    if (!d.finalPrice) d.finalPrice = total;

    Storage.saveProposal(d);
    toast(`Propuesta ${d.proposalNumber} guardada ✓`);

    if (andGenPDF) {
      PDFGenerator.generate(d);
    }

    navigate('detail', { detailId: d.id });
  }

  /* ══════════════════════════════════════════════════════════
     EVENT BINDING
  ══════════════════════════════════════════════════════════ */
  function bindEvents() {
    // Delegated click handler
    document.getElementById('main-content').addEventListener('click', handleClick);

    // Bottom nav
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        if (v === 'form') startNewProposal();
        else navigate(v);
      });
    });

    // Back button
    document.getElementById('btn-back').addEventListener('click', () => {
      if (state.view === 'form' && state.formStep > 1) {
        collectForm();
        state.formStep--;
        render();
      } else {
        navigate('home');
      }
    });

    // Form: live price update on step 4
    if (state.view === 'form' && state.formStep === 4) {
      const fp = document.getElementById('f-finalPrice');
      if (fp) {
        fp.addEventListener('input', () => {
          const val = parseFloat(fp.value) || 0;
          const sd = document.getElementById('senia-display');
          if (sd) sd.textContent = Pricing.fmt(Math.round(val * 0.3));
        });
      }
    }

    // Form: show/hide conditional fields on step 2 & 3
    if (state.view === 'form' && state.formStep === 2) {
      const stEl = document.getElementById('f-serviceType');
      if (stEl) stEl.addEventListener('change', () => {
        const freqField = document.getElementById('field-freq');
        if (freqField) freqField.classList.toggle('hidden',
          !['Reparto', 'Logística regular'].includes(stEl.value));
      });
    }

    if (state.view === 'form' && state.formStep === 3) {
      const vtEl = document.getElementById('f-vehicleType');
      const smEl = document.getElementById('f-serviceMode');
      const toggleStep3 = () => {
        const vt = vtEl?.value;
        const sm = smEl?.value;
        document.getElementById('field-elevator')?.classList.toggle('hidden', vt !== 'utilitario');
        document.getElementById('field-camioneta-price')?.classList.toggle('hidden', vt !== 'camioneta');
        document.getElementById('fields-hours')?.classList.toggle('hidden', sm !== 'peones' && vt !== 'camion');
        document.getElementById('fields-peones')?.classList.toggle('hidden', sm !== 'peones');
      };
      vtEl?.addEventListener('change', toggleStep3);
      smEl?.addEventListener('change', toggleStep3);
    }

    // Search
    const searchEl = document.getElementById('hist-search');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        state.historySearch = searchEl.value;
        const main = document.getElementById('main-content');
        main.innerHTML = renderHistory();
        bindEvents();
      });
    }

    // Filter chips
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.historyFilter = chip.dataset.filter;
        const main = document.getElementById('main-content');
        main.innerHTML = renderHistory();
        bindEvents();
      });
    });

    // Import file
    const importEl = document.getElementById('import-file');
    if (importEl) {
      importEl.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            Storage.importAll(ev.target.result);
            toast('Datos importados correctamente ✓');
            render();
          } catch {
            toast('Error al importar. Verificá el archivo.');
          }
        };
        reader.readAsText(file);
      });
    }
  }

  function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    switch (action) {
      case 'new-proposal': startNewProposal(); break;
      case 'go-history': navigate('history'); break;
      case 'view-detail': navigate('detail', { detailId: id }); break;
      case 'edit-proposal': editProposal(id); break;
      case 'gen-pdf': {
        const p = Storage.getProposal(id);
        if (p) PDFGenerator.generate(p);
        break;
      }
      case 'delete-proposal': confirmDelete(id); break;
      case 'change-status': {
        const p = Storage.getProposal(id);
        if (p) { p.status = btn.dataset.status; Storage.saveProposal(p); toast(`Estado: ${p.status}`); render(); }
        break;
      }
      case 'set-status': {
        state.form.status = btn.dataset.status;
        document.querySelectorAll('[data-action="set-status"]').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        break;
      }
      case 'whatsapp': {
        const p = Storage.getProposal(id);
        if (p) shareWhatsApp(p);
        break;
      }
      case 'form-next':
        collectForm();
        if (validateStep()) { state.formStep++; render(); }
        break;
      case 'form-prev':
        collectForm();
        state.formStep--;
        render();
        break;
      case 'form-save':
        collectForm();
        if (validateStep()) saveProposal(false);
        break;
      case 'form-save-pdf':
        collectForm();
        if (validateStep()) saveProposal(true);
        break;
      case 'save-settings': {
        const days = parseInt(document.getElementById('s-alertDays')?.value) || 3;
        Storage.saveSettings({ alertDays: days });
        toast('Configuración guardada ✓');
        break;
      }
      case 'export-data': {
        const data = Storage.exportAll();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        a.download = `minifleteTyM_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        break;
      }
      case 'import-data':
        document.getElementById('import-file')?.click();
        break;
      case 'clear-data':
        showClearConfirm();
        break;
    }
  }

  /* ── HELPERS ────────────────────────────────────────────── */
  function startNewProposal() {
    state.form = blankForm();
    state.formStep = 1;
    navigate('form');
  }

  function editProposal(id) {
    const p = Storage.getProposal(id);
    if (!p) return;
    state.form = { ...p };
    state.formStep = 1;
    navigate('form');
  }

  function confirmDelete(id) {
    const p = Storage.getProposal(id);
    if (!p) return;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal">
      <h2>¿Eliminar propuesta?</h2>
      <p class="text-sm text-sub" style="margin-bottom:16px">${p.proposalNumber} – ${p.clientName}</p>
      <div class="btn-row">
        <button class="btn btn-secondary" id="cancel-del">Cancelar</button>
        <button class="btn btn-danger" id="confirm-del">Eliminar</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cancel-del').onclick = () => overlay.remove();
    overlay.querySelector('#confirm-del').onclick = () => {
      Storage.deleteProposal(id);
      overlay.remove();
      toast('Propuesta eliminada');
      navigate('history');
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function showClearConfirm() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
    <div class="modal">
      <h2>⚠️ Borrar todos los datos</h2>
      <p class="text-sm text-sub" style="margin-bottom:16px">Esta acción no se puede deshacer. Se eliminarán todas las propuestas y el historial.</p>
      <div class="btn-row">
        <button class="btn btn-secondary" id="cancel-clear">Cancelar</button>
        <button class="btn btn-danger" id="confirm-clear">Sí, borrar todo</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cancel-clear').onclick = () => overlay.remove();
    overlay.querySelector('#confirm-clear').onclick = () => {
      Storage.clearAll();
      overlay.remove();
      toast('Todos los datos eliminados');
      navigate('home');
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function shareWhatsApp(p) {
    const fp = p.finalPrice || 0;
    const dp = Math.round(fp * 0.3);
    const msg = `Hola! Te comparto la propuesta *${p.proposalNumber}* de *Miniflete TyM*:

📦 *Servicio:* ${p.serviceType || '-'}
📍 *Origen:* ${p.originZone || '-'}
📍 *Destino:* ${p.destZone || '-'}
🚛 *Vehículo:* ${Pricing.VEHICLE_LABELS[p.vehicleType] || '-'}
💰 *Total:* ${Pricing.fmt(fp)}
💳 *Seña (30%):* ${Pricing.fmt(dp)}

📞 Miniflete TyM: 11 6455-4602
🌐 www.minifletetym.com.ar`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  }

  function esc(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── INIT ───────────────────────────────────────────────── */
  function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
    PDFGenerator.preload();
    render();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
