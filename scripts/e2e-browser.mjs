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

async function contactSteps(page, phone, email, tag) {
  await page.locator('#contact').fill(phone);
  await page.screenshot({ path: path.join(out, `${tag}-03-phone.png`) });
  await page.getByRole('button', { name: 'Envoyer le code' }).click();
  await page.locator('#code').waitFor();
  await page.locator('#code').fill(await outboxCode('+1' + phone.replace(/\D/g, '')));
  await page.screenshot({ path: path.join(out, `${tag}-04-phone-code.png`) });
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await page.locator('#contact[type=email]').waitFor();
  await page.locator('#contact').fill(email);
  await page.getByRole('button', { name: 'Envoyer le code' }).click();
  await page.locator('#code').waitFor();
  await page.locator('#code').fill(await outboxCode(email));
  await page.getByRole('button', { name: 'Vérifier' }).click();
}

try {
  // ---- Run 1 ----
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: 'fr-CA' });
  const page = await ctx.newPage();
  await page.goto(`${RP}/?scope=${encodeURIComponent('openid phone email')}`);
  await page.screenshot({ path: path.join(out, 'run1-01-partner-site.png') });
  await page.click('#go');
  await page.getByRole('heading', { name: /Resto Démo veut vérifier votre identité/ }).waitFor();
  await page.screenshot({ path: path.join(out, 'run1-02-consent.png'), fullPage: true });
  check('consent screen names the site and lists the checks', (await page.locator('.list li').count()) === 2);
  await page.locator('#agree').check();
  await page.getByRole('button', { name: 'Accepter et continuer' }).click();
  await page.locator('#contact[type=tel]').waitFor();
  await contactSteps(page, '514 555 0134', 'client.demo@takatak.ca', 'run1');
  await page.getByRole('heading', { name: 'Identité vérifiée' }).waitFor();
  await page.screenshot({ path: path.join(out, 'run1-05-verified.png') });
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.locator('#claims').waitFor();
  await page.screenshot({ path: path.join(out, 'run1-06-back-on-site.png'), fullPage: true });
  check('site receives a signed result with phone and email verified', lastResult?.phone_number === '+15145550134' && lastResult?.email_verified === true && lastResult?.liveid?.level === 'basic');
  await ctx.close();

  // ---- Run 2 ----
  const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 }, locale: 'fr-CA' });
  const p2 = await ctx2.newPage();
  await p2.goto(`${RP}/?scope=${encodeURIComponent('openid phone email liveness id_document')}`);
  await p2.click('#go');
  await p2.locator('#agree').check();
  await p2.screenshot({ path: path.join(out, 'run2-01-consent-full.png'), fullPage: true });
  check('full consent lists phone, email, live check and ID', (await p2.locator('.list li').count()) === 4);
  await p2.getByRole('button', { name: 'Accepter et continuer' }).click();
  await p2.locator('#contact[type=tel]').waitFor();
  await contactSteps(p2, '514 555 0177', 'client.live@takatak.ca', 'run2');
  await p2.getByRole('heading', { name: 'Vérification en direct' }).waitFor();
  await p2.screenshot({ path: path.join(out, 'run2-05-live-intro.png') });
  await p2.getByRole('button', { name: 'Démarrer la caméra et le micro' }).click();
  await p2.getByRole('button', { name: 'Je suis prêt' }).waitFor();
  await sleep(800);
  await p2.screenshot({ path: path.join(out, 'run2-06-camera.png') });
  await p2.getByRole('button', { name: 'Je suis prêt' }).click();
  await p2.locator('.prompt .big').waitFor({ timeout: 10_000 });
  await sleep(1200);
  await p2.screenshot({ path: path.join(out, 'run2-07-say-digits.png') });
  await p2.locator('.prompt .arrow').waitFor({ timeout: 15_000 });
  await sleep(600);
  await p2.screenshot({ path: path.join(out, 'run2-08-turn-head.png') });
  await p2.locator('.error').waitFor({ timeout: 90_000 });
  await p2.screenshot({ path: path.join(out, 'run2-09-photo-refused.png'), fullPage: true });
  const msg = await p2.locator('.error').innerText();
  check('a still photo on the camera is refused by the server', /mouvements de tête|visage|bouche/i.test(msg), msg);
  const left = await p2.locator('.muted.small').first().innerText();
  check('the person sees how many tries are left', /Essais restants : 2/.test(left), left);
  await ctx2.close();
} catch (err) {
  check('browser flow ran without error', false, String(err?.message ?? err));
  await browser.contexts()[0]?.pages()[0]?.screenshot({ path: path.join(out, 'error.png') }).catch(() => {});
} finally {
  await browser.close();
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
