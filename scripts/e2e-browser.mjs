// Browser end-to-end test with a real Chromium, the real server, the real face/voice/OCR engines.
//
// Run 1 — a partner site sends a person to LIVE ID (redirect mode): consent, phone code, email code,
//          back to the site, which trades the code for the signed result and checks the signature.
// Run 2 — the live check with a camera that shows a still photo (Chromium fake camera fed a JPEG):
//          the person-facing flow must work and the server must REFUSE the photo.
//
// Needs: PostgreSQL (E2E_DATABASE_URL), ffmpeg, Playwright with Chromium, Python with pocketsphinx.
// Screenshots go to artifacts/e2e/.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createLocalJWKSet, jwtVerify } from 'jose';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'artifacts', 'e2e');
mkdirSync(out, { recursive: true });

const DB = process.env.E2E_DATABASE_URL ?? 'postgres://liveid:liveid@127.0.0.1:5432/liveid_e2e';
const PORT = 8091;
const RP_PORT = 8092;
const ISSUER = `http://localhost:${PORT}`;
const RP = `http://localhost:${RP_PORT}`;
const REDIRECT = `${RP}/callback`;
const log = (...a) => console.log('[e2e]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fresh database + client --------------------------------------------------------------------------
{
  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  await c.query('drop schema public cascade; create schema public;');
  await c.end();
}
const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(PORT),
  HOST: '127.0.0.1',
  PUBLIC_URL: ISSUER,
  DATABASE_URL: DB,
  LIVEID_SECRET: randomBytes(32).toString('hex'),
  LIVEID_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  DEV_OUTBOX: 'true',
  BLOCK_AUTOMATION: 'false', // Playwright is an automated browser; blocking is covered by the integration tests.
  SPEECH_PROVIDER: 'pocketsphinx',
};
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const created = execFileSync(tsx, ['src/cli/create-client.ts', '--id', 'demo-resto', '--name', 'Resto Démo', '--redirect', REDIRECT], { cwd: root, env }).toString();
const CLIENT_SECRET = /client_secret=(\S+)/.exec(created)[1];

// ---- fake camera / microphone files ----------------------------------------------------------------
const assets = path.resolve(path.dirname(require.resolve('@vladmandic/human')), '..', 'assets');
const tmp = path.join(os.tmpdir(), 'liveid-e2e');
mkdirSync(tmp, { recursive: true });
const y4m = path.join(tmp, 'still-face.y4m');
const wav = path.join(tmp, 'digits.wav');
if (!existsSync(y4m)) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', path.join(assets, 'screenshot-faceid.jpg'), '-vf', 'crop=139:139:14:142,scale=360:360,pad=640:480:140:60', '-r', '10', '-t', '3', '-pix_fmt', 'yuv420p', y4m]);
}
const fixtures = JSON.parse(execFileSync(path.join(root, 'node_modules', '.bin', 'tsx'), ['scripts/e2e-seed-face.ts', 'fixtures'], { cwd: root }).toString().trim().split('\n').pop());
const cardY4m = path.join(tmp, 'specimen-card.y4m');
if (!existsSync(cardY4m)) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', fixtures.specimen, '-vf', 'scale=1280:960', '-r', '10', '-t', '2', '-pix_fmt', 'yuv420p', cardY4m]);
}
if (!existsSync(wav)) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "flite=text='seven three nine one':voice=slt", '-ar', '48000', '-ac', '1', wav]);
}

// ---- LIVE ID server --------------------------------------------------------------------------------
const server = spawn(tsx, ['src/main.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${ISSUER}/healthz`)).ok) break;
  } catch {}
  await sleep(500);
}
log('LIVE ID server up');

// ---- a partner website (what pppmtl.com / takatak.ca will do) --------------------------------------
const pending = new Map();
let lastResult = null;
const rp = createServer(async (req, res) => {
  const url = new URL(req.url, RP);
  if (url.pathname === '/') {
    const scope = url.searchParams.get('scope') ?? 'openid phone email';
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(12).toString('hex');
    pending.set(state, verifier);
    const auth = new URL('/authorize', ISSUER);
    for (const [k, v] of Object.entries({
      response_type: 'code', client_id: 'demo-resto', redirect_uri: REDIRECT, scope, state, nonce: 'demo-nonce',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ui_locales: 'fr',
    })) auth.searchParams.set(k, v);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;background:#fff;padding:40px"><h1>Resto Démo</h1><p>Commande protégée : vérifiez votre identité.</p><a id="go" href="${auth}" style="display:inline-block;padding:14px 22px;background:#1565D8;color:#fff;border-radius:10px;text-decoration:none">Vérifier avec TAKATAK LIVE ID</a></body>`);
  }
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const verifier = pending.get(state);
    const r = await fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + Buffer.from(`demo-resto:${CLIENT_SECRET}`).toString('base64') },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier }),
    });
    const json = await r.json();
    const jwks = createLocalJWKSet(await (await fetch(`${ISSUER}/.well-known/jwks.json`)).json());
    const { payload } = await jwtVerify(json.id_token, jwks, { issuer: ISSUER, audience: 'demo-resto' });
    lastResult = payload;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;padding:40px"><h1>✅ Identité vérifiée (signature EdDSA valide)</h1><pre id="claims">${JSON.stringify(payload, null, 2).replace(/</g, '&lt;')}</pre></body>`);
  }
  res.writeHead(404).end();
});
await new Promise((r) => rp.listen(RP_PORT, '127.0.0.1', r));

