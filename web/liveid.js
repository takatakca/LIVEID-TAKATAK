/*!
 * TAKATAK LIVE ID — browser helper for partner sites (takatak.ca, restaurants).
 * Opens the verification in a pop-up and resolves with { code, state } when the person is verified.
 * Your SERVER then trades the code for the signed result at POST <issuer>/oauth/token (see docs/INTEGRATION.md).
 *
 *   <script src="https://liveid.takatak.ca/assets/liveid.js"></script>
 *   const { code, state } = await LiveID.open({
 *     issuer: 'https://liveid.takatak.ca', clientId: 'pppmtl', redirectUri: 'https://pppmtl.com/auth/liveid/callback',
 *     scope: 'openid phone email liveness id_document', state, codeChallenge, nonce, locale: 'fr' });
 */
(function (global) {
  'use strict';

  function open(opts) {
    return new Promise(function (resolve, reject) {
      var issuer = new URL(opts.issuer);
      var url = new URL('/authorize', issuer);
      var q = url.searchParams;
      q.set('response_type', 'code');
      q.set('client_id', opts.clientId);
      q.set('redirect_uri', opts.redirectUri);
      q.set('scope', opts.scope || 'openid phone email liveness id_document');
      q.set('state', opts.state);
      if (opts.nonce) q.set('nonce', opts.nonce);
      q.set('code_challenge', opts.codeChallenge);
      q.set('code_challenge_method', 'S256');
      q.set('display', 'popup');
      q.set('ui_locales', opts.locale || 'fr');

      var w = 480;
      var h = 760;
      var left = Math.max(0, (global.screenX || 0) + ((global.outerWidth || w) - w) / 2);
      var top = Math.max(0, (global.screenY || 0) + ((global.outerHeight || h) - h) / 2);
      var popup = global.open(url.toString(), 'takatak-liveid', 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
      if (!popup) {
        // Pop-ups blocked: fall back to a full-page redirect (the result comes back on redirectUri).
        q.set('display', 'page');
        global.location.assign(url.toString());
        return;
      }

      var done = false;
      function finish(fn, value) {
        if (done) return;
        done = true;
        global.removeEventListener('message', onMessage);
        clearInterval(timer);
        fn(value);
      }
      function onMessage(event) {
        // Only messages from the LIVE ID origin and from the pop-up we opened.
        if (event.origin !== issuer.origin || event.source !== popup) return;
        var d = event.data || {};
        if (d.type !== 'liveid:result') return;
        if (d.state !== opts.state) return finish(reject, new Error('state_mismatch'));
        if (d.error) return finish(reject, new Error(d.error));
        finish(resolve, { code: d.code, state: d.state });
      }
      global.addEventListener('message', onMessage);
      var timer = setInterval(function () {
        if (popup.closed) finish(reject, new Error('closed'));
      }, 500);
    });
  }

  /** Helper to make a PKCE pair: { verifier, challenge }. Keep the verifier for your server. */
  async function pkce() {
    var bytes = new Uint8Array(32);
    global.crypto.getRandomValues(bytes);
    var verifier = b64url(bytes);
    var digest = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier: verifier, challenge: b64url(new Uint8Array(digest)) };
  }

  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  global.LiveID = { open: open, pkce: pkce };
})(window);
