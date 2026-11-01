# TAKATAK LIVE ID

Identity verification for GROUPE TAKATAK (takatak.ca) and partner restaurants: proves a **real person** is there and that it is **the right person** — to stop bots and fraud.

Like "Continue with Facebook": a site sends the person here, they **accept**, then:

1. **Phone** — SMS code
2. **Email** — email code
3. **Live check** — say 4 random digits out loud, then turn the head left / right / up / down in a random order
4. **ID front** — photo of the front of the ID; its face photo is compared with the live face

…and the site's server receives a **signed result** (EdDSA JWT).

*FR — Vérification d'identité en direct : téléphone, courriel, chiffres dits à voix haute et mouvements de tête au hasard, puis recto de la pièce comparé au visage. Le site reçoit un résultat signé. Journal des notes : [NOTES.md](NOTES.md).*

## Why it is secure

Everything is decided **on the server** (face landmarks, face recognition, speech, OCR — all offline, nothing sent to third parties). The browser only captures. No photo, video or sound is stored. Details and limits: [docs/SECURITY.md](docs/SECURITY.md).

## Connect a site

[docs/INTEGRATION.md](docs/INTEGRATION.md) — redirect or pop-up (`/assets/liveid.js`), then `POST /oauth/token`.

## Run it

Requirements: Node 22, PostgreSQL 16, Python 3 with `pocketsphinx` (spoken digits). The Docker image has everything.

```bash
npm ci
cp .env.example .env            # then fill the 3 secrets:
npm run keys:generate           # prints LIVEID_SECRET, LIVEID_ENCRYPTION_KEY, LIVEID_SIGNING_KEY
npm run migrate
npm run client:create -- --id takatak-web --name "GROUPE TAKATAK" --redirect https://takatak.ca/auth/liveid/callback
npm run build && npm start      # or: npm run dev
```

Production (Coolify): build the `Dockerfile`, set the variables from `.env.example` as secrets, with `SMS_PROVIDER=twilio`, `EMAIL_PROVIDER=smtp`, `TRUST_PROXY=true`, `PUBLIC_URL=https://liveid.takatak.ca`. The server refuses to start in production with test providers, without a signing key, or without https.

## Tests

```bash
npm test               # logic + full flow on PostgreSQL + real face/voice/OCR models
npm run test:e2e       # real Chromium, fake camera: partner site → LIVE ID → back with a signed result; a still photo is refused
```

Needs `TEST_DATABASE_URL` / `E2E_DATABASE_URL` (default `postgres://liveid:liveid@127.0.0.1:5432/liveid_test` / `liveid_e2e`), `ffmpeg`, and `POCKETSPHINX_PYTHON` pointing to a Python with `pocketsphinx`. CI runs all of it: [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Layout

| Path | What |
| --- | --- |
| `src/oauth` | `/authorize`, `/oauth/token`, signing keys, registered sites |
| `src/flow` | the step API, session, rate limits, risk signals, purge |
| `src/liveness` | challenge, head-move sequence, voice activity, mouth/voice sync, spoken digits |
| `src/face` | face landmarks (Human) + eye-aligned ResNet face recognition (face-api) |
| `src/idcheck` | ID front: face, text (OCR), expiry, face match |
| `src/web`, `web/` | the pages people see (FR/EN, TAKATAK brand) and the pop-up helper |
| `migrations/` | PostgreSQL schema |
| `py/digits.py` | offline digit recognizer |