// ---- browser ---------------------------------------------------------------------------------------
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`, `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
});
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};

async function outboxCode(to) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${ISSUER}/dev/outbox`)).json();
    const m = [...list].reverse().find((x) => x.to === to);
    const code = m && /\b(\d{6})\b/.exec(m.text)?.[1];
    if (code) return code;
    await sleep(250);
  }
  throw new Error('no code for ' + to);
}

async function typeCode(page, to) {
  const code = await outboxCode(to);
  // Typed one digit at a time into the 6 boxes, like a person; the code is checked at the 6th digit.
  await page.locator('.otp').first().click();
  await page.keyboard.type(code, { delay: 40 });
}

async function contactSteps(page, email, phone, tag) {
  // Email first: send, the code boxes appear right below, checked automatically.
  await page.locator('#in-email').fill(email);
  await page.screenshot({ path: path.join(out, `${tag}-02-email.png`) });
  await page.locator('.sec.is-active').getByRole('button', { name: 'Envoyer le code' }).click();
  await page.locator('.otp').first().waitFor();
  await typeCode(page, email);
  await page.screenshot({ path: path.join(out, `${tag}-03-email-code.png`) });
  // Then the mobile, on the same screen (no page change).
  await page.locator('#in-phone').waitFor();
  check(`${tag}: email verified inline, phone section opens on the same screen`, (await page.locator('.sec.is-done').count()) === 1);
  await page.locator('#in-phone').fill(phone);
  await page.locator('.sec.is-active').getByRole('button', { name: 'Envoyer le code' }).click();
  await page.locator('.sec.is-active .otp').first().waitFor();
  await typeCode(page, '+1' + phone.replace(/\D/g, ''));
  await page.screenshot({ path: path.join(out, `${tag}-04-phone-code.png`) });
}

async function acceptTerms(page, tag, button) {
  await page.locator('#agree').waitFor();
  await sleep(600);
  await page.screenshot({ path: path.join(out, `${tag}-05-terms.png`), fullPage: true });
  await page.locator('#agree').check();
  await page.getByRole('button', { name: button }).click();
}

try {
  // ---- Run 1: email + phone + terms, back to the site with a signed result ----
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: 'fr-CA' });
  const page = await ctx.newPage();
  await page.goto(`${RP}/?scope=${encodeURIComponent('openid phone email')}`);
  await page.screenshot({ path: path.join(out, 'run1-01-partner-site.png') });
  await page.click('#go');
  await page.getByText('Resto Démo veut vérifier votre identité').waitFor();
  check('run1: email comes first, with the send button on the same screen', await page.locator('#in-email').isVisible());
  await contactSteps(page, 'client.demo@takatak.ca', '514 555 0134', 'run1');
  await acceptTerms(page, 'run1', 'Accepter et terminer');
  await page.getByRole('heading', { name: 'Identité vérifiée' }).waitFor();
  await page.screenshot({ path: path.join(out, 'run1-06-verified.png') });
  // No click: it returns to the site by itself.
  await page.locator('#claims').waitFor({ timeout: 15_000 });
  await page.screenshot({ path: path.join(out, 'run1-07-back-on-site.png'), fullPage: true });
  check('run1: site receives a signed result with phone and email verified', lastResult?.phone_number === '+15145550134' && lastResult?.email_verified === true && lastResult?.liveid?.level === 'basic');
  await ctx.close();

  // ---- Run 2: full scope; the video starts by itself when the (photo) face is in the oval; refused ----
  const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: 'fr-CA' });
  const p2 = await ctx2.newPage();
  const consoleErrors = [];
  p2.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  p2.on('pageerror', (e) => consoleErrors.push(String(e)));
  await p2.goto(`${RP}/?scope=${encodeURIComponent('openid phone email liveness id_document')}`);
  await p2.click('#go');
  await contactSteps(p2, 'client.live@takatak.ca', '514 555 0177', 'run2');
  await acceptTerms(p2, 'run2', 'Suivant');
  await p2.locator('.stage-face video').waitFor();
  await p2.getByText(/Parfait, ne bougez plus|Placez votre visage|Approchez|Reculez|Centrez/).waitFor({ timeout: 30_000 });
  await sleep(300);
  await p2.screenshot({ path: path.join(out, 'run2-06-face-guide.png') });
  // No "ready" button: the countdown starts once the face sits in the oval.
  await p2.locator('.digits').waitFor({ timeout: 30_000 });
  check('run2: video started by itself (face in the oval, no button)', (await p2.getByRole('button', { name: 'Je suis prêt' }).count()) === 0);
  await sleep(1200);
  await p2.screenshot({ path: path.join(out, 'run2-07-say-digits.png') });
  await p2.locator('.gauge').waitFor({ timeout: 15_000 });
  await sleep(700);
  await p2.screenshot({ path: path.join(out, 'run2-08-turn-head.png') });
  // A photo cannot turn its head: the arrow turns red ("not enough") and the try stops before any upload.
  await p2.locator('.gauge.is-bad').waitFor({ timeout: 20_000 });
  await p2.screenshot({ path: path.join(out, 'run2-09-not-enough-red.png') });
  check('run2: head not turned → red arrow "Pas assez"', /Pas assez/.test(await p2.locator('.prompt .say').innerText()));
  await p2.locator('.below .alert.error').waitFor({ timeout: 60_000 });
  await p2.screenshot({ path: path.join(out, 'run2-10-photo-stopped.png'), fullPage: true });
  const msg = await p2.locator('.below .alert.error').innerText();
  check('run2: a still photo cannot complete the moves; the person is asked to start again', /pas assez marqués/.test(msg), msg);
  const st = await p2.evaluate(() => fetch('/api/flow/state', { credentials: 'same-origin' }).then((r) => r.json()));
  check('run2: no attempt was used up (nothing was sent)', st.attempts.livenessLeft === 3, JSON.stringify(st.attempts));
  const cspErrors = consoleErrors.filter((e) => /Content Security Policy|Refused to/i.test(e));
  check('run2: no browser errors (CSP or script)', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  if (cspErrors.length) log('CSP:', cspErrors.join(' | '));
  await ctx2.close();
  await browser.close();

  // ---- Run 3: ID front, photo taken and sent by itself (camera shows the SPECIMEN card) ----
  const browser3 = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cardY4m}`, `--use-file-for-fake-audio-capture=${wav}`],
  });
  const ctx3 = await browser3.newContext({ viewport: { width: 430, height: 900 }, locale: 'fr-CA' });
  const p3 = await ctx3.newPage();
  const errors3 = [];
  p3.on('pageerror', (e) => errors3.push(String(e)));
  await p3.goto(`${RP}/?scope=${encodeURIComponent('openid phone email liveness id_document')}`);
  await p3.click('#go');
  await contactSteps(p3, 'client.id@takatak.ca', '514 555 0188', 'run3');
  await acceptTerms(p3, 'run3', 'Suivant');
  await p3.locator('.stage-face').waitFor();
  // A fake camera cannot pass the live check: mark it passed with the template a real pass stores.
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const sid = (await db.query(`select id from liveid_sessions where status = 'pending' and consented_at is not null order by created_at desc limit 1`)).rows[0].id;
  await db.end();
  execFileSync(tsx, ['scripts/e2e-seed-face.ts', 'seed', sid], { cwd: root, env });
  await p3.reload();
  await p3.locator('.stage-card video').waitFor();
  await p3.locator('.stage-card.is-ok').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await p3.screenshot({ path: path.join(out, 'run3-06-card-in-frame.png') });
  await p3.getByRole('heading', { name: 'Identité vérifiée' }).waitFor({ timeout: 60_000 });
  check('run3: ID photo taken and sent automatically (no button), face matched', (await p3.getByRole('button', { name: 'Prendre la photo' }).count()) === 0 || !(await p3.getByRole('button', { name: 'Prendre la photo' }).isVisible()));
  await p3.screenshot({ path: path.join(out, 'run3-07-verified.png') });
  await p3.locator('#claims').waitFor({ timeout: 15_000 });
  await p3.screenshot({ path: path.join(out, 'run3-08-back-on-site.png'), fullPage: true });
  check('run3: site receives level premium (live + ID matched)', lastResult?.liveid?.level === 'premium' && lastResult?.liveid?.id_document?.matched === true, JSON.stringify(lastResult?.liveid?.id_document));
  check('run3: no page errors', errors3.length === 0, errors3.join(' | '));
  await browser3.close();
} catch (err) {
  check('browser flow ran without error', false, String(err?.message ?? err));
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(out, 'error.png') }).catch(() => {});
} finally {
  await browser.close().catch(() => undefined);
  rp.close();
  server.kill('SIGTERM');
}

const failed = results.filter((r) => !r.ok);
log(`${results.length - failed.length}/${results.length} browser checks passed. Screenshots: ${out}`);
if (failed.length) {
  console.log(serverLog.split('\n').slice(-40).join('\n'));
  process.exit(1);
}
process.exit(0);
