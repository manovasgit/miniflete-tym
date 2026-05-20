// sheets.js — Google Sheets API via OAuth2 (implicit/redirect flow, sin backend)

const GS = (function () {
  'use strict';

  var CLIENT_ID    = '432666695416-nh5jtjf2bkk430f0cdtfhpthq5qqhgf3.apps.googleusercontent.com';
  var SHEET_ID     = '1mubnuNuOmRYcnZSv-D3--qovJJ2eh74K6ITVYxFS_Jw';
  var SHEET_NAME   = 'Hoja 1';
  var SCOPE        = 'https://www.googleapis.com/auth/spreadsheets';
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
  // Columnas: A-ID B-Fecha C-Unidad D-Cliente E-Origen F-Destino
  //           G-PrecioCamioneta H-Peones I-Escalera J-Gastos
  //           K-Estado L-Comanda M-Ganancia N-Timestamp O-JSON
  function jobToRow(job, gastos) {
    var u       = (typeof getUnidad === 'function') ? getUnidad(job.unidad) : null;
    var origen  = [job.barrioRetiro,  job.calleRetiro ].filter(Boolean).join(' - ');
    var destino = [job.barrioEntrega, job.calleEntrega].filter(Boolean).join(' - ');
    return [
      job.id               || '',
      job.fecha            || '',
      u ? u.nombre         : (job.unidad || ''),
      job.nombre           || '',
      origen,
      destino,
      job.precioCamioneta  || 0,
      job.peones           || '',
      job.adicionales      || 0,
      gastos               !== undefined ? gastos : 0,
      job.estado           || '',
      '',                          // L: Comanda (no se guarda)
      job.gananciaNeta     || 0,
      job.actualizadoEn    || Date.now(),
      JSON.stringify(job),         // O: JSON completo para reconstrucción fiel
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
    return _req('GET', '/values/' + _rangeUrl(SHEET_NAME + '!A:O'));
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
    var range = SHEET_NAME + '!A' + rowNum + ':O' + rowNum;
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
      for (var i = 1; i < rows.length; i++) {   // i=0 es la cabecera
        if (rows[i][0] === jobId) return i + 1; // 1-based
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
