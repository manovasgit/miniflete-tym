const PEONES_TXT = {
  sin_peones: 'Sin peones',
  ascensor:   'Ascensor',
  no_se:      'No sé si entra',
  escaleras:  'Escaleras',
};

const PAGO_TXT = {
  efectivo:      'Efectivo',
  transferencia: 'Transferencia',
};

const VIAJA_TXT = {
  si:       'Sí',
  no:       'No',
  movilidad:'Tiene movilidad propia',
};

function generarComanda(job) {
  const lines = [];

  lines.push(`*${job.hora || ''}*`);
  lines.push(`*${job.nombre || ''}*`);
  lines.push('');                                                          // renglón entre nombre y traslado
  if (job.inventario) lines.push(job.inventario);
  lines.push(`*Peones* ${PEONES_TXT[job.peones] || job.peones || ''}`);
  lines.push('');                                                          // renglón entre peones y dir retiro

  lines.push(`*Dir retiro:*`);
  const dirR = [job.calleRetiro, job.pisoRetiro].filter(Boolean).join(' ');
  if (dirR) lines.push(dirR);
  if (job.barrioRetiro)   lines.push(job.barrioRetiro);
  if (job.telefonoRetiro) lines.push(job.telefonoRetiro);
  lines.push('');                                                          // renglón entre tel retiro y dir entrega

  lines.push(`*Dir entrega:*`);
  const dirE = [job.calleEntrega, job.pisoEntrega].filter(Boolean).join(' ');
  if (dirE) lines.push(dirE);
  if (job.barrioEntrega)   lines.push(job.barrioEntrega);
  if (job.telefonoEntrega) lines.push(job.telefonoEntrega);
  lines.push('');                                                          // renglón entre tel entrega y pago

  lines.push(`*Pago* ${PAGO_TXT[job.formaPago] || job.formaPago || ''}`);
  lines.push(`*Viaja* ${VIAJA_TXT[job.viajaEnUnidad] || job.viajaEnUnidad || ''}`);
  lines.push('');                                                          // renglón entre viaja e info adicional

  if (job.aclaraciones && job.aclaraciones.trim()) {
    lines.push(job.aclaraciones.trim());
    lines.push('');                                                        // renglón entre info adicional y precios
  }

  // Precios al final
  function fmtP(n) { return '$' + Math.round(n || 0).toLocaleString('es-AR'); }
  if (job.precioCamioneta) lines.push(`*Precio camioneta:* ${fmtP(job.precioCamioneta)}`);
  if (job.costoPeones)     lines.push(`*Peones:* ${fmtP(job.costoPeones)}`);
  if (job.adicionales)     lines.push(`*Adicionales:* ${fmtP(job.adicionales)}`);

  return lines.join('\n');
}
