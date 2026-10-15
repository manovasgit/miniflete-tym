// Reparto TyM — utilidades comunes (fechas en hora de Buenos Aires, IDs, DOM, avisos)

var U = (function () {
  var TZ = 'America/Argentina/Buenos_Aires';

  function partes(d) {
    var f = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(d || new Date());
    var o = {};
    f.forEach(function (p) { o[p.type] = p.value; });
    if (o.hour === '24') o.hour = '00';
    return o;
  }

  // 'YYYY-MM-DD' de hoy en Buenos Aires
  function hoy() {
    var p = partes();
    return p.year + '-' + p.month + '-' + p.day;
  }

  // ISO con offset fijo -03:00 (Argentina no tiene horario de verano)
  function ahoraISO() {
    var p = partes();
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second + '-03:00';
  }

  // 'HH:MM' de un ISO o Date
  function hora(v) {
    if (!v) return '';
    var d = v instanceof Date ? v : new Date(v);
    if (isNaN(d)) return '';
    var p = partes(d);
    return p.hour + ':' + p.minute;
  }

  // Minutos desde la medianoche (BA) de un Date
  function minutosDelDia(d) {
    var p = partes(d || new Date());
    return parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
  }

  function hhmmAMin(s) {
    if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null;
    var a = s.split(':');
    return parseInt(a[0], 10) * 60 + parseInt(a[1], 10);
  }

  function minAHhmm(m) {
    m = Math.round(m) % 1440;
    if (m < 0) m += 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  function duracion(seg) {
    var m = Math.round(seg / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
  }

  function km(metros) {
    return (metros / 1000).toFixed(metros < 10000 ? 1 : 0).replace('.', ',') + ' km';
  }

  // ID único generado en el celular: prefijo + tiempo + azar
  function id(prefijo) {
    var r = '';
    if (window.crypto && crypto.getRandomValues) {
      var a = new Uint32Array(2);
      crypto.getRandomValues(a);
      r = a[0].toString(36) + a[1].toString(36);
    } else {
      r = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return prefijo + '_' + Date.now().toString(36) + '_' + r.slice(0, 8);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Sin tildes, minúsculas, espacios simples: para comparar y como clave de cache
  function normalizar(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function $(sel, raiz) { return (raiz || document).querySelector(sel); }
  function $$(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }

  var _toastT = null;
  function toast(msg, ms) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(_toastT);
    _toastT = setTimeout(function () { el.classList.remove('visible'); }, ms || 2600);
  }

  function vibrar(p) {
    try { if (navigator.vibrate) navigator.vibrate(p || 60); } catch (e) { /* no soportado */ }
  }

  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // fetch con tiempo máximo
  function fetchT(url, opts, ms) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 10000);
    var o = Object.assign({}, opts || {});
    if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o).finally(function () { clearTimeout(t); });
  }

  // Posición GPS actual como promesa
  function gps(ms) {
    return new Promise(function (ok, mal) {
      if (!navigator.geolocation) return mal(new Error('Sin GPS'));
      navigator.geolocation.getCurrentPosition(
        function (p) { ok({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }); },
        function (e) { mal(e); },
        { enableHighAccuracy: true, timeout: ms || 12000, maximumAge: 30000 }
      );
    });
  }

  // Teléfono argentino → 10 dígitos (característica + número, sin 0 ni 15). '' si no se entiende.
  // Acepta "11 6455-4602", "15 6455 4602", "011 15 6455-4602", "+54 9 11 6455 4602".
  function telAR(t) {
    var d = String(t || '').replace(/\D/g, '');
    if (d.indexOf('54') === 0 && d.length >= 12) d = d.slice(2);
    if (d.charAt(0) === '9' && d.length === 11) d = d.slice(1);
    if (d.charAt(0) === '0') d = d.slice(1);
    if (d.length === 12) {
      // "15" después de la característica (2 a 4 dígitos)
      for (var i = 2; i <= 4; i++) if (d.substr(i, 2) === '15') { d = d.slice(0, i) + d.slice(i + 2); break; }
    }
    if (d.length === 10 && d.indexOf('15') === 0) d = '11' + d.slice(2);  // "15 xxxx-xxxx" sin característica: CABA
    if (d.length === 8) d = '11' + d;                                         // número suelto: CABA
    return d.length === 10 ? d : '';
  }
  function linkTel(t) {
    var d = telAR(t);
    return 'tel:' + (d ? '+54' + d : String(t || '').replace(/[^\d+]/g, ''));
  }
  function linkWhatsApp(t, msg) {
    var d = telAR(t);
    return d ? 'https://wa.me/549' + d + (msg ? '?text=' + encodeURIComponent(msg) : '') : '';
  }

  return {
    hoy: hoy, ahoraISO: ahoraISO, hora: hora, minutosDelDia: minutosDelDia,
    hhmmAMin: hhmmAMin, minAHhmm: minAHhmm, duracion: duracion, km: km,
    id: id, esc: esc, normalizar: normalizar, $: $, $$: $$, toast: toast,
    vibrar: vibrar, esperar: esperar, fetchT: fetchT, gps: gps,
    telAR: telAR, linkTel: linkTel, linkWhatsApp: linkWhatsApp,
  };
})();
