// Unidades ↔ Reparto TyM
// Agrega dos cosas, nada más:
//   1. Botón "Asignar a chofer" en el detalle de cada trabajo: lo manda a Reparto como flete,
//      con el ID del trabajo y la misma comanda que se copia desde Unidades (con precios).
//      El trabajo sigue guardado en Unidades igual que siempre.
//   2. Etiqueta de solo lectura con el estado del flete (en la agenda y en el detalle).
// Nunca crea, modifica ni borra trabajos de Unidades: solo lee el trabajo y le pregunta a Reparto.
// Todo está aislado: si Reparto no responde o algo falla acá, Unidades sigue funcionando normal.
(function () {
  'use strict';

  // URL del backend de Reparto TyM (la misma que reparto/js/config.js). No es secreta.
  var API = 'https://script.google.com/macros/s/AKfycbxSI3kAU_zSf5pPXB_FWcoFwTMZ-0FUD4eCUSyRQ-B4JIXFGf2Hb4f6Ty170N8ZOp5sAA/exec';
  // Misma sesión que la app Reparto (comparten el origen manovasgit.github.io)
  var CLAVE_SESION = 'reparto_sesion';

  var ESTADOS = {
    asignado: 'Asignado', en_camino: 'En camino', cargando: 'Cargando', en_viaje: 'En viaje',
    realizado: 'Realizado', no_realizado: 'No realizado', cancelado: 'Cancelado en Reparto',
  };
  var PEONES = { sin_peones: 'Sin peones', ascensor: 'Ascensor', no_se: 'No sé si entra', escaleras: 'Escaleras' };
  var VIAJA = { si: 'Sí', no: 'No', movilidad: 'Tiene movilidad propia' };

  var cache = {};        // job_id → { estado, fletero, hora, ... }
  var cacheTs = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function hora(iso) { var m = /T(\d{2}:\d{2})/.exec(iso || ''); return m ? m[1] : ''; }

  function sesion() {
    try {
      var s = JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null');
      return s && s.token && s.usuario && s.usuario.roles.indexOf('admin') >= 0 ? s : null;
    } catch (e) { return null; }
  }

  function llamar(accion, datos, token) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
    var s = sesion();
    return fetch(API, {
      method: 'POST',
      // text/plain: pedido simple, sin preflight de CORS
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: accion, token: token || (s && s.token), datos: datos || {} }),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      if (!r.ok) throw new Error('Reparto respondió ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j.ok && j.codigo === 'auth' && accion !== 'login') {
        try { localStorage.removeItem(CLAVE_SESION); } catch (e) { /* nada */ }
      }
      return j;
    }).finally(function () { clearTimeout(t); });
  }

  function estilos() {
    if (document.getElementById('rl-estilos')) return;
    var st = document.createElement('style');
    st.id = 'rl-estilos';
    st.textContent =
      '.rl-chip{display:inline-block;font-size:.66rem;font-weight:700;padding:2px 8px;border-radius:20px;margin-top:3px;background:#eef2ff;color:#3730a3;white-space:nowrap}' +
      '.rl-chip.rl-realizado{background:#f0fdf4;color:#166534}.rl-chip.rl-no_realizado,.rl-chip.rl-cancelado{background:#fef2f2;color:#991b1b}' +
      '.rl-estado{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:.9rem;margin-bottom:10px}' +
      '.rl-error{color:#991b1b;font-size:.85rem;margin:6px 0}.rl-ayuda{color:#555;font-size:.8rem;margin:6px 0}' +
      '.rl-fondo{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;display:flex;align-items:flex-end;justify-content:center}' +
      '.rl-caja{background:#fff;width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:18px 16px calc(18px + env(safe-area-inset-bottom,0px))}' +
      '.rl-caja h3{font-size:1.05rem;margin-bottom:10px}.rl-caja label{display:block;font-size:.8rem;font-weight:700;color:#555;margin:10px 0 4px}' +
      '.rl-caja input,.rl-caja select{width:100%;height:46px;border:1px solid #ddd;border-radius:10px;padding:0 12px;font-size:1rem;background:#fff}' +
      '.rl-caja .btn-primary{margin-top:14px}.rl-caja .rl-cancelar{display:block;width:100%;background:none;border:0;padding:12px;color:#555;font-size:.9rem;margin-top:4px}';
    document.head.appendChild(st);
  }

  // Le pregunta a Reparto el estado de los trabajos (con un poco de cache para no repetir)
  function consultar(ids, forzar) {
    if (!sesion() || !ids.length) return Promise.resolve({});
    var faltan = ids.filter(function (id) { return !(id in cache); });
    if (!forzar && !faltan.length && Date.now() - cacheTs < 60000) return Promise.resolve(cache);
    return llamar('unidades.estados', { ids: ids }).then(function (r) {
      if (!r.ok) throw new Error(r.error || 'Error de Reparto');
      ids.forEach(function (id) { cache[id] = r.estados[id] || null; });
      cacheTs = Date.now();
      return cache;
    });
  }

  function textoEstado(e) {
    if (!e) return '';
    return ESTADOS[e.estado] + (e.fletero ? ' · ' + e.fletero : '') + (e.hora ? ' ' + hora(e.hora) : '');
  }

  // ── Agenda: etiqueta en cada tarjeta (en silencio si Reparto no responde) ──
  function agenda(main) {
    if (!sesion()) return;
    estilos();
    var tarjetas = Array.prototype.slice.call(main.querySelectorAll('.job-card[data-jobid]'));
    if (!tarjetas.length) return;
    var ids = tarjetas.map(function (c) { return c.dataset.jobid; });
    consultar(ids).then(function (est) {
      tarjetas.forEach(function (c) {
        var e = est[c.dataset.jobid];
        if (!e || !c.isConnected || c.querySelector('.rl-chip')) return;
        var info = c.querySelector('.job-info');
        if (!info) return;
        var chip = document.createElement('span');
        chip.className = 'rl-chip rl-' + e.estado;
        chip.textContent = '🚚 ' + textoEstado(e);
        info.appendChild(chip);
      });
    }).catch(function () { /* la agenda sigue igual */ });
  }

  // ── Detalle: sección "Chofer" con estado y botón ─────────────────────────
  function detalle(oc, jobId, pagina) {
    if (pagina && pagina !== 'view') return;
    var job = typeof getById === 'function' ? getById(jobId) : null;
    if (!job) return;
    estilos();
    var acciones = oc.querySelector('.det-actions');
    if (!acciones) return;
    var sec = document.createElement('div');
    sec.className = 'det-section';
    sec.id = 'rl-seccion';
    acciones.parentNode.insertBefore(sec, acciones);
    pintar(sec, job, true);
  }

  function pintar(sec, job, forzar) {
    var puedeAsignar = job.estado !== 'cancelado' && job.estado !== 'realizado';
    var html = '<div class="det-section-title">Chofer (Reparto TyM)</div>';
    if (!sesion()) {
      sec.innerHTML = html + (puedeAsignar
        ? '<p class="rl-ayuda">Para mandar este trabajo a un fletero, conectá Unidades con Reparto (una sola vez).</p>' +
          '<button class="btn-outline" data-rl="conectar">Conectar con Reparto</button>'
        : '<p class="rl-ayuda">Sin conexión con Reparto.</p>');
      enlazar(sec, job);
      return;
    }
    sec.innerHTML = html + '<p class="rl-ayuda">Consultando Reparto…</p>';
    consultar([job.id], forzar).then(function (est) {
      var e = est[job.id];
      var h = html;
      if (e) {
        h += '<div class="rl-estado"><span>' + esc(textoEstado(e)) + '</span>' +
          '<span class="rl-chip rl-' + esc(e.estado) + '">' + esc(ESTADOS[e.estado]) + '</span></div>' +
          (e.motivo ? '<p class="rl-error">' + esc(e.motivo) + '</p>' : '');
      } else {
        h += '<p class="rl-ayuda">Todavía no se mandó a ningún fletero.</p>';
      }
      if (puedeAsignar) {
        h += '<button class="btn-outline" data-rl="asignar">' + (e && e.estado !== 'cancelado' ? 'Reasignar a otro fletero' : 'Asignar a chofer') + '</button>';
      } else if (job.estado === 'cancelado' && e && e.estado !== 'cancelado' && e.estado !== 'realizado') {
        h += '<p class="rl-ayuda">Este trabajo está cancelado en Unidades: cancelalo también en el panel de Reparto (pestaña Fletes) para avisarle al fletero.</p>';
      }
      sec.innerHTML = h;
      enlazar(sec, job);
    }).catch(function (err) {
      sec.innerHTML = html + '<p class="rl-error">Reparto no responde (' + esc(err.message || 'sin conexión') + '). Unidades sigue funcionando normal.</p>' +
        '<button class="btn-ghost btn-sm" data-rl="reintentar">Reintentar</button>';
      enlazar(sec, job);
    });
  }

  function enlazar(sec, job) {
    Array.prototype.forEach.call(sec.querySelectorAll('[data-rl]'), function (b) {
      b.addEventListener('click', function () {
        var a = b.dataset.rl;
        if (a === 'conectar') conectar(function () { pintar(sec, job, true); });
        else if (a === 'asignar') asignar(sec, job);
        else if (a === 'reintentar') pintar(sec, job, true);
      });
    });
  }

  // ── Ventanita (login o elegir fletero) ───────────────────────────────────
  function ventana(html) {
    var f = document.createElement('div');
    f.className = 'rl-fondo';
    f.innerHTML = '<div class="rl-caja" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(f);
    f.addEventListener('click', function (e) { if (e.target === f) f.remove(); });
    var c = f.querySelector('.rl-cancelar');
    if (c) c.addEventListener('click', function () { f.remove(); });
    return f;
  }

  function conectar(alListo) {
    var f = ventana('<h3>Conectar con Reparto</h3>' +
      '<p class="rl-ayuda">Entrá con tu usuario de administrador de Reparto. Queda recordado en este dispositivo.</p>' +
      '<label>Nombre</label><input id="rl-nombre" autocomplete="username" autocapitalize="words">' +
      '<label>PIN</label><input id="rl-pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8">' +
      '<p class="rl-error" id="rl-err" hidden></p>' +
      '<button class="btn-primary" id="rl-ok">Entrar</button><button class="rl-cancelar">Cancelar</button>');
    var ok = f.querySelector('#rl-ok'), err = f.querySelector('#rl-err');
    f.querySelector('#rl-nombre').focus();
    ok.addEventListener('click', function () {
      ok.disabled = true;
      err.hidden = true;
      llamar('login', { nombre: f.querySelector('#rl-nombre').value, pin: f.querySelector('#rl-pin').value, app: 'panel', dispositivo: 'Unidades' })
        .then(function (r) {
          if (!r.ok) throw new Error(r.error);
          if (r.usuario.roles.indexOf('admin') < 0) {
            llamar('logout', {}, r.token).catch(function () {});
            throw new Error('Solo el administrador puede asignar fletes desde Unidades.');
          }
          localStorage.setItem(CLAVE_SESION, JSON.stringify({ token: r.token, usuario: r.usuario, desde: Date.now() }));
          f.remove();
          alListo();
        })
        .catch(function (e) {
          err.textContent = e.name === 'AbortError' || /fetch/i.test(e.message) ? 'Reparto no responde. Probá más tarde.' : e.message;
          err.hidden = false;
        })
        .finally(function () { ok.disabled = false; });
    });
  }

  function asignar(sec, job) {
    var f = ventana('<h3>Asignar a chofer</h3><p class="rl-ayuda">Buscando fleteros…</p><button class="rl-cancelar">Cancelar</button>');
    llamar('fleteros', {}).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      if (!r.fleteros.length) throw new Error('No hay fleteros activos en Reparto.');
      var actual = cache[job.id];
      f.querySelector('.rl-caja').innerHTML = '<h3>Asignar a chofer</h3>' +
        '<p class="rl-ayuda">' + esc(job.nombre || 'Trabajo') + ' · ' + esc(job.fecha) + ' ' + esc(job.hora || '') + '</p>' +
        '<label>Fletero</label><select id="rl-fl">' + r.fleteros.map(function (x) {
          return '<option value="' + esc(x.id) + '"' + (actual && actual.fletero === x.nombre ? ' selected' : '') + '>' + esc(x.nombre) + '</option>';
        }).join('') + '</select>' +
        '<p class="rl-ayuda">Se le manda la misma comanda que copiás desde Unidades (con precios).</p>' +
        '<p class="rl-error" id="rl-err" hidden></p>' +
        '<button class="btn-primary" id="rl-ok">Mandar al fletero</button><button class="rl-cancelar">Cancelar</button>';
      f.querySelector('.rl-cancelar').addEventListener('click', function () { f.remove(); });
      var ok = f.querySelector('#rl-ok');
      ok.addEventListener('click', function () {
        ok.disabled = true;
        llamar('unidades.asignar', { job: datosDelTrabajo(job), fletero_id: f.querySelector('#rl-fl').value })
          .then(function (r2) {
            if (!r2.ok) throw new Error(r2.error);
            f.remove();
            delete cache[job.id];
            if (typeof showToast === 'function') showToast('Mandado a ' + r2.flete.fletero + ' ✓');
            pintar(sec, job, true);
          })
          .catch(function (e) {
            var err = f.querySelector('#rl-err');
            err.textContent = e.name === 'AbortError' || /fetch/i.test(e.message) ? 'Reparto no responde. No se mandó.' : e.message;
            err.hidden = false;
            ok.disabled = false;
          });
      });
    }).catch(function (e) {
      f.querySelector('.rl-caja').innerHTML = '<h3>Asignar a chofer</h3><p class="rl-error">' +
        esc(e.name === 'AbortError' || /fetch/i.test(e.message) ? 'Reparto no responde. Unidades sigue funcionando normal.' : e.message) +
        '</p><button class="rl-cancelar">Cerrar</button>';
      f.querySelector('.rl-cancelar').addEventListener('click', function () { f.remove(); });
    });
  }

  // Lo que viaja a Reparto: los datos sueltos (para direcciones y teléfono) y la comanda completa,
  // la misma que se copia desde Unidades (generarComanda de comanda.js), que va como nota del flete
  function datosDelTrabajo(j) {
    function dir(calle, piso) { return [calle, piso].filter(Boolean).join(' '); }
    var comanda = '';
    try { if (typeof generarComanda === 'function') comanda = generarComanda(j); } catch (e) { /* va sin comanda */ }
    return {
      comanda: comanda,
      id: j.id, nombre: j.nombre, fecha: j.fecha, hora: j.hora,
      telefono: j.telefonoRetiro, telefonoEntrega: j.telefonoEntrega,
      dirRetiro: dir(j.calleRetiro, j.pisoRetiro), locRetiro: j.barrioRetiro,
      dirEntrega: dir(j.calleEntrega, j.pisoEntrega), locEntrega: j.barrioEntrega,
      inventario: j.inventario, peones: PEONES[j.peones] || j.peones,
      viaja: VIAJA[j.viajaEnUnidad] || j.viajaEnUnidad, aclaraciones: j.aclaraciones,
      precioCamioneta: Number(j.precioCamioneta) || 0, costoPeones: Number(j.costoPeones) || 0,
      adicionales: Number(j.adicionales) || 0, formaPago: j.formaPago || '',
    };
  }

  // Lo que llama app.js (envuelto en try/catch también del lado de app.js)
  window.RepartoLink = {
    agenda: function (main) { try { agenda(main); } catch (e) { console.warn('RepartoLink', e); } },
    detalle: function (oc, id, pagina) { try { detalle(oc, id, pagina); } catch (e) { console.warn('RepartoLink', e); } },
  };
})();
