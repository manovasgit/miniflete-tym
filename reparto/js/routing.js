// Reparto TyM — geocodificación y ruteo
// Todo lo que habla con servicios de mapas está acá. Para pasar a Google Maps más adelante
// se cambian los "proveedores" internos; la interfaz pública (al final) no cambia.
//
//   Routing.geocodificar(direccion, localidad)     → Promise<[{lat,lng,etiqueta,fuente,precision}]>
//   Routing.geocodificarOSM(direccion, localidad)  → idem, solo Nominatim (para "más opciones")
//   Routing.recordarGeo(direccion, localidad, geo) → guarda la coordenada confirmada en cache
//   Routing.matrizTiempos(puntos)                  → Promise<{seg:[][], m:[][], fuente:'osrm'|'recta'}>
//   Routing.optimizar({origen, destino, paradas, inicioMin, servicioMin, fijo, primero})
//                                                  → Promise<{orden:[id], etas:{id:'HH:MM'}, tarde:[id], seg, metros, fuente}>
//   Routing.geometria(puntos)                      → Promise<[[lat,lng],…]>
//   Routing.linkNavegacion(lat, lng, 'google'|'waze') → URL

var Routing = (function () {
  var GEOREF = 'https://apis.datos.gob.ar/georef/api/direcciones';
  var NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  var OSRM = 'https://router.project-osrm.org';

  // Barrios de CABA → comuna (Georef organiza CABA por comunas, no por barrios)
  var COMUNAS = {
    1: ['retiro', 'san nicolas', 'puerto madero', 'san telmo', 'montserrat', 'monserrat', 'constitucion', 'microcentro', 'tribunales'],
    2: ['recoleta', 'barrio norte'],
    3: ['balvanera', 'san cristobal', 'once', 'abasto', 'congreso'],
    4: ['la boca', 'boca', 'barracas', 'parque patricios', 'nueva pompeya', 'pompeya'],
    5: ['almagro', 'boedo'],
    6: ['caballito'],
    7: ['flores', 'parque chacabuco'],
    8: ['villa soldati', 'villa riachuelo', 'villa lugano', 'lugano'],
    9: ['liniers', 'mataderos', 'parque avellaneda'],
    10: ['villa real', 'monte castro', 'versalles', 'floresta', 'velez sarsfield', 'villa luro'],
    11: ['villa general mitre', 'villa devoto', 'devoto', 'villa del parque', 'villa santa rita'],
    12: ['coghlan', 'saavedra', 'villa urquiza', 'urquiza', 'villa pueyrredon'],
    13: ['nunez', 'belgrano', 'colegiales'],
    14: ['palermo'],
    15: ['chacarita', 'villa crespo', 'la paternal', 'paternal', 'villa ortuzar', 'agronomia', 'parque chas'],
  };
  var BARRIOS = (function () {
    var m = {};
    Object.keys(COMUNAS).forEach(function (c) { COMUNAS[c].forEach(function (b) { m[b] = +c; }); });
    return m;
  })();
  var ES_CABA = ['caba', 'capital', 'capital federal', 'ciudad de buenos aires', 'ciudad autonoma de buenos aires'];

  function comunaDe(loc) {
    var n = U.normalizar(loc);
    if (!n) return null;
    if (BARRIOS[n]) return BARRIOS[n];
    // "palermo soho", "belgrano r", etc.
    var mejor = null;
    Object.keys(BARRIOS).forEach(function (b) {
      if (n.indexOf(b) === 0 && (!mejor || b.length > mejor.length)) mejor = b;
    });
    return mejor ? BARRIOS[mejor] : null;
  }

  function enAMBA(lat, lng) {
    var z = CONFIG.AMBA;
    return lng >= z[0] && lng <= z[2] && lat >= z[1] && lat <= z[3];
  }

  // "Cabildo 2040, Belgrano" → dirección y localidad separadas si la localidad vino vacía
  function separar(direccion, localidad) {
    var d = String(direccion || '').trim();
    var l = String(localidad || '').trim();
    if (!l && d.indexOf(',') > 0) {
      var i = d.indexOf(',');
      l = d.slice(i + 1).trim();
      d = d.slice(0, i).trim();
    }
    return { d: d, l: l };
  }

  function claveGeo(direccion, localidad) {
    var s = separar(direccion, localidad);
    return U.normalizar(s.d) + '|' + U.normalizar(s.l);
  }

  // ── Georef (datos.gob.ar) ──────────────────────────────────────────────
  function georef(params) {
    var q = Object.assign({ max: 5, aplanar: 'true' }, params);
    var url = GEOREF + '?' + Object.keys(q).map(function (k) {
      return k + '=' + encodeURIComponent(q[k]);
    }).join('&');
    return U.fetchT(url, {}, 9000)
      .then(function (r) { return r.ok ? r.json() : { direcciones: [] }; })
      .then(function (j) {
        return (j.direcciones || []).filter(function (x) {
          return x.ubicacion_lat != null && (x.provincia_id === '02' || x.provincia_id === '06') &&
            enAMBA(x.ubicacion_lat, x.ubicacion_lon);
        }).map(function (x) {
          var lugar = x.provincia_id === '02'
            ? 'CABA (' + x.departamento_nombre + ')'
            : (x.localidad_censal_nombre && x.localidad_censal_nombre !== x.departamento_nombre
                ? x.localidad_censal_nombre + ', ' + x.departamento_nombre : x.departamento_nombre);
          return {
            lat: x.ubicacion_lat, lng: x.ubicacion_lon,
            etiqueta: titulo(x.calle_nombre) + (x.altura_valor ? ' ' + x.altura_valor : '') + ' — ' + lugar,
            fuente: 'georef',
            precision: x.altura_valor ? 'altura' : 'calle',
            _lugar: U.normalizar(x.departamento_nombre + ' ' + (x.localidad_censal_nombre || '')),
          };
        });
      })
      .catch(function () { return []; });
  }

  function titulo(s) {
    return String(s || '').toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
  }

  // Georef no siempre tiene cargado el "Av." de las avenidas de GBA: se reintenta sin el prefijo
  function sinPrefijo(d) {
    return d.replace(/^\s*(av(da)?\.?|avenida|calle|pje\.?|pasaje)\s+/i, '');
  }
  function georefConReintento(params) {
    return georef(params).then(function (res) {
      var d2 = sinPrefijo(params.direccion);
      if (res.length || d2 === params.direccion) return res;
      return georef(Object.assign({}, params, { direccion: d2 }));
    });
  }

  // Devuelve {zona: resultados filtrados por la localidad tipeada, otras: búsqueda sin filtro}
  function geocodificarGeoref(d, l) {
    var comuna = comunaDe(l);
    var esCaba = !!comuna || ES_CABA.indexOf(U.normalizar(l)) >= 0;
    var zona = [];
    // En CABA calle + altura es única: no se filtra por comuna (las calles límite, como Santa Fe
    // entre Palermo y Recoleta, quedarían afuera). La comuna solo ordena.
    if (esCaba) zona.push(georefConReintento({ direccion: d, provincia: '02' }).then(function (res) {
      if (!comuna) return res;
      var dep = 'comuna ' + comuna;
      return res.slice().sort(function (a, b) { return (b._lugar.indexOf(dep) === 0) - (a._lugar.indexOf(dep) === 0); });
    }));
    else if (l) {
      zona.push(georefConReintento({ direccion: d, provincia: '06', departamento: l }));
      zona.push(georefConReintento({ direccion: d, provincia: '06', localidad: l }));
    }
    var otras = l ? [] : [georefConReintento({ direccion: d, provincia: '02' }), georefConReintento({ direccion: d, provincia: '06' })];
    return Promise.all([Promise.all(zona), Promise.all(otras)]).then(function (x) {
      return { zona: dedup([].concat.apply([], x[0])), otras: dedup([].concat.apply([], x[1])) };
    });
  }

  // Último recurso cuando la localidad no ayudó: sin filtro, avisando que puede ser otra zona
  function georefSinZona(d, l) {
    var nl = U.normalizar(l);
    return Promise.all([georefConReintento({ direccion: d, provincia: '02' }), georefConReintento({ direccion: d, provincia: '06' })])
      .then(function (x) {
        return dedup([].concat(x[0], x[1])).map(function (c) {
          if (nl && c._lugar.indexOf(nl) < 0) { c.etiqueta += ' (otra zona: revisá)'; c.precision = 'calle'; }
          return c;
        });
      });
  }

  // ── Nominatim (OpenStreetMap): máximo 1 consulta por segundo ───────────
  var _colaNom = Promise.resolve();
  var _ultimaNom = 0;

  function geocodificarOSM(direccion, localidad) {
    var s = separar(direccion, localidad);
    return nominatim(s.d, s.l).then(function (res) {
      var d2 = sinPrefijo(s.d);
      return res.length || d2 === s.d ? res : nominatim(d2, s.l);
    });
  }

  function nominatim(dir, loc) {
    var s = { d: dir, l: loc };
    var z = CONFIG.AMBA;
    // Con localidad no se agrega "Buenos Aires": Nominatim lo toma como la Ciudad y se confunde
    var q = s.d + (s.l ? ', ' + s.l : ', Buenos Aires') + ', Argentina';
    var url = NOMINATIM + '?format=jsonv2&addressdetails=1&limit=5&countrycodes=ar&bounded=1' +
      '&accept-language=es&viewbox=' + [z[0], z[3], z[2], z[1]].join(',') + '&q=' + encodeURIComponent(q);

    var tarea = _colaNom.then(function () {
      var espera = Math.max(0, _ultimaNom + 1100 - Date.now());
      return U.esperar(espera);
    }).then(function () {
      _ultimaNom = Date.now();
      return U.fetchT(url, { headers: { 'Accept': 'application/json' } }, 10000);
    }).then(function (r) { return r.ok ? r.json() : []; })
      .then(function (arr) {
        return (arr || []).filter(function (x) { return enAMBA(+x.lat, +x.lon); }).map(function (x) {
          var a = x.address || {};
          var calle = a.road || a.pedestrian || a.footway || x.name || '';
          var lugar = a.suburb || a.city_district || a.town || a.city || a.village || a.state_district || '';
          var partido = a.county || a.state_district || '';
          return {
            lat: +x.lat, lng: +x.lon,
            etiqueta: (calle + (a.house_number ? ' ' + a.house_number : '')).trim() +
              ' — ' + [lugar, partido !== lugar ? partido : ''].filter(Boolean).join(', '),
            fuente: 'nominatim',
            precision: a.house_number ? 'altura' : 'calle',
          };
        });
      })
      .catch(function () { return []; });
    _colaNom = tarea.then(function () {}, function () {});
    return tarea;
  }

  function dedup(lista) {
    var vistos = {};
    return lista.filter(function (x) {
      var k = x.lat.toFixed(4) + ',' + x.lng.toFixed(4);
      if (vistos[k]) return false;
      vistos[k] = true;
      return true;
    });
  }
  function limpiar(lista) {
    return lista.map(function (x) { var c = Object.assign({}, x); delete c._lugar; return c; });
  }

  function geocodificar(direccion, localidad) {
    var s = separar(direccion, localidad);
    if (!s.d) return Promise.resolve([]);
    var clave = claveGeo(direccion, localidad);
    var c = Store.geoCache(clave);
    if (c) return Promise.resolve([{ lat: c.lat, lng: c.lng, etiqueta: c.etiqueta, fuente: c.fuente, precision: 'guardada', cache: true }]);
    function conAltura(l) { return l.some(function (x) { return x.precision === 'altura'; }); }

    return geocodificarGeoref(s.d, s.l).then(function (g) {
      // 1) Georef en la zona tipeada (o sin zona si no se tipeó) con la altura exacta
      var primero = s.l ? g.zona : g.otras;
      if (conAltura(primero)) return limpiar(primero.slice(0, 6));
      // 2) Nominatim
      return geocodificarOSM(s.d, s.l).then(function (osm) {
        if (osm.length) return limpiar(dedup(osm.concat(primero)).slice(0, 6));
        if (primero.length) return limpiar(primero.slice(0, 6));
        // 3) Georef sin filtro de zona, marcado para revisar
        return s.l ? georefSinZona(s.d, s.l).then(function (x) { return limpiar(x.slice(0, 6)); }) : [];
      });
    });
  }

  function recordarGeo(direccion, localidad, geo) {
    Store.guardarGeoCache(claveGeo(direccion, localidad), {
      lat: geo.lat, lng: geo.lng, etiqueta: geo.etiqueta || '', fuente: geo.fuente || 'manual',
    });
  }

  // ── Matriz de tiempos ──────────────────────────────────────────────────
  // Cache de pares ya consultados: reordenar a mano no vuelve a pedir la matriz a OSRM.
  var _pares = {};
  function kp(p) { return p.lat.toFixed(5) + ',' + p.lng.toFixed(5); }

  function haversine(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function recta(a, b) {
    var m = haversine(a, b) * CONFIG.FACTOR_RECTA;
    return { s: m / (CONFIG.KMH_RECTA / 3.6), m: m };
  }

  function matrizTiempos(puntos) {
    var n = puntos.length;
    var seg = [], m = [];
    var completa = true;
    for (var i = 0; i < n; i++) {
      seg.push([]); m.push([]);
      for (var j = 0; j < n; j++) {
        if (i === j) { seg[i].push(0); m[i].push(0); continue; }
        var c = _pares[kp(puntos[i]) + '>' + kp(puntos[j])];
        if (!c) completa = false;
        seg[i].push(c ? c.s : null); m[i].push(c ? c.m : null);
      }
    }
    if (completa) return Promise.resolve({ seg: seg, m: m, fuente: 'osrm' });

    var coords = puntos.map(function (p) { return p.lng.toFixed(6) + ',' + p.lat.toFixed(6); }).join(';');
    return U.fetchT(OSRM + '/table/v1/driving/' + coords + '?annotations=duration,distance', {}, 10000)
      .then(function (r) { if (!r.ok) throw new Error('OSRM ' + r.status); return r.json(); })
      .then(function (j) {
        if (j.code !== 'Ok' || !j.durations) throw new Error('OSRM ' + j.code);
        var fuente = 'osrm';
        for (var i = 0; i < n; i++) for (var k = 0; k < n; k++) {
          var s = j.durations[i][k], d = j.distances ? j.distances[i][k] : null;
          if (s == null) { var r = recta(puntos[i], puntos[k]); s = r.s; d = r.m; fuente = 'mixta'; }
          else s = s * CONFIG.FACTOR_TRAFICO;
          seg[i][k] = s; m[i][k] = d == null ? recta(puntos[i], puntos[k]).m : d;
          if (i !== k) _pares[kp(puntos[i]) + '>' + kp(puntos[k])] = { s: seg[i][k], m: m[i][k] };
        }
        return { seg: seg, m: m, fuente: fuente };
      })
      .catch(function () {
        for (var i = 0; i < n; i++) for (var k = 0; k < n; k++) {
          if (i === k) continue;
          var r = recta(puntos[i], puntos[k]);
          seg[i][k] = r.s; m[i][k] = r.m;
        }
        return { seg: seg, m: m, fuente: 'recta' };
      });
  }

  // ── Optimización ───────────────────────────────────────────────────────
  // Índices: 0 = origen, 1..n = paradas, n+1 = destino (base).
  // Urgentes siempre primero; los "antes de HH:MM" pesan como penalización fuerte si se llega tarde.
  var PENAL_TARDE = 30; // cada segundo tarde cuesta como 30 segundos de manejo

  function optimizar(o) {
    var paradas = o.paradas;
    var n = paradas.length;
    var servicio = (o.servicioMin != null ? o.servicioMin : CONFIG.MIN_POR_PARADA) * 60;
    var inicio = (o.inicioMin != null ? o.inicioMin : U.minutosDelDia()) * 60;
    if (!n) return Promise.resolve({ orden: [], etas: {}, tarde: [], seg: 0, metros: 0, fuente: null });

    var puntos = [o.origen].concat(paradas).concat([o.destino]);
    var DEST = n + 1;
    var limites = [null].concat(paradas.map(function (p) {
      var mm = p.prioridad === 'hora' ? U.hhmmAMin(p.hora_limite) : null;
      return mm == null ? null : mm * 60;
    }));
    // "primero": la parada a la que el chofer ya va en camino; queda fija adelante de todo
    var fija = 0;
    for (var f = 1; f <= n; f++) if (o.primero && paradas[f - 1].id === o.primero) fija = f;
    var urg = [], resto = [];
    for (var i = 1; i <= n; i++) {
      if (i === fija) continue;
      (paradas[i - 1].prioridad === 'urgente' ? urg : resto).push(i);
    }
    var pre = fija ? [fija] : [];
    var nU = urg.length, nP = pre.length;

    return matrizTiempos(puntos).then(function (M) {
      var S = M.seg;

      function evaluar(orden) {
        var t = inicio, pos = 0, tarde = 0;
        for (var k = 0; k < orden.length; k++) {
          var x = orden[k];
          t += S[pos][x];
          if (limites[x] != null && t > limites[x]) tarde += t - limites[x];
          t += servicio;
          pos = x;
        }
        t += S[pos][DEST];
        return (t - inicio) + tarde * PENAL_TARDE;
      }

      function vecino(desde, nodos) {
        var faltan = nodos.slice(), res = [], pos = desde;
        while (faltan.length) {
          var mejor = 0;
          for (var k = 1; k < faltan.length; k++) if (S[pos][faltan[k]] < S[pos][faltan[mejor]]) mejor = k;
          pos = faltan[mejor];
          res.push(pos);
          faltan.splice(mejor, 1);
        }
        return res;
      }

      // 2-opt + reubicación de a un nodo, siempre dentro de cada grupo (urgentes / resto)
      function mejorar(orden) {
        var mejor = orden.slice(), costo = evaluar(mejor), hubo = true, vueltas = 0;
        var grupos = [[nP, nP + nU], [nP + nU, orden.length]];
        while (hubo && vueltas++ < 60) {
          hubo = false;
          grupos.forEach(function (g) {
            for (var i = g[0]; i < g[1] - 1; i++) {
              for (var j = i + 1; j < g[1]; j++) {
                var c = mejor.slice(0, i).concat(mejor.slice(i, j + 1).reverse(), mejor.slice(j + 1));
                var v = evaluar(c);
                if (v < costo - 0.5) { mejor = c; costo = v; hubo = true; }
              }
            }
            for (var a = g[0]; a < g[1]; a++) {
              for (var b = g[0]; b < g[1]; b++) {
                if (a === b) continue;
                var c2 = mejor.slice();
                var x = c2.splice(a, 1)[0];
                c2.splice(b, 0, x);
                var v2 = evaluar(c2);
                if (v2 < costo - 0.5) { mejor = c2; costo = v2; hubo = true; }
              }
            }
          });
        }
        return { orden: mejor, costo: costo };
      }

      var candidatos = [];
      if (o.fijo) {
        // Orden puesto a mano: no se optimiza, solo se calculan horas y avisos
        candidatos.push({ orden: paradas.map(function (_, k) { return k + 1; }), costo: 0 });
      } else {
        var u = vecino(fija, urg);
        var desde = u.length ? u[u.length - 1] : fija;
        candidatos.push(mejorar(pre.concat(u, vecino(desde, resto))));
        // Alternativa: los que tienen horario primero, por hora límite
        var conHora = resto.filter(function (x) { return limites[x] != null; })
          .sort(function (a, b) { return limites[a] - limites[b]; });
        var sinHora = resto.filter(function (x) { return limites[x] == null; });
        var ult = conHora.length ? conHora[conHora.length - 1] : desde;
        candidatos.push(mejorar(pre.concat(u, conHora, vecino(ult, sinHora))));
        candidatos.sort(function (a, b) { return a.costo - b.costo; });
      }
      var orden = candidatos[0].orden;

      // Horas estimadas, avisos y totales del orden elegido
      var t = inicio, pos = 0, metros = 0, etas = {}, tarde = [];
      orden.forEach(function (x) {
        t += S[pos][x]; metros += M.m[pos][x];
        var p = paradas[x - 1];
        etas[p.id] = U.minAHhmm(t / 60);
        if (limites[x] != null && t > limites[x] + 30) tarde.push(p.id);
        t += servicio;
        pos = x;
      });
      t += S[pos][DEST]; metros += M.m[pos][DEST];

      return {
        orden: orden.map(function (x) { return paradas[x - 1].id; }),
        etas: etas, tarde: tarde, seg: t - inicio, metros: metros, fuente: M.fuente,
        regreso: U.minAHhmm(t / 60),
      };
    });
  }

  // ── Geometría del recorrido para dibujar ───────────────────────────────
  function geometria(puntos) {
    var rectas = puntos.map(function (p) { return [p.lat, p.lng]; });
    if (puntos.length < 2) return Promise.resolve(rectas);
    var coords = puntos.map(function (p) { return p.lng.toFixed(6) + ',' + p.lat.toFixed(6); }).join(';');
    return U.fetchT(OSRM + '/route/v1/driving/' + coords + '?overview=full&geometries=geojson', {}, 12000)
      .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function (j) {
        if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error();
        return j.routes[0].geometry.coordinates.map(function (c) {
          return [Math.round(c[1] * 1e5) / 1e5, Math.round(c[0] * 1e5) / 1e5];
        });
      })
      .catch(function () { return rectas; });
  }

  // Sin coordenadas (fletes cargados desde Unidades): se navega por el texto de la dirección
  function linkNavegacionTexto(texto, app) {
    var q = encodeURIComponent(texto + ', Buenos Aires, Argentina');
    if (app === 'waze') return 'https://waze.com/ul?q=' + q + '&navigate=yes';
    return 'https://www.google.com/maps/dir/?api=1&destination=' + q + '&travelmode=driving';
  }

  function linkNavegacion(lat, lng, app) {
    var ll = lat.toFixed(6) + ',' + lng.toFixed(6);
    if (app === 'waze') return 'https://waze.com/ul?ll=' + ll + '&navigate=yes';
    return 'https://www.google.com/maps/dir/?api=1&destination=' + ll + '&travelmode=driving';
  }

  return {
    geocodificar: geocodificar, geocodificarOSM: geocodificarOSM, recordarGeo: recordarGeo,
    matrizTiempos: matrizTiempos, optimizar: optimizar, geometria: geometria,
    linkNavegacion: linkNavegacion, linkNavegacionTexto: linkNavegacionTexto, enAMBA: enAMBA,
    LOCALIDADES: Object.keys(BARRIOS),
  };
})();
