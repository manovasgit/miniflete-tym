const Pricing = (() => {

  const DEFAULT_CONFIG = {
    miniflete: {
      base_caba: 40000,
      base_gba: 55000,
      base_provincia: 70000,
      ascensor_chofer: 10000,
      ascensor_peon: 25000,
      escalera_bultos_por_piso: 5000,
      escalera_completa_piso1: 30000,
      escalera_completa_piso2: 50000,
      escalera_completa_piso3: 70000,
      escalera_completa_piso4: 90000,
      escalera_completa_piso5: 110000,
      escalera_completa_incremento_extra: 20000
    },
    camion: {
      hora_caba: 80000,
      hora_gba: 100000,
      hora_provincia: 100000,
      minimo_caba_horas: 1.5,
      minimo_gba_horas: 2,
      minimo_provincia_horas: 2,
      peon_hora_caba: 25000,
      peon_hora_gba: 25000,
      peon_hora_provincia: 30000
    },
    reparto: {
      hora_estandar: 30000,
      hora_volumen_alto: 25000,
      minimo_horas: 4
    }
  };

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem('mftym_tarifas')) || DEFAULT_CONFIG;
    } catch { return DEFAULT_CONFIG; }
  }

  function formatMonto(n) {
    return '$' + Math.round(n || 0).toLocaleString('es-AR');
  }

  function escaleraCostoCompleta(piso, cfg) {
    const c = cfg.miniflete;
    if (piso <= 0) return 0;
    const table = [0,
      c.escalera_completa_piso1,
      c.escalera_completa_piso2,
      c.escalera_completa_piso3,
      c.escalera_completa_piso4,
      c.escalera_completa_piso5
    ];
    if (piso <= 5) return table[piso];
    return c.escalera_completa_piso5 + (piso - 5) * c.escalera_completa_incremento_extra;
  }

  function escaleraCosto(tipo, piso, bultos, cfg) {
    if (!tipo || tipo === 'completa') return escaleraCostoCompleta(piso, cfg);
    return cfg.miniflete.escalera_bultos_por_piso * (bultos || 0) * (piso || 0);
  }

  const TIPO_ESC_LABEL = {
    completa: 'Escalera completa',
    parcial: 'Escalera parcial',
    sueltos: 'Bultos por escalera'
  };

  function addEscaleraOrigen(form, cfg, breakdown) {
    if (form.accesoOrigen !== 'escalera') return 0;
    const piso = parseInt(form.pisoOrigen) || 1;
    const tipo = form.tipoEscaleraOrigen || 'completa';
    const bultos = parseInt(form.bultosEscaleraOrigen) || 0;
    const amt = escaleraCosto(tipo, piso, bultos, cfg);
    if (amt > 0) breakdown.push({ label: `${TIPO_ESC_LABEL[tipo] || 'Escalera'} en origen – Piso ${piso}`, amount: amt });
    return amt;
  }

  function addEscaleraDestino(form, cfg, breakdown) {
    if (form.accesoDestino !== 'escalera') return 0;
    const piso = parseInt(form.pisoDestino) || 1;
    const tipo = form.tipoEscaleraDestino || 'completa';
    const bultos = parseInt(form.bultosEscaleraDestino) || 0;
    const amt = escaleraCosto(tipo, piso, bultos, cfg);
    if (amt > 0) breakdown.push({ label: `${TIPO_ESC_LABEL[tipo] || 'Escalera'} en destino – Piso ${piso}`, amount: amt });
    return amt;
  }

  function calculate(form) {
    const cfg = getConfig();
    const breakdown = [];
    let total = 0;
    const zona = form.zona || 'caba';
    const zs = zona === 'caba' ? 'caba' : zona === 'gba' ? 'gba' : 'provincia';
    const zonaLabel = { caba: 'Solo CABA', gba: 'CABA ↔ GBA', provincia: 'CABA ↔ Provincia' }[zona];
    const svc = form.serviceType;

    if (svc === 'miniflete' || svc === 'expreso') {
      const svcLabel = svc === 'expreso' ? 'Traslado a expreso' : 'Miniflete / Flete puntual';
      const base = cfg.miniflete[`base_${zs}`];
      breakdown.push({ label: `${svcLabel} – ${zonaLabel}`, amount: base });
      total += base;

      if (form.accesoOrigen === 'ascensor') {
        const a = cfg.miniflete.ascensor_chofer;
        breakdown.push({ label: 'Ascensor en origen', amount: a });
        total += a;
      }
      if (form.accesoDestino === 'ascensor') {
        const a = cfg.miniflete.ascensor_chofer;
        breakdown.push({ label: 'Ascensor en destino', amount: a });
        total += a;
      }
      total += addEscaleraOrigen(form, cfg, breakdown);
      total += addEscaleraDestino(form, cfg, breakdown);

    } else if (svc === 'camion') {
      const tarifaHora = cfg.camion[`hora_${zs}`];
      const minimo = cfg.camion[`minimo_${zs}_horas`];
      const horasIngresadas = parseFloat(form.horasEstimadas) || 0;
      const horasCobradas = Math.max(horasIngresadas, minimo);
      const minimoAplicado = horasCobradas > horasIngresadas;
      const horasLabel = minimoAplicado ? `${horasCobradas}hs (mínimo aplicado)` : `${horasCobradas}hs`;

      const subtotalCamion = horasCobradas * tarifaHora;
      breakdown.push({ label: `Camión mudancero – ${horasLabel} × ${formatMonto(tarifaHora)}`, amount: subtotalCamion });
      total += subtotalCamion;

      const cantPeones = parseInt(form.cantidadPeones) || 0;
      if (cantPeones > 0) {
        const tarifaPeon = cfg.camion[`peon_hora_${zs}`];
        const subtotalPeones = cantPeones * horasCobradas * tarifaPeon;
        breakdown.push({ label: `${cantPeones} peón${cantPeones > 1 ? 'es' : ''} – ${horasLabel} × ${formatMonto(tarifaPeon)}`, amount: subtotalPeones });
        total += subtotalPeones;
      }

      total += addEscaleraOrigen(form, cfg, breakdown);
      total += addEscaleraDestino(form, cfg, breakdown);

      breakdown._horasCobradas = horasCobradas;
      breakdown._minimoAplicado = minimoAplicado;

    } else if (svc === 'reparto') {
      const volumen = form.volumen || 'estandar';
      const tarifa = volumen === 'alto' ? cfg.reparto.hora_volumen_alto : cfg.reparto.hora_estandar;
      const minimo = cfg.reparto.minimo_horas;
      const precio = tarifa * minimo;
      const volLabel = volumen === 'alto' ? 'Alto volumen' : 'Estándar';
      breakdown.push({ label: `Reparto ${volLabel} – mínimo ${minimo}hs × ${formatMonto(tarifa)}`, amount: precio });
      total += precio;
      breakdown._isReparto = true;
      breakdown._minimoHoras = minimo;
    }

    if (form.incluyePeajes) {
      const peajes = parseFloat(form.montoPeajes) || 0;
      if (peajes > 0) {
        breakdown.push({ label: '🛣 Peajes', amount: peajes });
        total += peajes;
      }
    }

    return { breakdown, total };
  }

  function generateMessage(form, breakdown, totalFinal) {
    const svcLabels = {
      miniflete: 'Miniflete / Flete puntual',
      camion: 'Mudanza con camión',
      reparto: 'Reparto de mercadería',
      expreso: 'Traslado desde/hacia expreso'
    };
    const pagoLabels = {
      efectivo: 'Efectivo',
      transferencia: 'Transferencia bancaria',
      efectivo_transferencia: 'Efectivo o transferencia'
    };

    let recorrido = { caba: 'Solo CABA', gba: 'CABA ↔ GBA (hasta ~40km)', provincia: 'CABA ↔ Provincia' }[form.zona] || '-';
    if (form.zona === 'provincia' && form.ciudadProvincial) recorrido = `CABA ↔ ${form.ciudadProvincial}`;

    function accesoLabel(acceso, piso) {
      if (acceso === 'pb') return 'Planta baja';
      if (acceso === 'ascensor') return 'Con ascensor';
      if (acceso === 'escalera') return `Escalera – piso ${piso || 1}`;
      return 'A confirmar';
    }

    let fecha = 'A confirmar';
    if (form.fechaTentativa) {
      try {
        fecha = new Date(form.fechaTentativa + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
      } catch {}
    }

    const desglose = breakdown
      .filter(i => i && typeof i.amount === 'number' && i.amount > 0)
      .map(i => `  └ ${i.label}: ${formatMonto(i.amount)}`)
      .join('\n');

    let extraTotal = '';
    if (form.serviceType === 'camion' && breakdown._horasCobradas) {
      extraTotal = `\n_(estimado para ${breakdown._horasCobradas} horas de trabajo cargados)_`;
    } else if (form.serviceType === 'reparto' && breakdown._isReparto) {
      extraTotal = `\n_(estimado para ${breakdown._minimoHoras} horas mínimas de trabajo)_`;
    }

    const aclaraciones = form.aclaraciones && form.aclaraciones.trim()
      ? `\n${form.aclaraciones.trim()}\n`
      : '';

    return `¡Hola! 😊 Te mando el presupuesto según lo que me contaste:

🚚 *Servicio:* ${svcLabels[form.serviceType] || '-'}
📍 *Recorrido:* ${recorrido}
📦 *Carga:* ${form.descripcionCarga || '-'}
🏢 *Origen:* ${accesoLabel(form.accesoOrigen, form.pisoOrigen)}
🏢 *Destino:* ${accesoLabel(form.accesoDestino, form.pisoDestino)}
📅 *Fecha tentativa:* ${fecha}

💰 *Desglose:*
${desglose}

💵 *Total estimado: ${formatMonto(totalFinal)}*${extraTotal}

💳 *Forma de pago:* ${pagoLabels[form.formaPago] || '-'}
${aclaraciones}
Cualquier consulta, avisame 🙌
*Miniflete TyM* | 📞 11 6455-4602`;
  }

  return { DEFAULT_CONFIG, getConfig, formatMonto, calculate, generateMessage };
})();
