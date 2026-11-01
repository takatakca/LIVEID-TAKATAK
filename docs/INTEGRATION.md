# Connect a site to TAKATAK LIVE ID

For developers of takatak.ca, pppmtl.com and every partner restaurant site. It works like "Continue with Facebook": your site sends the person to LIVE ID, they accept and pass the checks, then your **server** receives a signed result.

## 1. Register the site (once, by the LIVE ID operator)

```bash
npm run client:create -- --id pppmtl --name "PPP Pizzeria" --redirect https://pppmtl.com/auth/liveid/callback
```

It prints `client_id` and `client_secret` **once**. Put the secret in that site's secrets (Coolify), never in code, a note or a chat.

Scopes the site can ask for, in the order the person does them:

| Scope | Check |
| --- | --- |
| `openid` | required |
| `phone` | SMS code to a Canadian/US mobile number |
| `email` | email code |
| `liveness` | live check: say 4 random digits, turn the head in a random order |
| `id_document` | front of the ID, face compared with the live check (implies `liveness`) |

## 2. Send the person to LIVE ID

Your server makes a PKCE pair and a random `state`, keeps them in the person's session, then redirects to:

```
GET https://liveid.takatak.ca/authorize
  ?response_type=code
  &client_id=pppmtl
  &redirect_uri=https://pppmtl.com/auth/liveid/callback
  &scope=openid phone email liveness id_document
  &state=<random>
  &nonce=<random>
  &code_challenge=<base64url(sha256(verifier))>
  &code_challenge_method=S256
  &ui_locales=fr            (or en)
  &display=page             (or popup)
```

### Pop-up for restaurant pages

```html
<script src="https://liveid.takatak.ca/assets/liveid.js"></script>
<script>
  // state, nonce and codeChallenge come from YOUR server (it keeps the verifier).
  LiveID.open({
    issuer: 'https://liveid.takatak.ca',
    clientId: 'pppmtl',
    redirectUri: 'https://pppmtl.com/auth/liveid/callback',
    scope: 'openid phone email liveness id_document',
    state, nonce, codeChallenge, locale: 'fr',
  }).then(({ code, state }) => fetch('/auth/liveid/finish', { method: 'POST', body: JSON.stringify({ code, state }) }));
</script>
```

The pop-up hands the code only to the origin of the registered `redirect_uri`. Your page must not send `Cross-Origin-Opener-Policy: same-origin` (use `same-origin-allow-popups`), or the pop-up cannot reach it. If pop-ups are blocked, the helper falls back to a full-page redirect.

## 3. Trade the code for the result (server to server)

The code is valid **2 minutes, once**, for your client, your `redirect_uri` and your PKCE verifier.

```js
const res = await fetch('https://liveid.takatak.ca/oauth/token', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: 'Basic ' + Buffer.from(`pppmtl:${process.env.LIVEID_CLIENT_SECRET}`).toString('base64'),
  },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri, code_verifier }),
});
const { id_token } = await res.json();

import { createRemoteJWKSet, jwtVerify } from 'jose';
const JWKS = createRemoteJWKSet(new URL('https://liveid.takatak.ca/.well-known/jwks.json'));
const { payload } = await jwtVerify(id_token, JWKS, { issuer: 'https://liveid.takatak.ca', audience: 'pppmtl' });
if (payload.nonce !== expectedNonce) throw new Error('nonce');
```

Always check the signature, `iss`, `aud`, `exp` and `nonce` before trusting anything.

## 4. What you receive

```json
{
  "iss": "https://liveid.takatak.ca",
  "aud": "pppmtl",
  "sub": "9f2c…",                       // same person (same phone) = same value at YOUR site, different at other sites
  "nonce": "…",
  "phone_number": "+15145550134", "phone_number_verified": true,
  "email": "client@exemple.ca", "email_verified": true,
  "liveid": {
    "level": "premium",                  // basic (phone/email) · live (live check) · premium (live check + ID match)
    "liveness": { "passed": true, "at": 1793530000 },
    "id_document": { "matched": true, "at": 1793530100, "similarity": 0.55 },
    "risk": { "score": 0, "signals": [] },
    "session": "uuid"
  }
}
```

Decide in your app what each level unlocks (for example: cash on delivery only for `premium`).

Errors come back on your `redirect_uri` as `?error=access_denied|verification_failed|invalid_request|invalid_scope|temporarily_unavailable&state=…`.

## Endpoints

| Method | Path | Use |
| --- | --- | --- |
| GET | `/.well-known/openid-configuration` | discovery |
| GET | `/.well-known/jwks.json` | public signing key |
| GET | `/authorize` | start (browser) |
| POST | `/oauth/token` | code → signed result (server) |
| GET | `/healthz` | health check |
