// Reparto TyM — instalar la app en el celular.
// Android/Chrome: botón "Instalar" que abre el cartel del sistema (beforeinstallprompt).
// iPhone: Apple no deja instalar con un botón, así que se muestran los pasos (Compartir → Agregar a inicio).
// Si ya está instalada (abierta como app), no aparece nada.

var Instalar = (function () {
  var aviso = null;            // evento beforeinstallprompt guardado para usarlo al tocar "Instalar"
  var CLAVE = 'reparto_instalar_despues';
  var DIAS = 3;                // "Ahora no" lo esconde por estos días

  var ua = navigator.userAgent || '';
  var esIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var esAndroid = /Android/i.test(ua);

  function instalada() {
    return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }

  function pospuesto() {
    try { return Date.now() < +(localStorage.getItem(CLAVE) || 0); } catch (e) { return false; }
  }

  // Se puede ofrecer instalar: celular, sin instalar todavía
  function disponible() { return !instalada() && (!!aviso || esIOS || esAndroid); }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    aviso = e;
    mostrarCartel();
  });

  window.addEventListener('appinstalled', function () {
    aviso = null;
    quitarCartel();
    if (window.U) U.toast('¡Listo! Ya tenés Reparto TyM en el celular', 4000);
  });

  document.addEventListener('DOMContentLoaded', function () {
    // iPhone nunca dispara beforeinstallprompt. En Android, si a los segundos no llegó,
    // es otro navegador o el de WhatsApp: se ofrecen los pasos a mano.
    if (esIOS) setTimeout(mostrarCartel, 1500);
    else if (esAndroid) setTimeout(function () { if (!aviso) mostrarCartel(); }, 4000);
  });

  function mostrarCartel() {
    if (instalada() || pospuesto() || document.getElementById('cartel-instalar')) return;
    var c = document.createElement('div');
    c.id = 'cartel-instalar';
    c.className = 'cartel-instalar';
    c.innerHTML = '<img src="icons/icon-192.png" alt="">' +
      '<div class="ci-txt"><strong>Instalá Reparto TyM</strong><span>Queda el ícono en el celular, como una app</span></div>' +
      '<button class="btn btn-pri" id="ci-si">' + (aviso ? 'Instalar' : 'Cómo') + '</button>' +
      '<button class="ci-x" id="ci-no" aria-label="Ahora no">✕</button>';
    document.body.appendChild(c);
    document.body.classList.add('con-cartel');
    document.getElementById('ci-si').addEventListener('click', instalar);
    document.getElementById('ci-no').addEventListener('click', function () {
      try { localStorage.setItem(CLAVE, String(Date.now() + DIAS * 86400000)); } catch (e) { /* nada */ }
      quitarCartel();
    });
  }

  function quitarCartel() {
    var c = document.getElementById('cartel-instalar');
    if (c) c.parentNode.removeChild(c);
    document.body.classList.remove('con-cartel');
  }

  function instalar() {
    if (aviso) {
      var a = aviso;
      aviso = null;
      // Si Chrome no deja abrir su cartel, se muestran los pasos a mano
      return Promise.resolve().then(function () { return a.prompt(); }).then(function () {
        return a.userChoice;
      }).then(function (r) {
        if (r && r.outcome === 'accepted') quitarCartel();
      }).catch(pasos);
    }
    pasos();
  }

  var ICONO_COMPARTIR = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#0a7aff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Compartir"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2"/></svg>';

  function pasos() {
    quitarCartel();   // si no, tapa el botón de la hoja
    var html;
    if (esIOS) {
      var noSafari = /CriOS|FxiOS|EdgiOS|FBAN|FBAV|Instagram|WhatsApp/.test(ua);
      html = '<h2>Instalar en iPhone</h2>' +
        (noSafari ? '<p class="aviso-chico">Si no te aparecen estas opciones, copiá el link y abrilo en <b>Safari</b>.</p>' : '') +
        '<ol class="pasos-instalar">' +
        '<li>Tocá el botón <b>Compartir</b> ' + ICONO_COMPARTIR + ' (abajo en el medio, o arriba a la derecha).</li>' +
        '<li>Bajá y tocá <b>Agregar a inicio</b> (o "Agregar a pantalla de inicio").</li>' +
        '<li>Tocá <b>Agregar</b>. Listo: abrila siempre desde el ícono rojo.</li>' +
        '</ol>' +
        '<p class="ayuda">En iPhone las notificaciones solo llegan si la app está instalada así.</p>';
    } else {
      html = '<h2>Instalar en Android</h2>' +
        '<ol class="pasos-instalar">' +
        '<li>Si lo abriste desde WhatsApp: tocá <b>⋮</b> arriba a la derecha y elegí <b>Abrir en Chrome</b>.</li>' +
        '<li>En Chrome, tocá <b>⋮</b> arriba a la derecha.</li>' +
        '<li>Tocá <b>Instalar app</b> (o "Agregar a la pantalla principal") y confirmá.</li>' +
        '</ol>' +
        '<p class="ayuda">Si Chrome dice que ya está instalada pero no ves el ícono, buscala en la lista de apps del celular.</p>';
    }
    Hoja.abrir(html + '<button class="btn btn-pri btn-grande" data-cerrar>Entendido</button>', false, true);
  }

  return { disponible: disponible, instalar: instalar, instalada: instalada };
})();
