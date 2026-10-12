// Reparto TyM — configuración
// VERSION se muestra en la app. Al cambiar cualquier archivo, subir VERSION y CACHE en sw.js a la par.
var CONFIG = {
  VERSION: '2.1.0',

  // URL del Apps Script publicado como web app (etapa 2). No es secreta: sin token no devuelve datos.
  API_URL: 'https://script.google.com/macros/s/AKfycbxSI3kAU_zSf5pPXB_FWcoFwTMZ-0FUD4eCUSyRQ-B4JIXFGf2Hb4f6Ty170N8ZOp5sAA/exec',

  // Minutos que se calcula que el chofer queda en cada parada (estacionar, entregar, cobrar).
  MIN_POR_PARADA: 5,

  // OSRM calcula a calle libre: en el AMBA se multiplica por este factor de tránsito.
  // Ajustarlo después de unos días de uso comparando la hora estimada con la real.
  FACTOR_TRAFICO: 1.35,

  // Respaldo si OSRM no responde: distancia recta × factor, a esta velocidad promedio.
  FACTOR_RECTA: 1.35,
  KMH_RECTA: 26,

  MAX_PARADAS: 20,

  // Zona aceptada para geocodificar (AMBA ampliado): [oeste, sur, este, norte]
  AMBA: [-59.25, -35.15, -57.85, -34.20],
  CENTRO_MAPA: [-34.61, -58.44],

  TILES: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  TILES_ATRIB: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};
