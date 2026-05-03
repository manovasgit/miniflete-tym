// Gestión operativa Miniflete TyM — Unidades
(function () {
  'use strict';

  // ── STATE ──────────────────────────────────────────────────────────────
  const now = new Date();
  const S = {
    tab:          'agenda',
    fecha:        getTodayStr(),
    overlay:      null,       // null | 'detalle' | 'comanda' | 'edit'
    selId:        null,
    ovPage:       'view',     // 'view' | 'confirmar' | 'realizar'
    cajaYear:     now.getFullYear(),
    cajaMonth:    now.getMonth() + 1,
    resumenFecha: getTodayStr(),
  };

  const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwKX-oZ4mmX2zHyTfesMUPO_ltXht5mk6IAsDO8RXJIEd1TmYgnt6BS9NpYse0nwfGw/exec';

  function syncJob(job, gastosDelDia) {
    if (!SHEETS_URL) return;
    var payload = Object.assign({}, job);
    if (gastosDelDia !== undefined) payload.gastos = gastosDelDia;
    fetch(SHEETS_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain' },
      mode: 'no-cors'
    }).catch(function () {});
  }

  const ESTADO_LABELS = {
    nuevo:      'Nuevo',
    confirmado: 'Confirmado',
    realizado:  'Realizado',
    cancelado:  'Cancelado',
  };

  // ── INIT ───────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    registerSW();
    setupBottomNav();
    initSwipe();
    render();
  });

  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    }
  }

  // ── BOTTOM NAV ─────────────────────────────────────────────────────────
  function setupBottomNav() {
    document.getElementById('bottom-nav').addEventListener('click', function (e) {
      const btn = e.target.closest('.nav-btn');
      if (btn) navigateTo(btn.dataset.tab);
    });
  }

  function navigateTo(tab) {
    S.tab = tab;
    closeOverlay();
    document.querySelectorAll('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    render();
  }

  // ── SWIPE (agenda: cambiar día) ─────────────────────────────────────────
  var _touchX = 0, _touchY = 0;
  function initSwipe() {
    const main = document.getElementById('main');
    main.addEventListener('touchstart', function (e) {
      _touchX = e.touches[0].clientX;
      _touchY = e.touches[0].clientY;
    }, { passive: true });
    main.addEventListener('touchend', function (e) {
      if (S.tab !== 'agenda' || S.overlay) return;
      const dx = e.changedTouches[0].clientX - _touchX;
      const dy = e.changedTouches[0].clientY - _touchY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
        S.fecha = addDays(S.fecha, dx < 0 ? 1 : -1);
        render();
      }
    }, { passive: true });
  }

  // ── RENDER DISPATCH ────────────────────────────────────────────────────
  function render() {
    const main = document.getElementById('main');
    switch (S.tab) {
      case 'agenda':
        main.innerHTML = buildAgenda();
        bindAgenda(main);
        break;
      case 'nuevo':
        main.innerHTML = buildForm(null);
        bindForm(main, null);
        break;
      case 'resumen':
        main.innerHTML = buildResumen();
        bindResumen(main);
        break;
      case 'caja':
        main.innerHTML = buildCaja();
        bindCaja(main);
        break;
    }
  }

  // ── OVERLAY ────────────────────────────────────────────────────────────
  function openOverlay(type, id, page) {
    S.overlay = type;
    S.selId   = id || null;
    S.ovPage  = page || 'view';
    renderOverlay();
  }

  function renderOverlay() {
    const ov = document.getElementById('overlay');
    const oc = document.getElementById('overlay-content');
    ov.classList.remove('hidden');
    switch (S.overlay) {
      case 'detalle':
        oc.innerHTML = buildDetalle();
        bindDetalle(oc);
        break;
      case 'comanda':
        oc.innerHTML = buildComanda();
        bindComanda(oc);
        break;
      case 'edit': {
        const j = getById(S.selId);
        oc.innerHTML = buildForm(j);
        bindForm(oc, S.selId);
        break;
      }
      case 'importar':
        oc.innerHTML = buildImportar();
        bindImportar(oc);
        break;
    }
  }

  function closeOverlay() {
    S.overlay = null;
    S.selId   = null;
    S.ovPage  = 'view';
    document.getElementById('overlay').classList.add('hidden');
  }

  // ── TOAST ──────────────────────────────────────────────────────────────
  var _toastTimer;
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { t.classList.remove('visible'); }, 2600);
  }

  // ── HTML ESCAPE ────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ════════════════════════════════════════════════════════════════════════
  // AGENDA
  // ════════════════════════════════════════════════════════════════════════
  function buildAgenda() {
    const jobs    = getByFecha(S.fecha);
    const isToday = S.fecha === getTodayStr();

    const unasigned   = jobs.filter(function (j) { return !j.unidad; });
    const assigned    = jobs.filter(function (j) { return  j.unidad; });
    const unitGroups  = {};
    assigned.forEach(function (j) {
      if (!unitGroups[j.unidad]) unitGroups[j.unidad] = [];
      unitGroups[j.unidad].push(j);
    });

    var html = '<div class="date-nav">'
      + '<button class="btn-nav" id="btn-prev-dia">‹</button>'
      + '<div class="date-label">'
        + '<span class="date-label-main">' + formatFechaLarga(S.fecha) + '</span>'
        + (isToday ? '<span class="today-badge">Hoy</span>' : '')
      + '</div>'
      + '<button class="btn-nav" id="btn-next-dia">›</button>'
      + '</div>';

    if (jobs.length === 0) {
      html += '<div class="empty-state">'
        + '<div class="empty-icon">📋</div>'
        + '<p>Sin trabajos para este día</p>'
        + '<p class="empty-sub">Swipe o usá las flechas para cambiar de día</p>'
        + '</div>';
    } else {
      if (unasigned.length) {
        html += '<div class="unit-group-label">Sin asignar</div>';
        html += unasigned.map(jobCard).join('');
      }
      UNIDADES.forEach(function (u) {
        if (!unitGroups[u.id]) return;
        html += '<div class="unit-group-label">' + esc(u.nombre) + '</div>';
        html += unitGroups[u.id].map(jobCard).join('');
      });
    }

    html += '<div class="fab-wrap">'
      + '<div class="fab-menu hidden" id="fab-menu">'
        + '<button class="fab-action" id="fab-importar">📧 Importar desde email</button>'
        + '<button class="fab-action" id="fab-nuevo">✏️ Nuevo trabajo</button>'
      + '</div>'
      + '<button class="fab" id="btn-fab" title="Agregar trabajo">+</button>'
      + '</div>';
    return html;
  }

  function jobCard(j) {
    var ruta = esc(j.barrioRetiro || '?') + ' → ' + esc(j.barrioEntrega || '?');
    return '<div class="job-card ' + j.estado + '" data-jobid="' + j.id + '">'
      + '<div class="job-hora">' + esc(j.hora || '—') + '</div>'
      + '<div class="job-info">'
        + '<div class="job-nombre">' + esc(j.nombre || 'Sin nombre') + '</div>'
        + '<div class="job-ruta">' + ruta + '</div>'
      + '</div>'
      + '<span class="status-badge ' + j.estado + '">' + (ESTADO_LABELS[j.estado] || j.estado) + '</span>'
      + '</div>';
  }

  function bindAgenda(main) {
    var prev = document.getElementById('btn-prev-dia');
    var next = document.getElementById('btn-next-dia');
    var fab  = document.getElementById('btn-fab');
    if (prev) prev.addEventListener('click', function () { S.fecha = addDays(S.fecha, -1); render(); });
    if (next) next.addEventListener('click', function () { S.fecha = addDays(S.fecha,  1); render(); });

    if (fab) fab.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = document.getElementById('fab-menu');
      if (!menu) return;
      var open = !menu.classList.contains('hidden');
      menu.classList.toggle('hidden', open);
      fab.textContent = open ? '+' : '×';
    });

    var fabNuevo    = document.getElementById('fab-nuevo');
    var fabImportar = document.getElementById('fab-importar');
    if (fabNuevo)    fabNuevo.addEventListener('click',    function () { navigateTo('nuevo'); });
    if (fabImportar) fabImportar.addEventListener('click', function () { openOverlay('importar'); });

    document.addEventListener('click', function closeFab(e) {
      var wrap = document.querySelector('.fab-wrap');
      if (wrap && !wrap.contains(e.target)) {
        var menu = document.getElementById('fab-menu');
        var fab2 = document.getElementById('btn-fab');
        if (menu) menu.classList.add('hidden');
        if (fab2) fab2.textContent = '+';
        document.removeEventListener('click', closeFab);
      }
    });

    main.addEventListener('click', function (e) {
      var card = e.target.closest('.job-card');
      if (card && card.dataset.jobid) openOverlay('detalle', card.dataset.jobid);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // NUEVO / EDITAR FORM
  // ════════════════════════════════════════════════════════════════════════
  function buildForm(job) {
    var v     = job || {};
    var today = getTodayStr();
    var horas = horasOpciones();

    var horaOpts = horas.map(function (h) {
      return '<option value="' + h + '"' + ((v.hora || '09:00') === h ? ' selected' : '') + '>' + h + '</option>';
    }).join('');

    var canalVal  = v.canal          || 'whatsapp';
    var peonesVal = v.peones         || 'sin_peones';
    var pagoVal   = v.formaPago      || 'efectivo';
    var viajaVal  = v.viajaEnUnidad  || 'no';

    function seg(field, hiddenId, opts, val) {
      var btns = opts.map(function (o) {
        return '<button type="button" class="seg-btn' + (o.v === val ? ' active' : '') + '" data-val="' + o.v + '" data-field="' + field + '">' + o.l + '</button>';
      }).join('');
      return '<div class="segmented" data-field="' + field + '">' + btns + '</div>'
        + '<input type="hidden" id="' + hiddenId + '" value="' + val + '">';
    }

    return '<div class="form-wrap">'
      + '<form id="job-form" novalidate>'
      + '<input type="hidden" id="f-id" value="' + esc(v.id || '') + '">'

      // ── Origen ──
      + '<div class="form-section">'
      + '<div class="form-section-title">Origen</div>'
      + '<div class="field"><label>Canal</label>'
        + seg('canal', 'f-canal', [{ v:'whatsapp', l:'WhatsApp' }, { v:'telefono', l:'Teléfono' }, { v:'web', l:'Web' }], canalVal)
      + '</div>'
      + '<div class="field"><label>Fecha <span class="req">*</span></label>'
        + '<input type="date" id="f-fecha" value="' + esc(v.fecha || today) + '" required>'
      + '</div>'
      + '<div class="field"><label>Hora <span class="req">*</span></label>'
        + '<select id="f-hora">' + horaOpts + '</select>'
      + '</div>'
      + '</div>'

      // ── Cliente ──
      + '<div class="form-section">'
      + '<div class="form-section-title">Cliente</div>'
      + '<div class="field"><label>Nombre y apellido <span class="req">*</span></label>'
        + '<input type="text" id="f-nombre" value="' + esc(v.nombre || '') + '" placeholder="Juan García" required autocomplete="off"></div>'
      + '<div class="field"><label>Tel. retiro <span class="req">*</span></label>'
        + '<input type="tel" id="f-tel-retiro" value="' + esc(v.telefonoRetiro || '') + '" inputmode="numeric" placeholder="1122334455" required autocomplete="off"></div>'
      + '<div class="field"><label>Tel. entrega</label>'
        + '<input type="tel" id="f-tel-entrega" value="' + esc(v.telefonoEntrega || '') + '" inputmode="numeric" placeholder="1166778899" autocomplete="off"></div>'
      + '</div>'

      // ── Traslado ──
      + '<div class="form-section">'
      + '<div class="form-section-title">Traslado</div>'
      + '<div class="field"><label>Inventario <span class="req">*</span></label>'
        + '<textarea id="f-inventario" rows="3" placeholder="Qué hay que trasladar…" required>' + esc(v.inventario || '') + '</textarea></div>'
      + '<div class="field"><label>Peones</label>'
        + seg('peones', 'f-peones', [
            { v:'sin_peones', l:'Sin peones' }, { v:'ascensor', l:'Ascensor' },
            { v:'no_se', l:'No sé si entra' }, { v:'escaleras', l:'Escaleras' }
          ], peonesVal)
      + '</div>'
      + '</div>'

      // ── Retiro ──
      + '<div class="form-section">'
      + '<div class="form-section-title">Retiro</div>'
      + '<div class="field"><label>Calle y número <span class="req">*</span></label>'
        + '<input type="text" id="f-calle-retiro" value="' + esc(v.calleRetiro || '') + '" placeholder="Av. Corrientes 1234" required autocomplete="off"></div>'
      + '<div class="field"><label>Piso / Depto</label>'
        + '<input type="text" id="f-piso-retiro" value="' + esc(v.pisoRetiro || '') + '" placeholder="3° B" autocomplete="off"></div>'
      + '<div class="field"><label>Barrio / Localidad <span class="req">*</span></label>'
        + '<input type="text" id="f-barrio-retiro" value="' + esc(v.barrioRetiro || '') + '" placeholder="Palermo" required autocomplete="off"></div>'
      + '</div>'

      // ── Entrega ──
      + '<div class="form-section">'
      + '<div class="form-section-title">Entrega</div>'
      + '<div class="field"><label>Calle y número <span class="req">*</span></label>'
        + '<input type="text" id="f-calle-entrega" value="' + esc(v.calleEntrega || '') + '" placeholder="Florida 567" required autocomplete="off"></div>'
      + '<div class="field"><label>Piso / Depto</label>'
        + '<input type="text" id="f-piso-entrega" value="' + esc(v.pisoEntrega || '') + '" placeholder="PB" autocomplete="off"></div>'
      + '<div class="field"><label>Barrio / Localidad <span class="req">*</span></label>'
        + '<input type="text" id="f-barrio-entrega" value="' + esc(v.barrioEntrega || '') + '" placeholder="Microcentro" required autocomplete="off"></div>'
      + '</div>'

      // ── Condiciones ──
      + '<div class="form-section">'
      + '<div class="form-section-title">Condiciones</div>'
      + '<div class="field"><label>Forma de pago</label>'
        + seg('formaPago', 'f-pago', [{ v:'efectivo', l:'Efectivo' }, { v:'transferencia', l:'Transferencia' }], pagoVal)
      + '</div>'
      + '<div class="field"><label>Viaja en unidad</label>'
        + seg('viajaEnUnidad', 'f-viaja', [{ v:'si', l:'Sí' }, { v:'no', l:'No' }, { v:'movilidad', l:'Movilidad propia' }], viajaVal)
      + '</div>'
      + '</div>'

      // ── Notas ──
      + '<div class="form-section">'
      + '<div class="form-section-title">Notas</div>'
      + '<div class="field"><label>Aclaraciones</label>'
        + '<textarea id="f-aclaraciones" rows="2" placeholder="Opcional…">' + esc(v.aclaraciones || '') + '</textarea></div>'
      + '</div>'

      + '<div class="form-submit">'
        + '<button type="submit" class="btn-primary">' + (job ? 'Guardar cambios' : 'Guardar trabajo') + '</button>'
      + '</div>'
      + '</form></div>';
  }

  function bindForm(container, editId) {
    // Segmented controls
    container.querySelectorAll('.segmented').forEach(function (seg) {
      seg.addEventListener('click', function (e) {
        var btn = e.target.closest('.seg-btn');
        if (!btn) return;
        var field = seg.dataset.field;
        seg.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var map = { canal:'f-canal', peones:'f-peones', formaPago:'f-pago', viajaEnUnidad:'f-viaja' };
        var inp = container.querySelector('#' + map[field]) || document.getElementById(map[field]);
        if (inp) inp.value = btn.dataset.val;
      });
    });

    var form = container.querySelector('#job-form');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      handleFormSubmit(editId);
    });
  }

  function g(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function handleFormSubmit(editId) {
    if (!g('f-nombre'))        { showToast('Ingresá el nombre del cliente'); return; }
    if (!g('f-tel-retiro'))    { showToast('Ingresá el teléfono de retiro'); return; }
    if (!g('f-inventario'))    { showToast('Ingresá el inventario'); return; }
    if (!g('f-calle-retiro'))  { showToast('Ingresá la dirección de retiro'); return; }
    if (!g('f-barrio-retiro')) { showToast('Ingresá el barrio de retiro'); return; }
    if (!g('f-calle-entrega')) { showToast('Ingresá la dirección de entrega'); return; }
    if (!g('f-barrio-entrega')){ showToast('Ingresá el barrio de entrega'); return; }

    var existing = editId ? getById(editId) : null;
    var id       = existing ? existing.id : generateId();

    var job = {
      id:             id,
      canal:          g('f-canal')        || 'whatsapp',
      fecha:          g('f-fecha')        || getTodayStr(),
      hora:           g('f-hora')         || '09:00',
      nombre:         g('f-nombre'),
      telefonoRetiro: g('f-tel-retiro'),
      telefonoEntrega:g('f-tel-entrega'),
      inventario:     g('f-inventario'),
      peones:         g('f-peones')       || 'sin_peones',
      calleRetiro:    g('f-calle-retiro'),
      pisoRetiro:     g('f-piso-retiro'),
      barrioRetiro:   g('f-barrio-retiro'),
      calleEntrega:   g('f-calle-entrega'),
      pisoEntrega:    g('f-piso-entrega'),
      barrioEntrega:  g('f-barrio-entrega'),
      formaPago:      g('f-pago')         || 'efectivo',
      viajaEnUnidad:  g('f-viaja')        || 'no',
      aclaraciones:   g('f-aclaraciones'),
      // Conservar datos operativos si es edición
      unidad:         existing ? existing.unidad          : null,
      precioCamioneta:existing ? existing.precioCamioneta : 0,
      adicionales:    existing ? existing.adicionales     : 0,
      estado:         existing ? existing.estado          : 'nuevo',
      totalCobrado:   existing ? existing.totalCobrado    : 0,
      gananciaNeta:   existing ? existing.gananciaNeta    : 0,
      comprobante:    existing ? existing.comprobante     : 'no_aplica',
    };

    saveJob(job);
    showToast(editId ? 'Trabajo actualizado ✓' : 'Trabajo guardado ✓');

    if (editId) {
      // Estaba editando desde overlay → volver a detalle
      openOverlay('detalle', id, 'view');
    } else {
      // Nuevo trabajo → ir a la agenda en esa fecha
      S.fecha = job.fecha;
      navigateTo('agenda');
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // DETALLE OVERLAY
  // ════════════════════════════════════════════════════════════════════════
  function buildDetalle() {
    var j = getById(S.selId);
    if (!j) return '<div class="ov-header"><button class="ov-back" id="btn-ov-close">‹</button><h2>No encontrado</h2></div>';

    if (S.ovPage === 'confirmar') return buildConfirmar(j);
    if (S.ovPage === 'realizar')  return buildRealizar(j);

    var u = j.unidad ? getUnidad(j.unidad) : null;

    var canalLbl  = { whatsapp:'WhatsApp', telefono:'Teléfono', web:'Web' };
    var peonesLbl = { sin_peones:'Sin peones', ascensor:'Ascensor', no_se:'No sé si entra', escaleras:'Escaleras' };
    var pagoLbl   = { efectivo:'Efectivo', transferencia:'Transferencia' };
    var viajaLbl  = { si:'Sí', no:'No', movilidad:'Tiene movilidad propia' };
    var compLbl   = { enviado:'Enviado', pendiente:'Pendiente', no_aplica:'No aplica' };

    function detRow(label, value) {
      if (!value && value !== 0) return '';
      return '<div class="det-row"><span class="det-label">' + label + '</span><span class="det-value">' + esc(value) + '</span></div>';
    }

    var html = '<div class="ov-header">'
      + '<button class="ov-back" id="btn-ov-close">‹</button>'
      + '<h2>' + esc(j.nombre || 'Trabajo') + '</h2>'
      + '</div>'
      + '<div class="ov-body">'
      + '<div class="estado-row">'
        + '<span class="status-badge lg ' + j.estado + '">' + (ESTADO_LABELS[j.estado] || j.estado) + '</span>'
        + '<span class="det-nombre">' + esc(formatFecha(j.fecha)) + ' · ' + esc(j.hora || '') + '</span>'
      + '</div>'

      // Cliente
      + '<div class="det-section">'
      + '<div class="det-section-title">Cliente</div>'
      + detRow('Canal', canalLbl[j.canal] || j.canal)
      + detRow('Nombre', j.nombre)
      + '</div>'

      // Traslado
      + '<div class="det-section">'
      + '<div class="det-section-title">Traslado</div>'
      + detRow('Inventario', j.inventario)
      + detRow('Peones', peonesLbl[j.peones] || j.peones)
      + '</div>'

      // Retiro
      + '<div class="det-section">'
      + '<div class="det-section-title">Retiro</div>'
      + detRow('Dirección', j.calleRetiro + (j.pisoRetiro ? ' ' + j.pisoRetiro : '') + ', ' + j.barrioRetiro)
      + detRow('Teléfono', j.telefonoRetiro)
      + '</div>'

      // Entrega
      + '<div class="det-section">'
      + '<div class="det-section-title">Entrega</div>'
      + detRow('Dirección', j.calleEntrega + (j.pisoEntrega ? ' ' + j.pisoEntrega : '') + ', ' + j.barrioEntrega)
      + (j.telefonoEntrega ? detRow('Teléfono', j.telefonoEntrega) : '')
      + '</div>'

      // Condiciones
      + '<div class="det-section">'
      + '<div class="det-section-title">Condiciones</div>'
      + detRow('Pago', pagoLbl[j.formaPago] || j.formaPago)
      + detRow('Viaja', viajaLbl[j.viajaEnUnidad] || j.viajaEnUnidad)
      + (j.aclaraciones ? detRow('Aclaraciones', j.aclaraciones) : '')
      + '</div>';

    // Operativo
    if (j.estado === 'confirmado' || j.estado === 'realizado') {
      html += '<div class="det-section">'
        + '<div class="det-section-title">Operativo</div>'
        + detRow('Unidad', u ? u.nombre : '—')
        + detRow('Precio camioneta', formatMoney(j.precioCamioneta))
        + (j.adicionales ? detRow('Adicionales', formatMoney(j.adicionales)) : '')
        + '</div>';
    }

    // Cierre
    if (j.estado === 'realizado') {
      var gastos = getGastos(j.fecha, j.unidad) || 0;
      html += '<div class="det-section">'
        + '<div class="det-section-title">Cierre</div>'
        + detRow('Total cobrado', formatMoney(j.totalCobrado))
        + (gastos ? detRow('Gastos del día', formatMoney(gastos)) : '')
        + detRow('Comprobante', compLbl[j.comprobante] || '—')
        + '<div class="det-row ganancia-row"><span class="det-label">Ganancia Martín</span>'
          + '<span class="det-value ' + (j.gananciaNeta < 0 ? 'text-neg' : 'text-pos') + '">' + formatMoney(j.gananciaNeta) + '</span></div>'
        + '<div class="ganancia-edit-row">'
          + '<div class="money-wrap"><span class="money-prefix">$</span>'
          + '<input type="number" id="edit-ganancia" inputmode="numeric" value="' + (j.gananciaNeta || 0) + '" autocomplete="off">'
          + '</div>'
          + '<button class="btn-ghost btn-sm" id="btn-guardar-ganancia">Guardar</button>'
        + '</div>'
        + '</div>';
    }

    // Acciones
    html += '<div class="det-actions">';
    if (j.estado === 'nuevo') {
      html += '<button class="btn-primary" id="btn-ir-confirmar">Confirmar trabajo</button>';
    }
    if (j.estado === 'confirmado') {
      html += '<button class="btn-primary btn-green" id="btn-ir-realizar">Marcar como realizado</button>';
      html += '<button class="btn-outline" id="btn-ver-comanda">Ver comanda</button>';
    }
    if (j.estado === 'realizado') {
      html += '<button class="btn-outline" id="btn-ver-comanda">Ver comanda</button>';
    }
    html += '<div class="det-actions-row">';
    html += '<button class="btn-ghost btn-sm" id="btn-editar-job">✏️ Editar datos</button>';
    if (j.estado !== 'realizado' && j.estado !== 'cancelado') {
      html += '<button class="btn-ghost btn-sm btn-danger" id="btn-cancelar-job">✖ Cancelar</button>';
    }
    html += '<button class="btn-ghost btn-sm btn-danger" id="btn-eliminar-job">🗑 Eliminar</button>';
    html += '</div></div></div>';

    return html;
  }

  function buildConfirmar(j) {
    var unidadOpts = UNIDADES.map(function (u) {
      return '<option value="' + u.id + '"' + (j.unidad === u.id ? ' selected' : '') + '>' + esc(u.nombre) + '</option>';
    }).join('');

    return '<div class="ov-header">'
      + '<button class="ov-back" id="btn-ov-back">‹</button>'
      + '<h2>Confirmar trabajo</h2>'
      + '</div>'
      + '<div class="ov-body">'
      + (isScottDomingo(j.fecha) && j.unidad === 'scott' ? '<div class="alert-warn">⚠️ Scott no trabaja los domingos</div>' : '')
      + '<div class="form-section">'
      + '<div class="field"><label>Unidad asignada <span class="req">*</span></label>'
        + '<select id="conf-unidad">' + unidadOpts + '</select></div>'
      + '<div class="field"><label>Precio camioneta <span class="req">*</span></label>'
        + '<div class="money-wrap"><span class="money-prefix">$</span>'
        + '<input type="number" id="conf-precio" inputmode="numeric" placeholder="0" min="0" value="' + (j.precioCamioneta || '') + '" autocomplete="off">'
        + '</div></div>'
      + '<div class="field"><label>Adicionales — peones / escalera (solo informativo)</label>'
        + '<div class="money-wrap"><span class="money-prefix">$</span>'
        + '<input type="number" id="conf-adicionales" inputmode="numeric" placeholder="0" min="0" value="' + (j.adicionales || '') + '" autocomplete="off">'
        + '</div></div>'
      + '<div id="conf-preview"></div>'
      + '</div>'
      + '<div class="det-actions"><button class="btn-primary" id="btn-confirmar-save">Confirmar</button></div>'
      + '</div>';
  }

  function buildRealizar(j) {
    var hasG = tieneGastos(j.unidad);
    var gast = getGastos(j.fecha, j.unidad) || 0;
    return '<div class="ov-header">'
      + '<button class="ov-back" id="btn-ov-back">‹</button>'
      + '<h2>Marcar como realizado</h2>'
      + '</div>'
      + '<div class="ov-body">'
      + '<div class="form-section">'
      + '<div class="field"><label>Total cobrado real <span class="req">*</span></label>'
        + '<div class="money-wrap"><span class="money-prefix">$</span>'
        + '<input type="number" id="real-cobrado" inputmode="numeric" placeholder="0" min="0" value="' + (j.totalCobrado || '') + '" autocomplete="off">'
        + '</div></div>'
      + (hasG ? '<div class="field"><label>Gastos del día</label>'
        + '<div class="field-hint">Combustible, peajes, etc. — total del día para esta unidad</div>'
        + '<div class="money-wrap"><span class="money-prefix">$</span>'
        + '<input type="number" id="real-gastos" inputmode="numeric" placeholder="0" min="0" value="' + (gast || '') + '" autocomplete="off">'
        + '</div></div>' : '')
      + '<div class="field"><label>Comprobante de pago</label>'
        + '<select id="real-comprobante">'
        + '<option value="enviado"'   + (j.comprobante === 'enviado'    ? ' selected' : '') + '>Enviado</option>'
        + '<option value="pendiente"' + (j.comprobante === 'pendiente'  ? ' selected' : '') + '>Pendiente</option>'
        + '<option value="no_aplica"' + ((!j.comprobante || j.comprobante === 'no_aplica') ? ' selected' : '') + '>No aplica</option>'
        + '</select></div>'
      + '<div class="field"><label>Ganancia Martín</label>'
        + '<div class="field-hint">Se calcula automáticamente. Podés editarla.</div>'
        + '<div class="money-wrap"><span class="money-prefix">$</span>'
        + '<input type="number" id="real-ganancia" inputmode="numeric" placeholder="0" value="0" autocomplete="off">'
        + '</div></div>'
      + '</div>'
      + '<div class="det-actions"><button class="btn-primary btn-green" id="btn-realizar-save">Marcar como realizado</button></div>'
      + '</div>';
  }

  function bindDetalle(container) {
    var j = getById(S.selId);
    if (!j) return;

    function on(id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    }

    on('btn-ov-close', function () { closeOverlay(); render(); });
    on('btn-ov-back',  function () { S.ovPage = 'view'; renderOverlay(); });

    on('btn-ir-confirmar', function () { S.ovPage = 'confirmar'; renderOverlay(); });
    on('btn-ir-realizar',  function () { S.ovPage = 'realizar';  renderOverlay(); });

    on('btn-ver-comanda', function () { openOverlay('comanda', S.selId); });
    on('btn-editar-job',  function () { openOverlay('edit', S.selId); });

    on('btn-cancelar-job', function () {
      if (!confirm('¿Cancelar este trabajo?')) return;
      saveJob(Object.assign({}, j, { estado: 'cancelado' }));
      showToast('Trabajo cancelado');
      S.ovPage = 'view';
      renderOverlay();
      render();
    });

    on('btn-eliminar-job', function () {
      if (!confirm('¿Eliminar este trabajo? No se puede deshacer.')) return;
      deleteJob(j.id);
      showToast('Trabajo eliminado');
      closeOverlay();
      render();
    });

    // Confirmar — guardar
    on('btn-confirmar-save', function () {
      var unidad = document.getElementById('conf-unidad') ? document.getElementById('conf-unidad').value : null;
      var precio = parseMoney(document.getElementById('conf-precio') ? document.getElementById('conf-precio').value : '');
      if (!unidad)  { showToast('Seleccioná una unidad'); return; }
      if (!precio)  { showToast('Ingresá el precio de camioneta'); return; }
      if (unidad === 'scott' && isScottDomingo(j.fecha)) { showToast('⚠️ Scott no trabaja los domingos'); return; }
      var adicionales = parseMoney(document.getElementById('conf-adicionales') ? document.getElementById('conf-adicionales').value : '');
      var jobConf = Object.assign({}, j, { unidad: unidad, precioCamioneta: precio, adicionales: adicionales, estado: 'confirmado' });
      saveJob(jobConf);
      syncJob(jobConf);
      showToast('Trabajo confirmado ✓');
      S.ovPage = 'view';
      renderOverlay();
      render();
    });

    // Realizar — guardar
    on('btn-realizar-save', function () {
      var cobrado = parseMoney(document.getElementById('real-cobrado') ? document.getElementById('real-cobrado').value : '');
      if (!cobrado) { showToast('Ingresá el total cobrado'); return; }
      var gastosEl = document.getElementById('real-gastos');
      var gastos   = gastosEl ? parseMoney(gastosEl.value) : 0;
      var comp     = document.getElementById('real-comprobante') ? document.getElementById('real-comprobante').value : 'no_aplica';
      var gananciaEl = document.getElementById('real-ganancia');
      var ganancia   = Math.round(Number(gananciaEl ? gananciaEl.value : 0) || 0);
      if (tieneGastos(j.unidad)) saveGastos(j.fecha, j.unidad, gastos);
      var jobReal = Object.assign({}, j, { totalCobrado: cobrado, gananciaNeta: ganancia, comprobante: comp, estado: 'realizado' });
      saveJob(jobReal);
      syncJob(jobReal, gastos);
      showToast('¡Trabajo realizado! ✓');
      S.ovPage = 'view';
      renderOverlay();
      render();
    });

    // Preview en tiempo real — confirmar
    function updateConfPreview() {
      var uid    = document.getElementById('conf-unidad') ? document.getElementById('conf-unidad').value : null;
      var precio = parseMoney(document.getElementById('conf-precio') ? document.getElementById('conf-precio').value : '');
      var el     = document.getElementById('conf-preview');
      if (!el) return;
      if (uid === 'scott' && isScottDomingo(j.fecha)) {
        el.innerHTML = '<div class="alert-warn">⚠️ Scott no trabaja los domingos</div>'; return;
      }
      if (!precio || !uid) { el.innerHTML = ''; return; }
      var gan = calcGanancia(uid, precio, 0, j.fecha);
      el.innerHTML = '<div class="ganancia-preview"><span class="preview-label">Ganancia estimada Martín:</span> <span class="preview-amount">' + formatMoney(gan) + '</span></div>';
    }
    var confPrecio = document.getElementById('conf-precio');
    var confUnidad = document.getElementById('conf-unidad');
    if (confPrecio) { confPrecio.addEventListener('input', updateConfPreview); updateConfPreview(); }
    if (confUnidad) confUnidad.addEventListener('change', updateConfPreview);

    // Ganancia editable — detalle realizado
    on('btn-guardar-ganancia', function () {
      var ganEl = document.getElementById('edit-ganancia');
      var gan   = Math.round(Number(ganEl ? ganEl.value : (j.gananciaNeta || 0)) || 0);
      var jobGan = Object.assign({}, j, { gananciaNeta: gan });
      saveJob(jobGan);
      syncJob(jobGan);
      showToast('Ganancia actualizada ✓');
      renderOverlay();
      render();
    });

    // Preview en tiempo real — realizar (actualiza el input de ganancia)
    function updateRealPreview() {
      var cobrado  = parseMoney(document.getElementById('real-cobrado') ? document.getElementById('real-cobrado').value : '');
      var gastosEl = document.getElementById('real-gastos');
      var gastos   = gastosEl ? parseMoney(gastosEl.value) : 0;
      var ganEl    = document.getElementById('real-ganancia');
      if (!ganEl) return;
      if (!cobrado) { ganEl.value = 0; return; }
      ganEl.value = calcGanancia(j.unidad, cobrado, gastos, j.fecha);
    }
    var realCobrado = document.getElementById('real-cobrado');
    var realGastos  = document.getElementById('real-gastos');
    if (realCobrado) { realCobrado.addEventListener('input', updateRealPreview); updateRealPreview(); }
    if (realGastos)    realGastos.addEventListener('input', updateRealPreview);
  }

  // ════════════════════════════════════════════════════════════════════════
  // COMANDA OVERLAY
  // ════════════════════════════════════════════════════════════════════════
  function buildComanda() {
    var j = getById(S.selId);
    if (!j) return '<div class="ov-header"><button class="ov-back" id="btn-comanda-back">‹</button><h2>Comanda</h2></div>';
    var texto = generarComanda(j);
    return '<div class="ov-header">'
      + '<button class="ov-back" id="btn-comanda-back">‹</button>'
      + '<h2>Comanda – ' + esc(j.nombre || '') + '</h2>'
      + '</div>'
      + '<div class="ov-body">'
      + '<div class="comanda-preview">' + esc(texto) + '</div>'
      + '<button class="btn-primary" id="btn-copiar-comanda">Copiar comanda</button>'
      + '</div>';
  }

  function bindComanda(container) {
    var j = getById(S.selId);
    var back = document.getElementById('btn-comanda-back');
    var copy = document.getElementById('btn-copiar-comanda');
    if (back) back.addEventListener('click', function () { openOverlay('detalle', S.selId, 'view'); });
    if (copy && j) copy.addEventListener('click', function () {
      var texto = generarComanda(j);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(function () { showToast('Comanda copiada ✓'); }).catch(function () { fallbackCopy(texto); });
      } else {
        fallbackCopy(texto);
      }
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Comanda copiada ✓'); } catch (e) { showToast('No se pudo copiar'); }
    document.body.removeChild(ta);
  }

  // ════════════════════════════════════════════════════════════════════════
  // IMPORTAR DESDE EMAIL
  // ════════════════════════════════════════════════════════════════════════
  function buildImportar() {
    var unidadOpts = '<option value="">— Sin asignar —</option>'
      + UNIDADES.map(function (u) {
          return '<option value="' + u.id + '">' + esc(u.nombre) + '</option>';
        }).join('');

    return '<div class="ov-header">'
      + '<button class="ov-back" id="btn-importar-close">‹</button>'
      + '<h2>Importar desde email</h2>'
      + '</div>'
      + '<div class="ov-body">'
      + '<p class="import-hint">Pegá el cuerpo del mail de confirmación de Forminator:</p>'
      + '<div class="field"><textarea id="import-text" rows="8" placeholder="*DD-MM-AAAA*&#10;*HH:MM - HH:MM*&#10;*Nombre*&#10;..."></textarea></div>'
      + '<div class="field"><label>Unidad asignada</label>'
        + '<select id="import-unidad">' + unidadOpts + '</select>'
      + '</div>'
      + '<div class="det-actions"><button class="btn-primary" id="btn-importar-ok">Importar trabajo</button></div>'
      + '</div>';
  }

  function bindImportar(container) {
    var closeBtn = document.getElementById('btn-importar-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { closeOverlay(); render(); });

    var okBtn = document.getElementById('btn-importar-ok');
    if (okBtn) okBtn.addEventListener('click', function () {
      var text    = document.getElementById('import-text')   ? document.getElementById('import-text').value   : '';
      var unidad  = document.getElementById('import-unidad') ? document.getElementById('import-unidad').value : '';
      if (!text.trim()) { showToast('Pegá el contenido del email'); return; }
      var job = parseEmailForminator(text);
      if (!job) { showToast('No se pudo leer el email. Verificá el formato.'); return; }
      if (!job.nombre) { showToast('No se encontró el nombre del cliente'); return; }
      job.id     = generateId();
      job.unidad = unidad || null;
      saveJob(job);
      S.fecha = job.fecha;
      closeOverlay();
      navigateTo('agenda');
      showToast('Trabajo importado ✓');
    });
  }

  function snapHora(hora) {
    var parts = hora.split(':');
    var mins = Number(parts[0]) * 60 + Number(parts[1] || 0);
    var opts = horasOpciones();
    var best = opts[0], bestDiff = Infinity;
    opts.forEach(function (o) {
      var op = o.split(':');
      var diff = Math.abs(Number(op[0]) * 60 + Number(op[1]) - mins);
      if (diff < bestDiff) { bestDiff = diff; best = o; }
    });
    return best;
  }

  function parseEmailForminator(text) {
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l; });

    var result = {
      canal: 'web', fecha: getTodayStr(), hora: '09:00',
      nombre: '', telefonoRetiro: '', telefonoEntrega: '',
      inventario: '', peones: 'sin_peones',
      calleRetiro: '', pisoRetiro: '', barrioRetiro: '',
      calleEntrega: '', pisoEntrega: '', barrioEntrega: '',
      formaPago: 'transferencia', viajaEnUnidad: 'no',
      aclaraciones: '', estado: 'nuevo',
      unidad: null, precioCamioneta: 0, adicionales: 0,
      totalCobrado: 0, gananciaNeta: 0, comprobante: 'no_aplica',
    };

    // Date: *DD-MM-YYYY*
    var dateIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      var dm = lines[i].match(/^\*(\d{2})-(\d{2})-(\d{4})\*$/);
      if (dm) {
        result.fecha = dm[3] + '-' + dm[2] + '-' + dm[1];
        dateIdx = i;
        break;
      }
    }
    if (dateIdx < 0) return null;

    var idx = dateIdx + 1;

    // Time: *HH:MM...*
    if (idx < lines.length) {
      var tm = lines[idx].match(/^\*(\d{1,2}:\d{2})/);
      if (tm) { result.hora = snapHora(tm[1]); idx++; }
    }

    // Name: *Nombre*  (entire line bold)
    if (idx < lines.length) {
      var nm = lines[idx].match(/^\*([^*]+)\*$/);
      if (nm) { result.nombre = nm[1].trim(); idx++; }
    }

    // Inventario: accumulate until *Peones*
    var inventLines = [];
    while (idx < lines.length && !/^\*Peones\*/i.test(lines[idx])) {
      inventLines.push(lines[idx]);
      idx++;
    }
    result.inventario = inventLines.join('\n').trim();

    // Peones: *Peones* ...rest
    if (idx < lines.length && /^\*Peones\*/i.test(lines[idx])) {
      var pt = lines[idx].replace(/^\*Peones\*\s*/i, '').toLowerCase();
      if (/escalera/i.test(pt))      result.peones = 'escaleras';
      else if (/ascensor/i.test(pt)) result.peones = 'ascensor';
      else if (/no s[eé]/i.test(pt)) result.peones = 'no_se';
      else                           result.peones = 'sin_peones';
      idx++;
    }

    // Dir retiro:
    if (idx < lines.length && /^\*Dir retiro:\*$/i.test(lines[idx])) {
      idx++;
      if (idx < lines.length && !/^\*/.test(lines[idx])) {
        var sr = lines[idx]; idx++;
        var pm = sr.match(/^(.+?\d+)\s{2,}(.+)$/);
        if (pm) { result.calleRetiro = pm[1].trim(); result.pisoRetiro = pm[2].trim(); }
        else    { result.calleRetiro = sr.trim(); }
      }
      if (idx < lines.length && !/^\*/.test(lines[idx]) && !/^\d{7,}/.test(lines[idx])) {
        result.barrioRetiro = lines[idx]; idx++;
      }
      if (idx < lines.length && /^\d/.test(lines[idx])) {
        result.telefonoRetiro = lines[idx]; idx++;
      }
    }

    // Dir entrega:
    if (idx < lines.length && /^\*Dir entrega:\*$/i.test(lines[idx])) {
      idx++;
      if (idx < lines.length && !/^\*/.test(lines[idx])) {
        var se = lines[idx]; idx++;
        var pe = se.match(/^(.+?\d+)\s{2,}(.+)$/);
        if (pe) { result.calleEntrega = pe[1].trim(); result.pisoEntrega = pe[2].trim(); }
        else    { result.calleEntrega = se.trim(); }
      }
      if (idx < lines.length && !/^\*/.test(lines[idx]) && !/^\d{7,}/.test(lines[idx])) {
        result.barrioEntrega = lines[idx]; idx++;
      }
      if (idx < lines.length && /^\d/.test(lines[idx])) {
        result.telefonoEntrega = lines[idx]; idx++;
      }
    }

    // Remaining lines: Pago, Viaja, extras
    while (idx < lines.length) {
      if (/^\*Pago\*/i.test(lines[idx])) {
        var pg = lines[idx].replace(/^\*Pago\*\s*/i, '').toLowerCase();
        result.formaPago = /transfer/i.test(pg) ? 'transferencia' : 'efectivo';
      } else if (/^\*Viaja\*/i.test(lines[idx])) {
        var vj = lines[idx].replace(/^\*Viaja\*\s*/i, '');
        if (/^s[ií]/i.test(vj))               result.viajaEnUnidad = 'si';
        else if (/movilidad|propia/i.test(vj)) result.viajaEnUnidad = 'movilidad';
        else                                   result.viajaEnUnidad = 'no';
      } else {
        result.aclaraciones += (result.aclaraciones ? '\n' : '') + lines[idx];
      }
      idx++;
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════════════════
  // RESUMEN DEL DÍA
  // ════════════════════════════════════════════════════════════════════════
  function buildResumen() {
    var jobs = getByFecha(S.resumenFecha).filter(function (j) {
      return j.estado === 'confirmado' || j.estado === 'realizado';
    });

    var byUnit = {};
    jobs.forEach(function (j) {
      if (!j.unidad) return;
      if (!byUnit[j.unidad]) byUnit[j.unidad] = [];
      byUnit[j.unidad].push(j);
    });

    var grandFact = 0, grandGan = 0;

    var rows = UNIDADES.filter(function (u) { return byUnit[u.id]; }).map(function (u) {
      var uJobs = byUnit[u.id];
      var facturado = uJobs.reduce(function (s, j) {
        return s + (j.estado === 'realizado' ? (j.totalCobrado || 0) : (j.precioCamioneta || 0));
      }, 0);
      var gastos = getGastos(S.resumenFecha, u.id);
      var ganancia = uJobs.reduce(function (s, j) {
        if (j.estado === 'realizado') return s + (j.gananciaNeta || 0);
        return s + calcGanancia(u.id, j.precioCamioneta, gastos, j.fecha);
      }, 0);
      // Evitar doble descuento: si hay mix realizado/confirmado, usar solo gastos ya aplicados
      grandFact += facturado;
      grandGan  += ganancia;
      return '<tr><td class="td-unit">' + esc(u.nombre) + '</td>'
        + '<td class="td-num">' + uJobs.length + '</td>'
        + '<td class="td-num">' + formatMoney(facturado) + '</td>'
        + '<td class="td-num">' + (gastos ? formatMoney(gastos) : '—') + '</td>'
        + '<td class="td-num bold ' + (ganancia < 0 ? 'text-neg' : 'text-pos') + '">' + formatMoney(ganancia) + '</td>'
        + '</tr>';
    });

    var tableHtml = rows.length
      ? '<div class="table-wrap"><table class="data-table">'
          + '<thead><tr><th>Unidad</th><th>Serv.</th><th>Facturado</th><th>Gastos</th><th>Ganancia</th></tr></thead>'
          + '<tbody>' + rows.join('') + '</tbody>'
          + '<tfoot><tr><td class="bold">TOTAL</td>'
            + '<td class="td-num bold">' + jobs.length + '</td>'
            + '<td class="td-num bold">' + formatMoney(grandFact) + '</td>'
            + '<td></td>'
            + '<td class="td-num bold ' + (grandGan < 0 ? 'text-neg' : 'text-pos') + '">' + formatMoney(grandGan) + '</td>'
          + '</tr></tfoot>'
        + '</table></div>'
        + '<div class="card summary-card"><div class="summary-row ganancia-row' + (grandGan < 0 ? ' neg' : '') + '">'
          + '<span>Ganancia total Martín</span><span class="ganancia-amount">' + formatMoney(grandGan) + '</span>'
        + '</div></div>'
      : '<p class="empty-msg">Sin trabajos confirmados o realizados para este día.</p>';

    return '<div class="date-nav">'
      + '<button class="btn-nav" id="btn-res-prev">‹</button>'
      + '<div class="date-label"><span class="date-label-main">' + formatFechaLarga(S.resumenFecha) + '</span></div>'
      + '<button class="btn-nav" id="btn-res-next">›</button>'
      + '</div>'
      + '<div class="section-header"><span>Resumen del día</span></div>'
      + tableHtml;
  }

  function bindResumen(main) {
    var prev = document.getElementById('btn-res-prev');
    var next = document.getElementById('btn-res-next');
    if (prev) prev.addEventListener('click', function () {
      S.resumenFecha = addDays(S.resumenFecha, -1);
      main.innerHTML = buildResumen(); bindResumen(main);
    });
    if (next) next.addEventListener('click', function () {
      S.resumenFecha = addDays(S.resumenFecha, 1);
      main.innerHTML = buildResumen(); bindResumen(main);
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // CAJA MENSUAL
  // ════════════════════════════════════════════════════════════════════════
  function buildCaja() {
    var jobs = getByMes(S.cajaYear, S.cajaMonth).filter(function (j) {
      return j.estado === 'confirmado' || j.estado === 'realizado';
    });

    var byUnit = {};
    jobs.forEach(function (j) {
      if (!j.unidad) return;
      if (!byUnit[j.unidad]) byUnit[j.unidad] = [];
      byUnit[j.unidad].push(j);
    });

    var grandFact = 0, grandGan = 0;

    var rows = UNIDADES.filter(function (u) { return byUnit[u.id]; }).map(function (u) {
      var uJobs = byUnit[u.id];
      var facturado = uJobs.reduce(function (s, j) {
        return s + (j.estado === 'realizado' ? (j.totalCobrado || 0) : (j.precioCamioneta || 0));
      }, 0);
      // Gastos por fecha única
      var fechas = uJobs.reduce(function (acc, j) {
        if (acc.indexOf(j.fecha) < 0) acc.push(j.fecha);
        return acc;
      }, []);
      var gastosMes = fechas.reduce(function (s, f) { return s + (getGastos(f, u.id) || 0); }, 0);
      var ganancia = uJobs.reduce(function (s, j) {
        if (j.estado === 'realizado') return s + (j.gananciaNeta || 0);
        return s + calcGanancia(u.id, j.precioCamioneta, 0, j.fecha);
      }, 0);
      grandFact += facturado;
      grandGan  += ganancia;
      return '<tr><td class="td-unit">' + esc(u.nombre) + '</td>'
        + '<td class="td-num">' + uJobs.length + '</td>'
        + '<td class="td-num">' + formatMoney(facturado) + '</td>'
        + '<td class="td-num bold ' + (ganancia < 0 ? 'text-neg' : 'text-pos') + '">' + formatMoney(ganancia) + '</td>'
        + '</tr>';
    });

    var tableHtml = rows.length
      ? '<div class="table-wrap"><table class="data-table">'
          + '<thead><tr><th>Unidad</th><th>Serv.</th><th>Facturado</th><th>Ganancia</th></tr></thead>'
          + '<tbody>' + rows.join('') + '</tbody>'
          + '<tfoot><tr><td class="bold">TOTAL</td>'
            + '<td class="td-num bold">' + jobs.length + '</td>'
            + '<td class="td-num bold">' + formatMoney(grandFact) + '</td>'
            + '<td class="td-num bold ' + (grandGan < 0 ? 'text-neg' : 'text-pos') + '">' + formatMoney(grandGan) + '</td>'
          + '</tr></tfoot>'
        + '</table></div>'
        + '<div class="card summary-card"><div class="summary-row ganancia-row' + (grandGan < 0 ? ' neg' : '') + '">'
          + '<span>Ganancia total Martín</span><span class="ganancia-amount">' + formatMoney(grandGan) + '</span>'
        + '</div></div>'
      : '<p class="empty-msg">Sin trabajos en ' + getMesStr(S.cajaYear, S.cajaMonth) + '.</p>';

    return '<div class="mes-nav">'
      + '<button class="btn-nav" id="btn-mes-prev">‹</button>'
      + '<span class="month-label">' + getMesStr(S.cajaYear, S.cajaMonth) + '</span>'
      + '<button class="btn-nav" id="btn-mes-next">›</button>'
      + '</div>'
      + '<div class="section-header"><span>Caja mensual</span></div>'
      + tableHtml;
  }

  function bindCaja(main) {
    var prev = document.getElementById('btn-mes-prev');
    var next = document.getElementById('btn-mes-next');
    if (prev) prev.addEventListener('click', function () {
      var p = prevMes(S.cajaYear, S.cajaMonth);
      S.cajaYear = p.year; S.cajaMonth = p.month;
      main.innerHTML = buildCaja(); bindCaja(main);
    });
    if (next) next.addEventListener('click', function () {
      var n = nextMes(S.cajaYear, S.cajaMonth);
      S.cajaYear = n.year; S.cajaMonth = n.month;
      main.innerHTML = buildCaja(); bindCaja(main);
    });
  }

})();
