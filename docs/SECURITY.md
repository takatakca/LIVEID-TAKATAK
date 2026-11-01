# Security, privacy and limits

## What each check stops

| Attack | Stopped by |
| --- | --- |
| Bot filling forms | SMS code to a real mobile, email code, `navigator.webdriver` / headless browser detection, human-input signals, rate limits |
| Stolen or guessed codes | 6-digit codes hashed with a server secret and bound to their row, 10 min, 5 tries, 30 s between sends, 3 per number/email per 15 min, 10 per IP per hour, 5 per session; constant-time compare; WebOTP line binds the SMS to our domain |
| Photo held up to the camera | random head moves (4 of left/right/up/down, random order) measured on the server from 468 face landmarks; a still or tilted photo produces no turn (tested on real images) |
| Recorded video replayed | random digits (1–9, single use, 3 min) must be heard in the audio; the mouth must open and close in time with the voice; challenge used once; recording cannot arrive faster than real time |
| Someone else doing the live part | one face only; the same face (ResNet descriptor) from the start to after the moves |
| Someone else's ID | the ID face must match the live face (eye-aligned ResNet, threshold 0.50, retry band 0.44); the card must show printed text; expired cards (when the date is readable) are refused |
| Virtual camera / injection tools | camera and microphone device names (OBS, ManyCam, Snap Camera, DroidCam, v4l2loopback, "fake"…) refused |
| Code interception | authorization code: single use, 2 min, bound to client + redirect URI + PKCE S256 verifier; client secret required |
| Token forgery | Ed25519 (EdDSA) signature, public key at `/.well-known/jwks.json` |
| Session theft / CSRF | session cookie `__Host-` (HttpOnly, Secure, SameSite=Lax) + per-session CSRF header on every change |
| XSS / clickjacking | strict CSP (`script-src 'self'`, no inline), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, DOM built with `textContent` only |
| Open redirect | redirect URIs are exact matches of registered https URIs; a bad one shows an error page, never redirects |

Everything is decided on the server. The browser only captures; a modified browser cannot "say" it passed.

## Privacy (Québec Law 25 / Act respecting the legal framework for information technology, s. 44–45)

- **Express consent** screen before any check, naming the site and listing the steps; the person can refuse.
- **No images or sound are stored.** Frames, audio and the ID photo are analysed in memory and dropped. The OCR text is never stored (only a character count and "expired yes/no").
- **Face template**: the live check keeps up to 6 face descriptors, **AES-256-GCM sealed**, only until the ID step ends, then wiped (also wiped by the purge job when the session ends or expires). No biometric database is built.
- Phone and email are sealed (AES-256-GCM, bound to their row and column); lookups use keyed hashes. Sessions are deleted after `RETENTION_DAYS` (30). The audit log holds no personal data.
- Sites receive a **pairwise** `sub`: one person cannot be tracked across sites through it.

**Before going live:** have the consent text and retention reviewed by counsel; check with the Commission d'accès à l'information whether the biometric verification must be declared (a declaration is required for a biometric *database*, at least 60 days before it is put in service — this system keeps none, but the process uses biometrics); name the person in charge of personal information; publish the privacy notice.

## Calibration (measured, `npm run test:models`)

On real photos (the man and the women in the `@vladmandic/human` sample images):

- Face match, eye-aligned ResNet (score = 1 − distance): same man worst pair **0.499**, different people best pair **0.421**. Thresholds: match ≥ **0.50**, retry 0.44–0.50, refuse < 0.44. The library's own embedding (faceres) was measured and **rejected**: two different women scored 0.56, above some same-person pairs.
- Head turn: nose offset / eye distance; turn ≈ 15° ⇔ 0.20 (`POSE_YAW_THRESHOLD`), up/down 0.09.
- The liveness model of the library scored still photos 0.94–1.00 "live": it is kept only as a soft signal. The anti-spoof decision rests on the random challenge.
- Speech: "seven three nine one" (synthetic voice) recognized exactly; noise gives nothing.

## Known limits (honest list)

1. **Field calibration needed.** The full success path with a real person in front of a real webcam could not be run in the build environment (no camera). Run 20–30 real verifications on staging (different phones, lighting, ages) and adjust the `POSE_*`, `MOUTH_RANGE_MIN` and face thresholds from the stored reports (`liveid_sessions.liveness_report`, `id_report`).
2. **French digits with the offline recognizer are experimental** (approximate pronunciations on the English model). English digits are reliable. For French, set `SPEECH_PROVIDER=openai` (needs `OPENAI_API_KEY`) or tell people to read the digits in English.
3. **No document-forgery detection.** The ID is checked for a face, printed text, expiry and a face match — not for holograms, microprint or a fake card made with the person's own photo. That needs a specialist vendor (see the cash-verified-accounts plan in takatak-v1).
4. **Deepfake streams** that follow random prompts in real time with a matching voice are the hardest attack for any self-hosted system. The virtual-camera block and the server-side timing help; they are not a proof.
5. Face analysis runs on the CPU (~10 s per live check). One container handles a few checks at a time; scale by adding replicas.
