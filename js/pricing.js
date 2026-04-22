const Pricing = (() => {
  const VEHICLE_PREFIXES = { utilitario: '1', camioneta: '2', camion: '3' };

  const VEHICLE_LABELS = {
    utilitario: 'Utilitario (Fiorino/Berlingo)',
    camioneta: 'Camioneta con furgón',
    camion: 'Camión mudancero'
  };

  const SERVICE_TYPES = [
    'Miniflete', 'Flete', 'Mudanza Residencial', 'Mudanza Comercial',
    'Reparto', 'Logística regular', 'Traslado de mascotas', 'Servicio a expreso'
  ];

  const RUBROS = ['Distribuidora', 'Comercio', 'Industria', 'Veterinaria', 'Oficina', 'Particular', 'Otro'];
  const FREQUENCIES = ['Puntual', 'Diaria', 'Semanal', 'Mensual'];
  const FLOORS = [
    { value: 0, label: 'PB (Planta Baja)' },
    { value: 1, label: 'Piso 1' }, { value: 2, label: 'Piso 2' },
    { value: 3, label: 'Piso 3' }, { value: 4, label: 'Piso 4' },
    { value: 5, label: 'Piso 5' }, { value: 6, label: 'Piso 6' },
    { value: 7, label: 'Piso 7' }, { value: 8, label: 'Piso 8' }
  ];

  const STAIR_BASE = { 0: 0, 1: 30000, 2: 50000, 3: 70000, 4: 80000 };

  function stairSurcharge(floor) {
    if (floor <= 0) return 0;
    if (floor <= 4) return STAIR_BASE[floor];
    return 80000 + (floor - 4) * 20000;
  }

  function fmt(n) {
    return '$' + Math.round(n).toLocaleString('es-AR');
  }

  function calculate(d) {
    const breakdown = [];
    let total = 0;
    const hours = Math.max(2, parseInt(d.hours) || 2);
    const peones = Math.max(2, parseInt(d.peones) || 2);
    const floorOrigin = parseInt(d.floorOrigin) || 0;
    const floorDest = parseInt(d.floorDest) || 0;
    const looseItems = parseInt(d.looseItems) || 0;

    // Vehicle
    if (d.vehicleType === 'utilitario') {
      const cost = d.hasElevator ? 47500 : 37500;
      const label = d.hasElevator
        ? 'Utilitario con ascensor/electrodomésticos'
        : 'Utilitario (Fiorino/Berlingo) – CABA';
      breakdown.push({ label, amount: cost });
      total += cost;
    } else if (d.vehicleType === 'camioneta') {
      const cost = parseFloat(d.camionetaPrice) || 0;
      if (cost > 0) {
        breakdown.push({ label: 'Camioneta con furgón', amount: cost });
        total += cost;
      }
    } else if (d.vehicleType === 'camion') {
      const cost = 75000 * hours;
      breakdown.push({ label: `Camión mudancero – ${hours} hs × ${fmt(75000)}`, amount: cost });
      total += cost;
    }

    // Peones
    if (d.serviceMode === 'peones') {
      const peonTotal = 25000 * hours * peones;
      breakdown.push({ label: `${peones} peones × ${hours} hs × ${fmt(25000)}`, amount: peonTotal });
      total += peonTotal;

      // Stair origin
      const so = stairSurcharge(floorOrigin);
      if (so > 0) {
        const amt = so * peones;
        breakdown.push({
          label: `Recargo escalera origen – Piso ${floorOrigin} × ${peones} peones`,
          amount: amt
        });
        total += amt;
      }

      // Stair dest
      const sd = stairSurcharge(floorDest);
      if (sd > 0) {
        const amt = sd * peones;
        breakdown.push({
          label: `Recargo escalera destino – Piso ${floorDest} × ${peones} peones`,
          amount: amt
        });
        total += amt;
      }

      // Loose items
      if (looseItems > 0) {
        const maxFloor = Math.max(floorOrigin, floorDest, 1);
        const amt = looseItems * 5000 * maxFloor;
        breakdown.push({
          label: `Bultos sueltos – ${looseItems} bultos × piso ${maxFloor} × ${fmt(5000)}`,
          amount: amt
        });
        total += amt;
      }
    }

    return { total, breakdown };
  }

  return { calculate, stairSurcharge, fmt, VEHICLE_PREFIXES, VEHICLE_LABELS, SERVICE_TYPES, RUBROS, FREQUENCIES, FLOORS };
})();
