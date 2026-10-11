// Reparto TyM — login con nombre + PIN (compartido por la app y el panel)
//
//   Sesion.exigir('chofer'|'panel') → Promise<usuario>: muestra el login si hace falta
//   Sesion.usuario()                → usuario actual o null
//   Sesion.tiene(rol)
//   Sesion.refrescar()              → vuelve a pedir el usuario (por si el admin cambió la base)
//   Sesion.salir()

var Sesion = (function () {
  var $ = U.$, esc = U.esc;
  var resolver = null;
  var app = 'chofer';

  function actual() { return Store.leer('sesion', null); }
  function usuario() { var s = actual(); return s ? s.usuario : null; }
  function tiene(rol) { var u = usuario(); return !!u && u.roles.indexOf(rol) >= 0; }

  function exigir(cual) {
    app = cual || 'chofer';
    return new Promise(function (ok) {
      resolver = ok;
      if (actual()) { ok(usuario()); return; }
      mostrarLogin();
    });
  }

  function mostrarLogin(aviso) {
    var el = $('#login');
    if (!el) {
      el = document.createElement('section');
      el.id = 'login';
      el.className = 'login';
      document.body.appendChild(el);
    }
    var ultimo = Store.leer('ultimo_nombre', '');
    el.innerHTML =
      '<div class="login-caja">' +
      '<img src="icons/icon-192.png" alt="" class="login-logo">' +
      '<h1>' + (app === 'panel' ? 'Panel Reparto TyM' : 'Reparto TyM') + '</h1>' +
      (aviso ? '<p class="banner">' + esc(aviso) + '</p>' : '') +
      '<form id="f-login" autocomplete="off">' +
      '<label class="campo"><span>Nombre</span><input id="l-nombre" autocapitalize="words" autocomplete="username" value="' + esc(ultimo) + '" required></label>' +
      '<label class="campo"><span>PIN</span><input id="l-pin" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="current-password" maxlength="8" required></label>' +
      '<p id="l-error" class="txt-mal" hidden></p>' +
      '<button class="btn btn-pri btn-grande" type="submit" id="l-btn">Entrar</button>' +
      '</form>' +
      '<p class="ayuda centro">¿No tenés usuario o te olvidaste el PIN? Pedíselo al administrador.</p>' +
      '</div>';
    el.hidden = false;
    setTimeout(function () { (ultimo ? $('#l-pin') : $('#l-nombre')).focus(); }, 100);

    $('#f-login').addEventListener('submit', function (e) {
      e.preventDefault();
      var nombre = $('#l-nombre').value.trim();
      var pin = $('#l-pin').value.trim();
      var err = $('#l-error');
      err.hidden = true;
      $('#l-btn').disabled = true;
      $('#l-btn').textContent = 'Entrando…';
      Api.llamar('login', { nombre: nombre, pin: pin, app: app, dispositivo: navigator.userAgent.slice(0, 120) })
        .then(function (r) {
          if (!r.ok) throw new Error(r.error);
          Store.escribir('sesion', { token: r.token, usuario: r.usuario, desde: Date.now() });
          Store.escribir('ultimo_nombre', nombre);
          el.hidden = true;
          el.innerHTML = '';
          if (resolver) { var f = resolver; resolver = null; f(r.usuario); }
        })
        .catch(function (e2) {
          err.textContent = e2 && e2.message && e2.message.indexOf('fetch') < 0 && e2.name !== 'AbortError'
            ? e2.message : 'Sin conexión. Probá de nuevo cuando tengas señal.';
          err.hidden = false;
          $('#l-pin').value = '';
          $('#l-pin').focus();
        })
        .finally(function () {
          var b = $('#l-btn');
          if (b) { b.disabled = false; b.textContent = 'Entrar'; }
        });
    });
  }

  // Si el servidor dice que la sesión no vale más (PIN cambiado, usuario desactivado)
  window.addEventListener('reparto:sin-sesion', function (e) {
    if (resolver) return;
    resolver = function () { location.reload(); };
    mostrarLogin(e.detail || 'Volvé a entrar.');
  });

  function refrescar() {
    if (!actual()) return Promise.resolve(null);
    return Api.llamar('yo', {}).then(function (r) {
      if (!r.ok) return null;
      var s = actual();
      if (!s) return null;
      s.usuario = r.usuario;
      Store.escribir('sesion', s);
      return r.usuario;
    }).catch(function () { return null; });
  }

  function salir() {
    var p = actual() ? Api.llamar('logout', {}, 8000).catch(function () {}) : Promise.resolve();
    return p.then(function () {
      Store.borrar('sesion');
      location.reload();
    });
  }

  return { exigir: exigir, usuario: usuario, tiene: tiene, refrescar: refrescar, salir: salir };
})();
