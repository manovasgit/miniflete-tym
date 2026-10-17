// nube.js — Unidades sincronizada entre dispositivos (celu y compu ven lo mismo)
//
// Los trabajos se siguen guardando primero en el dispositivo (anda sin señal) y además se
// mandan al backend de Reparto TyM, que los guarda en su planilla. Cada trabajo se identifica
// por su ID y gana la modificación más nueva, así un dispositivo nunca pisa a otro por error.
//
// Cómo funciona:
//   - saveJob / deleteJob / saveGastos anotan el cambio en una cola de pendientes.
//   - Al abrir, al guardar, al volver la señal y cada 2 minutos: se mandan los pendientes y
//     se traen los cambios de los otros dispositivos.
//   - Usa la misma sesión que Reparto (usuario administrador). Si no hay sesión, la app
//     funciona igual que antes, solo en este dispositivo, y muestra un aviso para conectar.
(function () {
  'use strict';

  var API = 'https://script.google.com/macros/s/AKfycbxSI3kAU_zSf5pPXB_FWcoFwTMZ-0FUD4eCUSyRQ-B4JIXFGf2Hb4f6Ty170N8ZOp5sAA/exec';
  var CLAVE_SESION = 'reparto_sesion';
  var K_PEND = 'mtym_nube_pendientes';   // { jobs: {id: ts}, borrados: {id: ts}, gastos: {clave: ts} }
  var K_CURSOR = 'mtym_nube_cursor';      // servidor_ts de la última sincronización
  var K_PRIMERA = 'mtym_nube_inicial';    // ya se marcó todo lo local para subir la primera vez
  var CADA_MS = 2 * 60 * 1000;
  var LOTE = 400;                         // trabajos por pedido

  if (typeof window.__NUBE_API === 'string') API = window.__NUBE_API; // solo para pruebas

  // ── Almacenamiento ───────────────────────────────────────────────────────
  function leer(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } }
  function escribir(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* lleno o bloqueado */ } }
  function pend() {
    var p = leer(K_PEND, null) || {};
    p.jobs = p.jobs || {}; p.borrados = p.borrados || {}; p.gastos = p.gastos || {};
    return p;
  }
  function cantPend(p) { return Object.keys(p.jobs).length + Object.keys(p.borrados).length + Object.keys(p.gastos).length; }

  function sesion() {
    try {
      var s = JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null');
      return s && s.token && s.usuario && s.usuario.roles.indexOf('admin') >= 0 ? s : null;
    } catch (e) { return null; }
  }

  // ── Anotar cambios (envuelve las funciones de storage.js) ────────────────
  var _save = window.saveJob, _del = window.deleteJob, _gas = window.saveGastos;

  window.saveJob = function (job) {
    var g = _save(job);
    var p = pend();
    p.jobs[g.id] = g.actualizadoEn || Date.now();
    delete p.borrados[g.id];
    escribir(K_PEND, p);
    pronto();
    return g;
  };
  window.deleteJob = function (id) {
    _del(id);
    var p = pend();
    delete p.jobs[id];
    p.borrados[id] = Date.now();
    escribir(K_PEND, p);
    pronto();
  };
  window.saveGastos = function (fecha, unidad, monto) {
    _gas(fecha, unidad, monto);
    var p = pend();
    p.gastos[fecha + '__' + unidad] = Date.now();
    escribir(K_PEND, p);
    pronto();
  };

  // La primera vez en este dispositivo, todo lo que ya tiene se marca para subir
  function marcarInicial() {
    if (leer(K_PRIMERA, false)) return;
    _ensureLoaded();
    // Trabajos repetidos con el mismo ID (pasaba con versiones viejas): queda uno solo
    var vistos = {}, antes = _jobs.length;
    _jobs = _jobs.filter(function (j) { if (!j || !j.id || vistos[j.id]) return false; vistos[j.id] = true; return true; });
    if (_jobs.length !== antes) _saveJobsLocal();
    var p = pend();
    _jobs.forEach(function (j) { if (j && j.id && !p.jobs[j.id]) p.jobs[j.id] = j.actualizadoEn || j.creadoEn || 1; });
    Object.keys(_gastos).forEach(function (k) { if (!p.gastos[k]) p.gastos[k] = 1; });
    escribir(K_PEND, p);
    escribir(K_PRIMERA, true);
  }

  // ── Red ──────────────────────────────────────────────────────────────────
  function llamar(accion, datos, token) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 60000);
    var s = sesion();
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: accion, token: token || (s && s.token), datos: datos || {} }),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      if (!r.ok) throw new Error('El servidor respondió ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j.ok && j.codigo === 'auth' && accion !== 'login') {
        try { localStorage.removeItem(CLAVE_SESION); } catch (e) { /* nada */ }
      }
      return j;
    }).finally(function () { clearTimeout(t); });
  }

  // ── Sincronizar ──────────────────────────────────────────────────────────
  var corriendo = null, otraVez = false, timerPronto = null;
  var estado = { tipo: 'local', texto: '' };

  function pronto() {
    clearTimeout(timerPronto);
    timerPronto = setTimeout(function () { sincronizar(); }, 1500);
  }

  function sincronizar() {
    if (!sesion()) { pintar('local'); return Promise.resolve(false); }
    if (!navigator.onLine) { pintar('sinred'); return Promise.resolve(false); }
    if (corriendo) { otraVez = true; return corriendo; }
    marcarInicial();
    pintar('sync');
    corriendo = ronda().then(function (cambio) {
      pintar('ok');
      if (cambio && window.UnidadesUI) window.UnidadesUI.refrescar();
      return true;
    }).catch(function (e) {
      pintar(sesion() ? 'error' : 'local', e && e.message);
      return false;
    }).finally(function () {
      corriendo = null;
      if (otraVez) { otraVez = false; pronto(); }
    });
    return corriendo;
  }

  // Una ronda manda hasta LOTE pendientes y trae los cambios; repite si quedaron más
  function ronda() {
    _ensureLoaded();
    var p = pend();
    var ids = Object.keys(p.jobs).slice(0, LOTE);
    var porId = {};
    _jobs.forEach(function (j) { porId[j.id] = j; });
    var trabajos = ids.map(function (id) { return porId[id]; }).filter(Boolean);
    var borrados = Object.keys(p.borrados).slice(0, LOTE).map(function (id) { return { id: id, ts: p.borrados[id] }; });
    var gastos = Object.keys(p.gastos).slice(0, LOTE).map(function (k) {
      return { clave: k, monto: Number(_gastos[k] || 0), ts: p.gastos[k] };
    });
    // Lo que se manda, con la marca de tiempo de ese momento: si se vuelve a editar mientras
    // viaja el pedido, la marca cambia y queda pendiente para la próxima.
    var enviado = { jobs: {}, borrados: {}, gastos: {} };
    ids.forEach(function (id) { enviado.jobs[id] = p.jobs[id]; });
    borrados.forEach(function (b) { enviado.borrados[b.id] = b.ts; });
    gastos.forEach(function (g) { enviado.gastos[g.clave] = g.ts; });

    return llamar('unidades.sync', {
      desde: leer(K_CURSOR, 0), trabajos: trabajos, borrados: borrados, gastos: gastos,
    }).then(function (r) {
      if (!r.ok) throw new Error(r.error || 'No se pudo sincronizar');
      var q = pend();
      Object.keys(enviado.jobs).forEach(function (id) { if (q.jobs[id] === enviado.jobs[id]) delete q.jobs[id]; });
      Object.keys(enviado.borrados).forEach(function (id) { if (q.borrados[id] === enviado.borrados[id]) delete q.borrados[id]; });
      Object.keys(enviado.gastos).forEach(function (k) { if (q.gastos[k] === enviado.gastos[k]) delete q.gastos[k]; });
      escribir(K_PEND, q);
      var cambio = aplicar(r, q);
      escribir(K_CURSOR, r.cursor);
      ultimaVez = Date.now();
      if (cantPend(q) && (ids.length === LOTE || borrados.length === LOTE || gastos.length === LOTE)) {
        return ronda().then(function (c2) { return cambio || c2; });
      }
      return cambio;
    });
  }

  // Mete en el dispositivo lo que vino del servidor, sin pisar lo que sigue pendiente acá
  function aplicar(r, q) {
    _ensureLoaded();
    var cambio = false;
    var pos = {};
    _jobs.forEach(function (j, i) { pos[j.id] = i; });
    (r.trabajos || []).forEach(function (j) {
      if (!j || !j.id || q.jobs[j.id] || q.borrados[j.id]) return;
      var i = pos[j.id];
      if (i === undefined) { pos[j.id] = _jobs.length; _jobs.push(j); cambio = true; }
      else if (JSON.stringify(_jobs[i]) !== JSON.stringify(j)) { _jobs[i] = j; cambio = true; }
    });
    var borrar = {};
    (r.borrados || []).forEach(function (id) { if (!q.jobs[id] && pos[id] !== undefined) borrar[id] = true; });
    if (Object.keys(borrar).length) {
      _jobs = _jobs.filter(function (j) { return !borrar[j.id]; });
      cambio = true;
    }
    if (cambio) _saveJobsLocal();
    var cambioG = false;
    (r.gastos || []).forEach(function (g) {
      if (q.gastos[g.clave]) return;
      var actual = Number(_gastos[g.clave] || 0), nuevo = Number(g.monto || 0);
      if (actual === nuevo) return;
      if (nuevo > 0) _gastos[g.clave] = nuevo; else delete _gastos[g.clave];
      cambioG = true;
    });
    if (cambioG) _saveGastosLocal();
    return cambio || cambioG;
  }

  // ── Indicador y login ────────────────────────────────────────────────────
  var ultimaVez = 0;
  function estilos() {
    if (document.getElementById('nube-estilos')) return;
    var st = document.createElement('style');
    st.id = 'nube-estilos';
    st.textContent =
      '#nube{position:fixed;right:max(10px,env(safe-area-inset-right,0px));top:calc(8px + env(safe-area-inset-top,0px));z-index:150;' +
      'display:flex;align-items:center;gap:6px;font:600 .72rem/1 system-ui,sans-serif;padding:6px 10px;border-radius:20px;border:0;cursor:pointer;' +
      'background:#f1f5f9;color:#334155;box-shadow:0 1px 3px rgba(0,0,0,.15)}' +
      '#nube .p{width:8px;height:8px;border-radius:50%;background:#94a3b8}' +
      '#nube.ok .p{background:#16a34a}#nube.sync .p{background:#f59e0b}#nube.error .p,#nube.local .p{background:#dc2626}#nube.sinred .p{background:#64748b}' +
      '.nb-fondo{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:300;display:flex;align-items:flex-end;justify-content:center}' +
      '.nb-caja{background:#fff;width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px));font-family:system-ui,sans-serif}' +
      '.nb-caja h3{font-size:1.05rem;margin:0 0 8px}.nb-caja p{font-size:.88rem;color:#475569;margin:6px 0}' +
      '.nb-caja label{display:block;font-size:.8rem;font-weight:700;color:#555;margin:10px 0 4px}' +
      '.nb-caja input{width:100%;height:46px;border:1px solid #ddd;border-radius:10px;padding:0 12px;font-size:1rem;box-sizing:border-box}' +
      '.nb-caja .nb-err{color:#991b1b}.nb-caja .btn-primary{margin-top:14px}' +
      '.nb-caja .nb-sec{display:block;width:100%;background:none;border:0;padding:12px;color:#555;font-size:.9rem;margin-top:4px;cursor:pointer}';
    document.head.appendChild(st);
  }

  var TEXTOS = {
    local: 'Sin conectar', sync: 'Sincronizando…', ok: 'Sincronizado', error: 'Error al sincronizar', sinred: 'Sin señal',
  };
  function pintar(tipo, detalle) {
    estado = { tipo: tipo, texto: detalle || '' };
    var b = document.getElementById('nube');
    if (!b) {
      if (!document.body) return;
      estilos();
      b = document.createElement('button');
      b.id = 'nube'; b.type = 'button';
      b.addEventListener('click', abrirPanel);
      document.body.appendChild(b);
    }
    var n = cantPend(pend());
    b.className = tipo;
    b.innerHTML = '<span class="p"></span>' + TEXTOS[tipo] + (n && tipo !== 'sync' ? ' · ' + n + ' sin subir' : '');
  }

  function ventana(html) {
    estilos();
    var f = document.createElement('div');
    f.className = 'nb-fondo';
    f.innerHTML = '<div class="nb-caja" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(f);
    f.addEventListener('click', function (e) { if (e.target === f) f.remove(); });
    var c = f.querySelector('.nb-cerrar');
    if (c) c.addEventListener('click', function () { f.remove(); });
    return f;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function abrirPanel() {
    if (!sesion()) { conectar(); return; }
    var n = cantPend(pend());
    var hace = ultimaVez ? Math.round((Date.now() - ultimaVez) / 60000) : null;
    var f = ventana('<h3>Sincronización</h3>' +
      '<p>Los trabajos se guardan en la nube de Miniflete y se ven igual en el celu y en la compu.</p>' +
      '<p><b>Estado:</b> ' + esc(TEXTOS[estado.tipo]) + (estado.texto && estado.tipo === 'error' ? ' (' + esc(estado.texto) + ')' : '') + '</p>' +
      '<p><b>Cambios sin subir:</b> ' + n + '</p>' +
      (hace !== null ? '<p><b>Última vez:</b> ' + (hace < 1 ? 'recién' : 'hace ' + hace + ' min') + '</p>' : '') +
      '<p><b>Usuario:</b> ' + esc(sesion().usuario.nombre_mostrar || sesion().usuario.nombre) + '</p>' +
      '<button class="btn-primary" id="nb-ya">Sincronizar ahora</button>' +
      '<button class="nb-sec nb-cerrar">Cerrar</button>');
    f.querySelector('#nb-ya').addEventListener('click', function () {
      f.remove();
      sincronizar().then(function (ok) {
        if (window.UnidadesUI) window.UnidadesUI.toast(ok ? 'Sincronizado ✓' : 'No se pudo sincronizar');
      });
    });
  }

  function conectar() {
    var f = ventana('<h3>Conectar la sincronización</h3>' +
      '<p>Entrá con tu usuario de administrador de Reparto. Queda recordado en este dispositivo y desde ahí los trabajos se ven igual en el celu y en la compu.</p>' +
      '<label for="nb-nombre">Nombre</label><input id="nb-nombre" autocomplete="username" autocapitalize="words">' +
      '<label for="nb-pin">PIN</label><input id="nb-pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8">' +
      '<p class="nb-err" id="nb-err" hidden></p>' +
      '<button class="btn-primary" id="nb-ok">Entrar</button><button class="nb-sec nb-cerrar">Ahora no</button>');
    var ok = f.querySelector('#nb-ok'), err = f.querySelector('#nb-err');
    ok.addEventListener('click', function () {
      ok.disabled = true; err.hidden = true;
      llamar('login', { nombre: f.querySelector('#nb-nombre').value, pin: f.querySelector('#nb-pin').value, app: 'unidades', dispositivo: 'Unidades' })
        .then(function (r) {
          if (!r.ok) throw new Error(r.error);
          if (r.usuario.roles.indexOf('admin') < 0) {
            llamar('logout', {}, r.token).catch(function () {});
            throw new Error('Solo el administrador puede usar la sincronización.');
          }
          localStorage.setItem(CLAVE_SESION, JSON.stringify({ token: r.token, usuario: r.usuario, desde: Date.now() }));
          f.remove();
          if (window.UnidadesUI) window.UnidadesUI.toast('Conectado. Sincronizando…');
          sincronizar();
        })
        .catch(function (e) {
          err.textContent = e.name === 'AbortError' || /fetch/i.test(e.message) ? 'No hay conexión con el servidor. Probá más tarde.' : e.message;
          err.hidden = false;
        })
        .finally(function () { ok.disabled = false; });
    });
  }

  // ── Arranque ─────────────────────────────────────────────────────────────
  function arrancar() {
    pintar(sesion() ? 'sync' : 'local');
    sincronizar();
    setInterval(function () { if (document.visibilityState === 'visible') sincronizar(); }, CADA_MS);
    window.addEventListener('online', function () { sincronizar(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sincronizar(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  window.Nube = { sincronizar: sincronizar, pendientes: function () { return cantPend(pend()); } };
})();
