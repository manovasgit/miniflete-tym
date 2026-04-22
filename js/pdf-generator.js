const PDFGenerator = (() => {
  const DARK_RED = [139, 0, 0];
  const RED = [192, 57, 43];
  const WHITE = [255, 255, 255];
  const DARK = [30, 30, 30];
  const GRAY = [100, 100, 100];
  const LIGHT_GRAY = [240, 240, 240];

  function conditions(serviceType, vehicle) {
    const base = [
      'Factura C.',
      'Formas de pago: efectivo o transferencia bancaria.',
      'Seña mínima: 30% para confirmar turno. Saldo al finalizar el servicio.',
      'Precios sujetos a revisión trimestral.',
      'Servicio de atención 24hs los 365 días del año.'
    ];

    const isMudanza = serviceType && serviceType.toLowerCase().includes('mudanza');
    const isMiniflete = vehicle === 'utilitario' || serviceType === 'Miniflete';

    if (isMudanza) {
      base.unshift('El tiempo se contabiliza desde la llegada del chofer al lugar de origen.');
    }
    if (isMiniflete || serviceType === 'Miniflete' || serviceType === 'Flete') {
      base.push('Los bultos deben estar listos y en puerta al momento de la llegada.');
      base.push('A partir de 15 minutos de espera se cobran $10.000 cada 15 minutos adicionales.');
    }
    return base;
  }

  // Cached logo data URL — loaded at app startup via preload()
  let _cachedLogo = null;

  function preload() {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 120; canvas.height = 120;
        canvas.getContext('2d').drawImage(img, 0, 0, 120, 120);
        _cachedLogo = canvas.toDataURL('image/png');
      } catch (e) { _cachedLogo = null; }
    };
    img.onerror = () => { _cachedLogo = null; };
    img.src = 'icons/logo.png';
  }

  function generate(proposal) {
    if (!window.jspdf) {
      printFallback(proposal);
      return;
    }
    // Use cached logo — loaded at startup, so this is synchronous
    buildPDF(proposal, _cachedLogo);
  }

  function buildPDF(proposal, logoData) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 12;
    let y = 0;

    // ── HEADER ──────────────────────────────────────────────────────────────
    doc.setFillColor(...DARK_RED);
    doc.rect(0, 0, W, 46, 'F');

    doc.setFillColor(...RED);
    doc.rect(0, 42, W, 4, 'F');

    // Logo circular (izquierda)
    if (logoData) {
      doc.addImage(logoData, 'PNG', M, 3, 40, 40);
    }

    // Company name (centrado en el espacio restante)
    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('MINIFLETE TyM', logoData ? 130 : W / 2, 15, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Transportes y Mudanzas', logoData ? 130 : W / 2, 23, { align: 'center' });
    doc.text('Buenos Aires, Argentina', logoData ? 130 : W / 2, 29, { align: 'center' });

    doc.setFontSize(8.5);
    doc.text('Tel: 11 6455-4602  ·  wa.me/5491164554602  ·  www.minifletetym.com.ar', logoData ? 130 : W / 2, 37, { align: 'center' });

    // ── PROPOSAL BANNER ─────────────────────────────────────────────────────
    y = 56;
    doc.setFillColor(...LIGHT_GRAY);
    doc.rect(M, y - 5, W - M * 2, 16, 'F');
    doc.setTextColor(...DARK_RED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('PROPUESTA COMERCIAL', M + 4, y + 3);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...DARK);
    doc.text(`N° ${proposal.proposalNumber}`, W - M - 4, y - 1, { align: 'right' });
    doc.text(`Fecha: ${formatDate(proposal.createdAt)}`, W - M - 4, y + 5, { align: 'right' });

    y = 75;

    // ── CLIENT DATA ──────────────────────────────────────────────────────────
    y = section(doc, 'DATOS DEL CLIENTE', y, M, W);
    const clientRows = [
      ['Cliente:', proposal.clientName || '-'],
      ['Rubro:', proposal.clientRubro || '-'],
      ['Contacto:', proposal.clientContact || '-'],
      ['Teléfono:', proposal.clientPhone || '-'],
    ];
    if (proposal.clientEmail) clientRows.push(['Email:', proposal.clientEmail]);
    y = table(doc, clientRows, y, M, W);

    // ── SERVICE DATA ─────────────────────────────────────────────────────────
    y = section(doc, 'DATOS DEL SERVICIO', y + 6, M, W);
    const freqLine = (proposal.frequency && proposal.frequency !== 'Puntual')
      ? `${proposal.serviceType} – Frecuencia: ${proposal.frequency}`
      : proposal.serviceType || '-';
    const serviceRows = [
      ['Tipo de servicio:', freqLine],
      ['Origen:', proposal.originZone || '-'],
      ['Destino:', proposal.destZone || '-'],
      ['Vehículo:', Pricing.VEHICLE_LABELS[proposal.vehicleType] || '-'],
      ['Modalidad:', proposal.serviceMode === 'peones' ? 'Con peones' : 'Solo traslado'],
    ];
    if (proposal.vehicleType === 'camion' || proposal.serviceMode === 'peones') {
      serviceRows.push(['Horas estimadas:', `${Math.max(2, proposal.hours || 2)} hs (mínimo 2 hs)`]);
    }
    if (proposal.serviceMode === 'peones') {
      serviceRows.push(['Cantidad de peones:', `${Math.max(2, proposal.peones || 2)} (mínimo 2)`]);
    }
    y = table(doc, serviceRows, y, M, W);

    // ── INVENTORY ────────────────────────────────────────────────────────────
    if (proposal.inventory && proposal.inventory.trim()) {
      y = section(doc, 'INVENTARIO / DETALLE DE TRASLADO', y + 6, M, W);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...DARK);
      const lines = doc.splitTextToSize(proposal.inventory, W - M * 2 - 4);
      doc.text(lines, M + 2, y);
      y += lines.length * 4.5 + 2;
    }

    // ── PRICING ──────────────────────────────────────────────────────────────
    y = section(doc, 'DETALLE DE PRECIOS', y + 6, M, W);

    const breakdown = proposal.priceBreakdown || [];
    doc.setFontSize(9);
    breakdown.forEach(item => {
      checkNewPage(doc, y, 8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...DARK);
      doc.text(item.label, M + 2, y);
      doc.text(Pricing.fmt(item.amount), W - M - 2, y, { align: 'right' });
      y += 6;
    });

    // Separator line
    doc.setDrawColor(...GRAY);
    doc.line(M, y, W - M, y);
    y += 5;

    const finalPrice = proposal.finalPrice || 0;
    const downPayment = Math.round(finalPrice * 0.3);
    const balance = finalPrice - downPayment;

    // Total
    doc.setFillColor(...DARK_RED);
    doc.rect(M, y - 4, W - M * 2, 10, 'F');
    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('PRECIO TOTAL', M + 4, y + 2);
    doc.text(Pricing.fmt(finalPrice), W - M - 4, y + 2, { align: 'right' });
    y += 12;

    doc.setTextColor(...DARK);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Seña mínima (30%):', M + 4, y);
    doc.setFont('helvetica', 'bold');
    doc.text(Pricing.fmt(downPayment), W - M - 4, y, { align: 'right' });
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.text('Saldo al finalizar:', M + 4, y);
    doc.text(Pricing.fmt(balance), W - M - 4, y, { align: 'right' });
    y += 8;

    if (proposal.notes && proposal.notes.trim()) {
      doc.setFontSize(9);
      doc.setTextColor(...GRAY);
      doc.text('Nota: ' + proposal.notes, M + 2, y);
      y += 6;
    }

    // ── CONDITIONS ───────────────────────────────────────────────────────────
    y = section(doc, 'CONDICIONES GENERALES', y + 6, M, W);
    const conds = conditions(proposal.serviceType, proposal.vehicleType);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...DARK);
    conds.forEach(c => {
      if (y > 265) { doc.addPage(); y = 15; }
      const lines = doc.splitTextToSize('• ' + c, W - M * 2 - 6);
      doc.text(lines, M + 4, y);
      y += lines.length * 4.5 + 1;
    });

    // ── FOOTER ───────────────────────────────────────────────────────────────
    const footerY = 282;
    doc.setFillColor(...DARK_RED);
    doc.rect(0, footerY - 2, W, 18, 'F');
    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Miniflete TyM  |  Tel: 11 6455-4602  |  minifletestym@gmail.com  |  www.minifletetym.com.ar', W / 2, footerY + 4, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Esta propuesta tiene validez de 30 días desde la fecha de emisión.', W / 2, footerY + 10, { align: 'center' });

    doc.save(`Presupuesto_${proposal.proposalNumber}_${sanitize(proposal.clientName || 'cliente')}.pdf`);
  }

  function section(doc, title, y, M, W) {
    doc.setFillColor(...RED);
    doc.rect(M, y - 1, W - M * 2, 7, 'F');
    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(title, M + 3, y + 4);
    return y + 11;
  }

  function table(doc, rows, y, M, W) {
    rows.forEach(([label, value]) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...GRAY);
      doc.text(label, M + 2, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...DARK);
      const lines = doc.splitTextToSize(value, W - M * 2 - 38);
      doc.text(lines, M + 38, y);
      y += Math.max(lines.length * 4.5, 5) + 1;
    });
    return y;
  }

  function checkNewPage(doc, y, threshold) {
    if (y > 270 - threshold) { doc.addPage(); return 15; }
    return y;
  }

  function formatDate(iso) {
    if (!iso) return new Date().toLocaleDateString('es-AR');
    return new Date(iso).toLocaleDateString('es-AR');
  }

  function sanitize(str) {
    return str.replace(/[^a-zA-Z0-9_\-áéíóúüñÁÉÍÓÚÜÑ ]/g, '').replace(/\s+/g, '_').substring(0, 30);
  }

  function printFallback(p) {
    const w = window.open('', '_blank');
    const fmt = Pricing.fmt;
    const fp = p.finalPrice || 0;
    const dp = Math.round(fp * 0.3);
    const breakdown = (p.priceBreakdown || []).map(i =>
      `<tr><td>${i.label}</td><td style="text-align:right">${fmt(i.amount)}</td></tr>`
    ).join('');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Propuesta ${p.proposalNumber}</title>
    <style>
      body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#222}
      h1{background:#8b0000;color:#fff;padding:16px;text-align:center;margin:0}
      h2{background:#c0392b;color:#fff;padding:6px 10px;font-size:11px;margin:16px 0 4px}
      table{width:100%;border-collapse:collapse}
      td{padding:4px 6px;font-size:12px}
      .total{background:#8b0000;color:#fff;font-weight:bold;font-size:14px}
      .footer{background:#8b0000;color:#fff;text-align:center;padding:10px;margin-top:20px;font-size:11px}
      @media print{button{display:none}}
    </style></head><body>
    <h1>MINIFLETE TyM<br><small style="font-size:13px">Propuesta N° ${p.proposalNumber} · ${formatDate(p.createdAt)}</small></h1>
    <button onclick="window.print()" style="margin:10px 0;padding:8px 16px;background:#8b0000;color:#fff;border:none;border-radius:4px;cursor:pointer">Imprimir / Guardar PDF</button>
    <h2>DATOS DEL CLIENTE</h2>
    <table><tr><td><b>Cliente:</b></td><td>${p.clientName||'-'}</td><td><b>Rubro:</b></td><td>${p.clientRubro||'-'}</td></tr>
    <tr><td><b>Contacto:</b></td><td>${p.clientContact||'-'}</td><td><b>Teléfono:</b></td><td>${p.clientPhone||'-'}</td></tr></table>
    <h2>DATOS DEL SERVICIO</h2>
    <table><tr><td><b>Servicio:</b></td><td>${p.serviceType||'-'}</td><td><b>Vehículo:</b></td><td>${Pricing.VEHICLE_LABELS[p.vehicleType]||'-'}</td></tr>
    <tr><td><b>Origen:</b></td><td>${p.originZone||'-'}</td><td><b>Destino:</b></td><td>${p.destZone||'-'}</td></tr></table>
    ${p.inventory ? `<h2>INVENTARIO</h2><p style="font-size:12px;white-space:pre-wrap">${p.inventory}</p>` : ''}
    <h2>DETALLE DE PRECIOS</h2>
    <table>${breakdown}<tr class="total"><td>PRECIO TOTAL</td><td style="text-align:right">${fmt(fp)}</td></tr>
    <tr><td><b>Seña (30%)</b></td><td style="text-align:right">${fmt(dp)}</td></tr>
    <tr><td>Saldo al finalizar</td><td style="text-align:right">${fmt(fp-dp)}</td></tr></table>
    <h2>CONDICIONES</h2>
    <ul style="font-size:11px">${conditions(p.serviceType, p.vehicleType).map(c => `<li>${c}</li>`).join('')}</ul>
    <div class="footer">Tel: 11 6455-4602 · minifletestym@gmail.com · www.minifletetym.com.ar</div>
    </body></html>`);
    w.document.close();
  }

  return { generate, preload };
})();
