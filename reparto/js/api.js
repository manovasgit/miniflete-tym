// Reparto TyM — comunicación con el Apps Script y cola de envío sin conexión
//
//   Api.activa()                    → hay backend configurado
//   Api.llamar(accion, datos)       → Promise<respuesta JSON>. Rechaza solo si no hubo red.
//   Api.iniciarCola()               → escucha los cambios de Store y los manda al servidor
//   Api.alEstado(fn)                → fn({pendientes, estado: 'ok'|'enviando'|'sin_senal'|'error', error})
//
// POST con Content-Type text/plain: es un "pedido simple" y el navegador no hace el preflight
// de CORS, que Apps Script no sabe contestar.

var Api = (function () {
  var cola = null;           // { 'reparto:id': registro, 'parada:id': registro }
  var enviando = false;
  var espera = 0;
  var timer = null;
  var estado = { pendientes: 0, estado: 'ok', error: '' };
  var oyentes = [];

  function activa() { return !!CONFIG.API_URL; }

  function token() {
    var s = Store.leer('sesion', null);
    return s ? s.token : null;
  }

  function llamar(accion, datos, ms) {
    return U.fetchT(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion: accion, token: token(), datos: datos || {} }),
      redirect: 'follow',
    }, ms || 25000)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!j.ok && j.codigo === 'auth' && accion !== 'login') {
          Store.borrar('sesion');
          window.dispatchEvent(new CustomEvent('reparto:sin-sesion', { detail: j.error }));
        }
        return j;
      });
  }

  // ── Cola ───────────────────────────────────────────────────────────────
  function cargar() {
    if (!cola) cola = Store.leer('cola', {});
    return cola;
  }
  function guardar() { Store.escribir('cola', cola); }

  // Solo los campos que van al Sheet (lo demás es estado local de la pantalla)
  var SOLO_LOCAL = ['paradas', 'geometria', 'regreso', 'ruta_vieja'];
  function limpio(reg) {
    var o = {};
    Object.keys(reg).forEach(function (k) { if (SOLO_LOCAL.indexOf(k) < 0) o[k] = reg[k]; });
    return o;
  }

  function encolar(tipo, reg) {
    if (!activa() || !token()) return;
    // Mientras el chofer carga paradas no se manda nada: el reparto viaja al armar el recorrido
    if (tipo === 'reparto' && !reg.hora_armado && !reg.eliminado) return;
    if (tipo === 'parada') {
      var r = Store.reparto();
      if (!r || r.id !== reg.reparto_id || !r.hora_armado) return;
    }
    cargar()[tipo + ':' + reg.id] = limpio(reg);
    guardar();
    avisar();
    programar(800);
  }

  function pendientes() { return Object.keys(cargar()).length; }

  function programar(ms) {
    clearTimeout(timer);
    timer = setTimeout(enviar, ms);
  }

  function enviar() {
    if (enviando || !activa() || !token()) return Promise.resolve();
    var c = cargar();
    var claves = Object.keys(c);
    if (!claves.length) { espera = 0; fijar('ok'); return Promise.resolve(); }
    if (navigator.onLine === false) { fijar('sin_senal'); return Promise.resolve(); }

    // Copia de lo que se manda: si mientras viaja algo cambia, eso queda para la próxima
    var enviado = {};
    var lote = { repartos: [], paradas: [] };
    claves.slice(0, 300).forEach(function (k) {
      enviado[k] = c[k].actualizado_ts;
      (k.indexOf('reparto:') === 0 ? lote.repartos : lote.paradas).push(c[k]);
    });

    enviando = true;
    fijar('enviando');
    return llamar('sync', lote)
      .then(function (res) {
        if (!res.ok) {
          fijar(res.codigo === 'auth' ? 'error' : 'error', res.error);
          if (res.codigo !== 'auth') reintentar();
          return;
        }
        var listos = res.aplicados.concat(res.ignorados, res.rechazados.map(function (x) { return x.id; }));
        listos.forEach(function (id) {
          ['reparto:', 'parada:'].forEach(function (p) {
            var k = p + id;
            if (c[k] && enviado[k] === c[k].actualizado_ts) delete c[k];
          });
        });
        guardar();
        espera = 0;
        if (res.rechazados.length) {
          console.warn('Rechazados por el servidor', res.rechazados);
          fijar('error', res.rechazados.length + ' cambio(s) rechazados: ' + res.rechazados[0].error);
        } else fijar(Object.keys(c).length ? 'enviando' : 'ok');
        if (Object.keys(c).length) programar(300);
      })
      .catch(function () {
        fijar('sin_senal');
        reintentar();
      })
      .finally(function () { enviando = false; });
  }

  function reintentar() {
    espera = Math.min(60000, Math.max(5000, espera * 2));
    programar(espera);
  }

  function fijar(e, err) {
    estado.estado = e;
    estado.error = err || '';
    avisar();
  }

  function avisar() {
    estado.pendientes = pendientes();
    oyentes.forEach(function (fn) { try { fn(estado); } catch (e) { console.error(e); } });
  }

  function alEstado(fn) { oyentes.push(fn); fn(estado); }

  var iniciada = false;
  function iniciarCola() {
    if (iniciada || !activa()) return;
    iniciada = true;
    Store.alCambiar(encolar);
    window.addEventListener('online', function () { espera = 0; programar(200); });
    window.addEventListener('offline', function () { fijar('sin_senal'); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) programar(300); });
    setInterval(function () { if (pendientes() && !enviando) enviar(); }, 30000);
    avisar();
    programar(500);
  }

  return {
    activa: activa, llamar: llamar, iniciarCola: iniciarCola, enviar: enviar,
    pendientes: pendientes, alEstado: alEstado,
  };
})();
