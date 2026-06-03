// gmail.js — Gmail API via el mismo token OAuth de GS

const GMAIL = (function () {
  'use strict';

  var BASE     = 'https://gmail.googleapis.com/gmail/v1/users/me';
  var TOKEN_KEY = 'mtym_gtoken';

  // ── Token (compartido con sheets.js) ────────────────────────────────────
  function _getToken() {
    try {
      var t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.access_token && t.expires > Date.now()) return t.access_token;
    } catch (e) {}
    return null;
  }

  function isConnected() { return !!_getToken(); }

  // ── HTTP ─────────────────────────────────────────────────────────────────
  function _req(method, path, body) {
    var token = _getToken();
    if (!token) return Promise.reject(new Error('Sin sesión Google'));
    var opts = {
      method: method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(BASE + path, opts).then(function (r) {
      if (r.status === 403) throw new Error('SCOPE: reconectá con Google para habilitar Gmail');
      if (!r.ok) return r.text().then(function (m) { throw new Error(m); });
      return r.json();
    });
  }

  // ── Decodificar base64url → texto ─────────────────────────────────────
  function _b64(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    var pad = b64.length % 4;
    if (pad) b64 += '===='.slice(pad);
    try { return decodeURIComponent(escape(atob(b64))); } catch (e) { return atob(b64); }
  }

  // ── HTML → texto plano ────────────────────────────────────────────────
  function _strip(html) {
    var s = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/<[^>]+>/g, '');
    // decodificar entidades restantes
    var tmp = document.createElement('textarea');
    tmp.innerHTML = s;
    return tmp.value.replace(/\r\n?/g, '\n').trim();
  }

  // ── Extraer texto del payload de Gmail ───────────────────────────────
  function _bodyText(payload) {
    if (!payload) return '';
    // body directo
    if (payload.body && payload.body.data) {
      var raw = _b64(payload.body.data);
      return payload.mimeType === 'text/html' ? _strip(raw) : raw;
    }
    var parts = payload.parts || [];
    // text/plain primero
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].mimeType === 'text/plain' && parts[i].body && parts[i].body.data)
        return _b64(parts[i].body.data);
    }
    // text/html
    for (var j = 0; j < parts.length; j++) {
      if (parts[j].mimeType === 'text/html' && parts[j].body && parts[j].body.data)
        return _strip(_b64(parts[j].body.data));
    }
    // multipart anidado
    for (var k = 0; k < parts.length; k++) {
      var nested = _bodyText(parts[k]);
      if (nested) return nested;
    }
    return '';
  }

  // ── API pública ──────────────────────────────────────────────────────

  // Devuelve array de { id, text } de mails no leídos con formato Forminator
  function fetchUnread() {
    return _req('GET', '/messages?maxResults=30&q=is%3Aunread')
      .then(function (data) {
        var msgs = (data.messages || []);
        if (!msgs.length) return [];
        return Promise.all(msgs.map(function (m) {
          return _req('GET', '/messages/' + m.id + '?format=full')
            .then(function (msg) {
              return { id: m.id, text: _bodyText(msg.payload) };
            });
        }));
      })
      .then(function (emails) {
        // Filtrar solo los que tienen el formato de Forminator
        return emails.filter(function (e) {
          return e.text
            && /\*Dir retiro:\*/i.test(e.text)
            && /\*Peones\*/i.test(e.text);
        });
      });
  }

  // Marca un mensaje como leído
  function markRead(id) {
    return _req('POST', '/messages/' + id + '/modify', { removeLabelIds: ['UNREAD'] });
  }

  return { isConnected: isConnected, fetchUnread: fetchUnread, markRead: markRead };
})();
