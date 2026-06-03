// sheets.js — Google Sheets API via OAuth2 (implicit/redirect flow, sin backend)

const GS = (function () {
  'use strict';

  var CLIENT_ID    = '432666695416-nh5jtjf2bkk430f0cdtfhpthq5qqhgf3.apps.googleusercontent.com';
  var SHEET_ID     = '13NFdfgd9L3P8loIsBFU6Hy9KLeJx5HVET0M3MeLee2k';
  var SHEET_NAME   = 'Trabajos';
  var SCOPE        = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.modify';
  var TOKEN_KEY    = 'mtym_gtoken';
  var STATE_KEY    = 'mtym_oauth_state';
  var REDIRECT_URI = 'https://manovasgit.github.io/miniflete-tym/unidades/';
  var BASE         = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID;

  var _sheetGid = null;

  // ── Token ────────────────────────────────────────────────────────────────
  function _saveToken(accessToken, expiresIn) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      access_token: accessToken,
      expires: Date.now() + (Number(expiresIn || 3600) - 120) * 1000,
    }));
  }

  function _getAccessToken() {
    try {
      var t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.access_token && t.expires > Date.now()) return t.access_token;
    } catch (e) {}
    return null;
  }

  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  function isConnected() { return !!_getAccessToken(); }

  // ── OAuth2 redirect flow ─────────────────────────────────────────────────
  // Redirige la página a Google para autorizar. Al volver, checkRedirectToken()
  // lee el token del hash de la URL.
  function connect() {
    var state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    localStorage.setItem(STATE_KEY, state);

    var params = [
      'client_id='     + encodeURIComponent(CLIENT_ID),
      'redirect_uri='  + encodeURIComponent(REDIRECT_URI),
      'response_type=token',
      'scope='         + encodeURIComponent(SCOPE),
      'state='         + state,
      'include_granted_scopes=true',
    ].join('&');

    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
    return new Promise(function () {}); // la página navega, nunca resuelve
  }

  // Llamar al cargar la página. Devuelve true si había un token en el hash.
  function checkRedirectToken() {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return false;

    var params = {};
    hash.slice(1).split('&').forEach(function (pair) {
      var kv = pair.split('=');
      params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });

    if (!params.access_token) return false;

    // Validar state para prevenir CSRF
    var savedState = localStorage.getItem(STATE_KEY);
    if (savedState && params.state && params.state !== savedState) return false;

    localStorage.removeItem(STATE_KEY);
    // Limpiar el hash de la URL sin recargar
    history.replaceState(null, '', window.location.pathname + window.location.search);

    _saveToken(params.access_token, params.expires_in);
    return true;
  }

  function _ensureToken() {
    var t = _getAccessToken();
    if (t) return Promise.resolve(t);
    // Si no hay token, iniciar el flujo de autorización
    connect();
    return new Promise(function () {}); // nunca resuelve, la página redirige
  }

  // ── Fetch base ───────────────────────────────────────────────────────────
  function _req(method, path, body) {
    return _ensureToken().then(function (token) {
      var opts = {
        method:  method,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type':  'application/json',
        },
      };
      if (body !== undefined) opts.body = JSON.stringify(body);
      return fetch(BASE + path, opts).then(function (r) {
        if (r.status === 401) {
          clearToken();
          var err = new Error('Sesión expirada. Reconectá con Google.');
          err.code = 401;
          throw err;
        }
        if (!r.ok) return r.text().then(function (msg) { throw new Error(msg); });
        return r.json();
      });
    });
  }

  // ── Obtener el sheetId numérico (necesario para eliminar filas) ──────────
  function _getGid() {
    if (_sheetGid !== null) return Promise.resolve(_sheetGid);
    return _ensureToken().then(function (token) {
      return fetch(BASE + '?fields=sheets.properties',
        { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var found = (d.sheets || []).filter(function (sh) {
            return sh.properties.title === SHEET_NAME;
          })[0];
          if (!found) throw new Error('Hoja "' + SHEET_NAME + '" no encontrada en el Sheet');
          _sheetGid = found.properties.sheetId;
          return _sheetGid;
        });
    });
  }

  // ── Mapeo job → fila del sheet ───────────────────────────────────────────
  // A=Fecha  B=Hora  C=Estado  D=Cliente  E=Tel.Retiro  F=Tel.Entrega
  // G=Inventario  H=Retiro  I=Piso R.  J=Barrio R.
  // K=Entrega  L=Piso E.  M=Barrio E.  N=Peones  O=Unidad
  // P=Canal  Q=Forma Pago  R=Viaja  S=P.Camioneta  T=Adicionales
  // U=Costo Peones  V=Total Cobrado  W=Ganancia Neta  X=Aclaraciones
  // Y=ID (uso interno app)  Z=JSON completo
  var _PEON_LBL  = { sin_peones:'Sin peones', ascensor:'Ascensor', no_se:'No sé si entra', escaleras:'Escaleras' };
  var _PAGO_LBL  = { efectivo:'Efectivo', transferencia:'Transferencia' };
  var _VIAJ_LBL  = { si:'Sí', no:'No', movilidad:'Tiene movilidad propia' };

  function _fechaFmt(f) {
    if (!f) return '';
    var p = f.split('-');
    return p.length === 3 ? parseInt(p[2]) + '/' + parseInt(p[1]) + '/' + p[0] : f;
  }

  function jobToRow(job, gastos) {
    var u = (typeof getUnidad === 'function') ? getUnidad(job.unidad) : null;
    return [
      _fechaFmt(job.fecha),                              // A: Fecha
      job.hora             || '',                        // B: Hora
      job.estado           || '',                        // C: Estado
      job.nombre           || '',                        // D: Cliente
      job.telefonoRetiro   || '',                        // E: Tel. Retiro
      job.telefonoEntrega  || '',                        // F: Tel. Entrega
      job.inventario       || '',                        // G: Inventario
      job.calleRetiro      || '',                        // H: Retiro
      job.pisoRetiro       || '',                        // I: Piso R.
      job.barrioRetiro     || '',                        // J: Barrio R.
      job.calleEntrega     || '',                        // K: Entrega
      job.pisoEntrega      || '',                        // L: Piso E.
      job.barrioEntrega    || '',                        // M: Barrio E.
      _PEON_LBL[job.peones] || job.peones || '',         // N: Peones
      u ? u.nombre : (job.unidad || ''),                 // O: Unidad
      job.canal            || 'web',                     // P: Canal
      _PAGO_LBL[job.formaPago] || job.formaPago || '',   // Q: Forma Pago
      _VIAJ_LBL[job.viajaEnUnidad] || job.viajaEnUnidad || '', // R: Viaja
      job.precioCamioneta  || 0,                         // S: P. Camioneta
      job.adicionales      || 0,                         // T: Adicionales
      job.costoPeones      || 0,                         // U: Costo Peones
      job.totalCobrado     || 0,                         // V: Total Cobrado
      job.gananciaNeta     || 0,                         // W: Ganancia Neta
      job.aclaraciones     || '',                        // X: Aclaraciones
      job.id               || '',                        // Y: ID (tracking)
      JSON.stringify(job),                               // Z: JSON completo
    ];
  }

  // Codifica el rango para la URL: solo el nombre de la hoja,
  // los caracteres ! y : de la referencia de celda van literales.
  function _rangeUrl(range) {
    var bang = range.indexOf('!');
    if (bang === -1) return encodeURIComponent(range);
    return encodeURIComponent(range.substring(0, bang)) + range.substring(bang);
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────
  function readAll() {
    return _req('GET', '/values/' + _rangeUrl(SHEET_NAME + '!A:Z'));
  }

  function appendJob(job, gastos) {
    // Para append se usa solo el nombre de la hoja como rango de búsqueda
    return _req('POST',
      '/values/' + encodeURIComponent(SHEET_NAME) +
      ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { values: [jobToRow(job, gastos)] }
    );
  }

  function updateJob(rowNum, job, gastos) {
    var range = SHEET_NAME + '!A' + rowNum + ':Z' + rowNum;
    return _req('PUT',
      '/values/' + _rangeUrl(range) + '?valueInputOption=USER_ENTERED',
      { values: [jobToRow(job, gastos)] }
    );
  }

  function deleteJob(rowNum) {
    return _getGid().then(function (gid) {
      return _req('POST', ':batchUpdate', {
        requests: [{
          deleteDimension: {
            range: {
              sheetId:    gid,
              dimension:  'ROWS',
              startIndex: rowNum - 1,   // 0-based, fila 1 = cabecera
              endIndex:   rowNum,
            },
          },
        }],
      });
    });
  }

  // Busca el número de fila (1-based) de un job por su id.
  // Retorna null si no existe.
  // Sube múltiples filas de una sola vez (para importar backup)
  function batchAppend(rows) {
    return _req('POST',
      '/values/' + encodeURIComponent(SHEET_NAME) +
      ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { values: rows }
    );
  }

  function findRowByJobId(jobId) {
    return readAll().then(function (data) {
      var rows = data.values || [];
      for (var i = 1; i < rows.length; i++) {
        if (rows[i][24] === jobId) return i + 1; // Y col (nuevo formato)
        if (rows[i][0]  === jobId) return i + 1; // A col (formato viejo, fallback)
      }
      return null;
    });
  }

  return {
    isConnected:        isConnected,
    connect:            connect,
    checkRedirectToken: checkRedirectToken,
    clearToken:         clearToken,
    readAll:            readAll,
    appendJob:          appendJob,
    updateJob:          updateJob,
    deleteJob:          deleteJob,
    batchAppend:        batchAppend,
    findRowByJobId:     findRowByJobId,
    jobToRow:           jobToRow,
  };
})();
