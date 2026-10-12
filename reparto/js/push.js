// Reparto TyM — notificaciones push (Firebase Cloud Messaging)
// Solo se activan si CONFIG.FIREBASE está cargado. La configuración web de Firebase es pública
// (identifica el proyecto, no da acceso a nada); la clave privada vive solo en el Apps Script.
//
//   Push.disponible()  → el navegador lo soporta y Firebase está configurado
//   Push.aviso()       → HTML del cartel "Activá las notificaciones" (vacío si no corresponde)
//   Push.activar()     → pide permiso (necesita un toque del usuario) y registra el celular
//   Push.renovar()     → al abrir la app, si ya había permiso, vuelve a registrar (el token puede cambiar)

var Push = (function () {
  var SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  var cargado = null;

  function disponible() {
    return !!(CONFIG.FIREBASE && CONFIG.FIREBASE.apiKey && 'serviceWorker' in navigator &&
      'PushManager' in window && 'Notification' in window);
  }

  function cargarScript(src) {
    return new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = function () { mal(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }

  function sdk() {
    if (!cargado) {
      cargado = cargarScript(SDK + 'firebase-app-compat.js')
        .then(function () { return cargarScript(SDK + 'firebase-messaging-compat.js'); })
        .then(function () {
          if (!firebase.apps.length) firebase.initializeApp(CONFIG.FIREBASE);
          return firebase.messaging();
        });
      cargado.catch(function () { cargado = null; });
    }
    return cargado;
  }

  function registrar() {
    return Promise.all([sdk(), navigator.serviceWorker.ready]).then(function (x) {
      return x[0].getToken({ vapidKey: CONFIG.FIREBASE.vapidKey, serviceWorkerRegistration: x[1] });
    }).then(function (token) {
      if (!token) throw new Error('Sin token');
      if (Store.leer('push_token', '') === token && Store.leer('push_registrado', 0) > Date.now() - 7 * 86400000) return token;
      return Api.llamar('push.registrar', { token: token, agente: navigator.userAgent.slice(0, 120) }).then(function (r) {
        if (!r.ok) throw new Error(r.error);
        Store.escribir('push_token', token);
        Store.escribir('push_registrado', Date.now());
        return token;
      });
    });
  }

  function activar() {
    if (!disponible()) return Promise.reject(new Error('Este celular no admite notificaciones'));
    return Notification.requestPermission().then(function (p) {
      if (p !== 'granted') throw new Error(p === 'denied'
        ? 'Las notificaciones están bloqueadas. Activalas en los ajustes del celular para Reparto.'
        : 'No se activaron las notificaciones.');
      return registrar();
    });
  }

  function renovar() {
    if (disponible() && Notification.permission === 'granted') registrar().catch(function () {});
  }

  function aviso() {
    if (!disponible() || Notification.permission === 'granted') return '';
    if (Notification.permission === 'denied') {
      return '<div class="banner">🔕 Las notificaciones están bloqueadas: no te vas a enterar de los fletes nuevos con la app cerrada. ' +
        'Activalas en Ajustes del celular → Apps → Reparto → Notificaciones.</div>';
    }
    return '<div class="banner banner-push">🔔 Activá las notificaciones para enterarte de los fletes nuevos aunque tengas la app cerrada.' +
      '<button class="btn btn-pri btn-chico" id="btn-push">Activar notificaciones</button></div>';
  }

  // El botón del cartel se conecta solo, esté donde esté
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#btn-push');
    if (!b) return;
    b.disabled = true;
    b.textContent = 'Activando…';
    activar().then(function () {
      U.toast('🔔 Notificaciones activadas');
      var ban = b.closest('.banner');
      if (ban) ban.remove();
    }).catch(function (err) {
      U.toast(err.message, 5000);
      b.disabled = false;
      b.textContent = 'Activar notificaciones';
    });
  });

  return { disponible: disponible, aviso: aviso, activar: activar, renovar: renovar };
})();
