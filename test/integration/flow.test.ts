import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Deps } from '../../src/deps.js';
import { sha256Base64Url } from '../../src/lib/crypto.js';
import type { Move } from '../../src/liveness/challenge.js';
import { createClient } from '../../src/oauth/clients.js';
import { fakeImage, PERSON_A, PERSON_A_ID, PERSON_B, performance as act, type FakeFace } from '../helpers/fakes.js';
import { resetDb, testDeps } from '../helpers/env.js';
import type { FakeReader, FakeRecognizer } from '../helpers/fakes.js';

const REDIRECT = 'https://pppmtl.example/auth/liveid/callback';
const PHONE = '+15145550134';
const EMAIL = 'client@takatak.ca';

let app: FastifyInstance;
let deps: Deps;
let recognizer: FakeRecognizer;
let reader: FakeReader;
let secret: string;

beforeAll(async () => {
  await resetDb();
  const t = await testDeps();
  deps = t.deps;
  recognizer = t.recognizer;
  reader = t.reader;
  app = await buildApp(deps);
  const c = await createClient(deps.db, deps.cfg.secret, { id: 'pppmtl', name: 'PPP Pizzeria', redirectUris: [REDIRECT] });
  secret = c.secret;
});

afterAll(async () => {
  await app?.close();
  await deps?.db.end();
});

/** A browser: keeps the session cookie and the CSRF token. */
class Browser {
  cookie = '';
  csrf = '';
  constructor(private readonly ip = '203.0.113.10') {}

  async authorize(params: Record<string, string> = {}): Promise<{ res: LightMyRequestResponse; verifier: string; state: string }> {
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(8).toString('hex');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: 'pppmtl',
      redirect_uri: REDIRECT,
      scope: 'openid phone email liveness id_document',
      state,
      nonce: 'n-123',
      code_challenge: sha256Base64Url(verifier),
      code_challenge_method: 'S256',
      ...params,
    });
    const res = await app.inject({ method: 'GET', url: `/authorize?${query}`, remoteAddress: this.ip });
    const set = res.cookies.find((c) => c.name === 'liveid_sid');
    if (set) this.cookie = `liveid_sid=${set.value}`;
    return { res, verifier, state };
  }

  async state() {
    const res = await app.inject({ method: 'GET', url: '/api/flow/state', headers: { cookie: this.cookie }, remoteAddress: this.ip });
    const json = res.json();
    if (json.csrf) this.csrf = json.csrf;
    return json;
  }

  post(url: string, body: unknown = {}, csrf = true) {
    return app.inject({
      method: 'POST',
      url,
      headers: { cookie: this.cookie, ...(csrf ? { 'x-liveid-csrf': this.csrf } : {}), 'content-type': 'application/json' },
      payload: JSON.stringify(body),
      remoteAddress: this.ip,
    });
  }

  multipart(url: string, parts: Array<{ name: string; value: string | Buffer; filename?: string; type?: string }>) {
    const boundary = '----liveid' + randomBytes(8).toString('hex');
    const chunks: Buffer[] = [];
    for (const p of parts) {
      const head = p.filename
        ? `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\nContent-Type: ${p.type ?? 'application/octet-stream'}\r\n\r\n`
        : `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n`;
      chunks.push(Buffer.from(head), typeof p.value === 'string' ? Buffer.from(p.value) : p.value, Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return app.inject({
      method: 'POST',
      url,
      headers: { cookie: this.cookie, 'x-liveid-csrf': this.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat(chunks),
      remoteAddress: this.ip,
    });
  }

  async passOtp(kind: 'phone' | 'email', target: string) {
    const start = await this.post(`/api/flow/${kind}/start`, kind === 'phone' ? { phone: target } : { email: target });
    expect(start.statusCode, start.body).toBe(200);
    const code = deps.outbox.latestCode(target)!;
    const ok = await this.post(`/api/flow/${kind}/verify`, { code });
    expect(ok.statusCode, ok.body).toBe(200);
  }

  async liveness(opts: { act?: Partial<Parameters<typeof act>[0]>; heard?: (digits: string) => string; movesOverride?: Move[] } = {}) {
    const chRes = await this.post('/api/flow/liveness/challenge', { signals: humanSignals });
    expect(chRes.statusCode, chRes.body).toBe(200);
    const ch = chRes.json() as { challengeId: string; digits: string; moves: Move[]; plan: { speakMs: number; moveMs: number; centerMs: number; fps: number } };
    const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    recognizer.answer = () => (opts.heard ? opts.heard(ch.digits) : ch.digits.split('').map((d) => words[Number(d)]).join(' '));
    const p = act({ moves: opts.movesOverride ?? ch.moves, plan: ch.plan, ...opts.act });
    // The recording takes ~17 s in real life: move the challenge's issue time back instead of waiting.
    await deps.db.query(`update liveid_challenges set issued_at = now() - interval '25 seconds' where id = $1`, [ch.challengeId]);
    const res = await this.multipart('/api/flow/liveness/submit', [
      { name: 'challengeId', value: ch.challengeId },
      { name: 'meta', value: JSON.stringify({ frames: p.frames.map((f) => f.t), speakWindow: { start: 0, end: ch.plan.speakMs }, signals: humanSignals }) },
      { name: 'audio', value: p.audio, filename: 'audio.wav', type: 'audio/wav' },
      ...p.frames.map((f, i) => ({ name: 'frame', value: f.image, filename: `f${i}.jpg`, type: 'image/jpeg' })),
    ]);
    return { res, ch };
  }

  idFront(faces: FakeFace[], width = 1280) {
    return this.multipart('/api/flow/id/submit', [{ name: 'image', value: fakeImage(faces, { width }), filename: 'id.jpg', type: 'image/jpeg' }]);
  }
}

const humanSignals = { webdriver: false, languages: ['fr-CA', 'en'], touch: false, pointerEvents: 6, keyEvents: 20, msOnPage: 9000, videoLabel: 'FaceTime HD Camera' };

describe('authorize', () => {
  it('shows an error page (no redirect) for an unknown site or an unregistered return address', async () => {
    const b = new Browser();
    const unknown = await b.authorize({ client_id: 'nobody' });
    expect(unknown.res.statusCode).toBe(400);
    expect(unknown.res.headers.location).toBeUndefined();
    const evil = await b.authorize({ redirect_uri: 'https://evil.example/cb' });
    expect(evil.res.statusCode).toBe(400);
    expect(evil.res.body).toContain('Adresse de retour invalide');
  });

  it('sends protocol errors back to the site', async () => {
    const b = new Browser();
    const noPkce = await b.authorize({ code_challenge_method: 'plain' });
    expect(noPkce.res.statusCode).toBe(303);
    expect(noPkce.res.headers.location).toContain('error=invalid_request');
    const badScope = await b.authorize({ scope: 'openid admin' });
    expect(badScope.res.headers.location).toContain('error=invalid_scope');
  });

  it('starts a session with a protected cookie and security headers', async () => {
    const b = new Browser();
    const { res } = await b.authorize();
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/flow');
    const c = res.cookies.find((x) => x.name === 'liveid_sid')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    const page = await app.inject({ method: 'GET', url: '/flow', headers: { cookie: b.cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('/assets/app.js');
  });

  it('publishes discovery and the public key', async () => {
    const d = (await app.inject({ method: 'GET', url: '/.well-known/openid-configuration' })).json();
    expect(d.code_challenge_methods_supported).toEqual(['S256']);
    const jwks = (await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).json();
    expect(jwks.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' });
    expect(jwks.keys[0].d).toBeUndefined();
  });
});

describe('full verification: consent → phone → email → live → ID → token', () => {
  it('works end to end and returns a signed, verifiable result', async () => {
    const b = new Browser('203.0.113.20');
    const { verifier, state } = await b.authorize();
    const s0 = await b.state();
    expect(s0.client.name).toBe('PPP Pizzeria');
    expect(s0.next).toBe('consent');

    // CSRF: a state-changing call without our header is refused.
    expect((await b.post('/api/flow/consent', { accept: true }, false)).statusCode).toBe(403);
    // Steps cannot be skipped.
    expect((await b.post('/api/flow/email/start', { email: EMAIL })).json().error).toBe('wrong_step');

    expect((await b.post('/api/flow/consent', { accept: true, signals: humanSignals })).statusCode).toBe(200);
    expect((await b.post('/api/flow/phone/start', { phone: '123' })).json().error).toBe('phone_invalid');
    expect((await b.post('/api/flow/phone/start', { phone: '+33612345678' })).json().error).toBe('phone_country_not_supported');

    const start = await b.post('/api/flow/phone/start', { phone: '514 555-0134' });
    expect(start.json()).toMatchObject({ sent: true, to: '+1 ••••••••34' });
    expect((await b.post('/api/flow/phone/start', { phone: '514 555-0134' })).json().error).toBe('resend_too_soon');
    const sms = deps.outbox.list().find((m) => m.to === PHONE)!;
    expect(sms.text).toContain('@localhost:8080 #');
    const wrong = await b.post('/api/flow/phone/verify', { code: '000000' === deps.outbox.latestCode(PHONE) ? '111111' : '000000' });
    expect(wrong.json()).toMatchObject({ error: 'code_invalid', attemptsLeft: 4 });
    expect((await b.post('/api/flow/phone/verify', { code: deps.outbox.latestCode(PHONE) })).json()).toEqual({ verified: true });

    expect((await b.post('/api/flow/email/start', { email: 'x@mailinator.com' })).json().error).toBe('email_disposable');
    await b.passOtp('email', EMAIL);

    // Live check: a first failed try (wrong digits), then a good one.
    const bad = await b.liveness({ heard: () => 'one two three four' });
    expect(bad.res.json()).toMatchObject({ passed: false, attemptsLeft: 2 });
    expect(bad.res.json().reasons).toContain('digits_wrong');
    // The same challenge cannot be replayed.
    const replay = await b.multipart('/api/flow/liveness/submit', [
      { name: 'challengeId', value: bad.ch.challengeId },
      { name: 'meta', value: JSON.stringify({ frames: [] }) },
    ]);
    expect(replay.json().error).toBe('challenge_invalid');
    const good = await b.liveness();
    expect(good.res.json(), good.res.body).toMatchObject({ passed: true, reasons: [] });

    // ID front: a selfie-sized face is refused, another person is refused, the right card passes.
    expect((await b.idFront([{ nx: 0, ny: 0.45, mouth: 0, emb: PERSON_A, w: 700 }])).json().reason).toBe('id_looks_like_selfie');
    reader.text = 'nothing';
    expect((await b.idFront([{ nx: 0, ny: 0.45, mouth: 0, emb: PERSON_A, w: 180 }])).json().reason).toBe('id_text_not_found');
    reader.text = 'SPECIMEN TEST CARD NAME SPECIMEN JEAN DOB 1981-04-12 EXPIRATION 2030-04-12';
    const ok = await b.idFront([{ nx: 0, ny: 0.45, mouth: 0, emb: PERSON_A_ID, w: 180 }]);
    expect(ok.json(), ok.body).toMatchObject({ passed: true, reason: null });

    // No raw media and no face template remain in the database.
    const row = (await deps.db.query('select * from liveid_sessions where browser_token_hash is not null and id_matched_at is not null')).rows[0];
    expect(row.face_template_sealed).toBeNull();
    expect(row.phone_sealed).not.toContain('5145550134');
    expect(JSON.stringify(row)).not.toContain(EMAIL);

    const fin = await b.post('/api/flow/finish');
    expect(fin.json().mode).toBe('redirect');
    const back = new URL(fin.json().redirect);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get('state')).toBe(state);
    const code = back.searchParams.get('code')!;

    const token = (body: Record<string, string>, auth?: string) =>
      app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...(auth ? { authorization: auth } : {}) },
        payload: new URLSearchParams(body).toString(),
      });
    const basic = 'Basic ' + Buffer.from(`pppmtl:${secret}`).toString('base64');
    const base = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier };

    expect((await token(base, 'Basic ' + Buffer.from('pppmtl:wrong').toString('base64'))).json().error).toBe('invalid_client');
    // A wrong PKCE verifier burns the code (single use), so test it on a copy: first the right one.
    const res = await token(base, basic);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { id_token } = res.json();
    expect((await token(base, basic)).json().error).toBe('invalid_grant');

    const jwks = createLocalJWKSet((await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).json());
    const { payload, protectedHeader } = await jwtVerify(id_token, jwks, { issuer: 'http://localhost:8080', audience: 'pppmtl' });
    expect(protectedHeader.alg).toBe('EdDSA');
    expect(payload).toMatchObject({
      nonce: 'n-123',
      phone_number: PHONE,
      phone_number_verified: true,
      email: EMAIL,
      email_verified: true,
      liveid: { level: 'premium', phone_verified: true, email_verified: true, liveness: { passed: true }, id_document: { matched: true } },
    });
    expect(String(payload.sub)).toMatch(/^[0-9a-f]{40}$/);

    const events = (await deps.db.query('select event from liveid_audit order by id')).rows.map((r) => r.event);
    expect(events).toEqual(expect.arrayContaining(['consent.accepted', 'otp.verified', 'liveness.failed', 'liveness.passed', 'id.passed', 'code.issued', 'token.issued']));
    const audit = JSON.stringify((await deps.db.query('select detail from liveid_audit')).rows);
    expect(audit).not.toContain('5145550134');
    expect(audit).not.toContain(EMAIL);
  });

  it('gives the same person the same id at one site (pairwise subject)', async () => {
    const run = async (ip: string) => {
      const b = new Browser(ip);
      const { verifier } = await b.authorize({ scope: 'openid phone' });
      await b.state();
      await b.post('/api/flow/consent', { accept: true, signals: humanSignals });
      await b.passOtp('phone', '+15145550199');
      const code = new URL((await b.post('/api/flow/finish')).json().redirect).searchParams.get('code')!;
      const r = await app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/json' },
        payload: { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier, client_id: 'pppmtl', client_secret: secret },
      });
      const parts = r.json().id_token.split('.');
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    };
    const a = await run('203.0.113.30');
    // wait out the per-number resend window
    await deps.db.query(`update liveid_otps set created_at = now() - interval '1 hour'`);
    const c = await run('203.0.113.31');
    expect(a.sub).toBe(c.sub);
    expect(a.liveid.level).toBe('basic');
  });
});

describe('protections', () => {
  async function toLiveness(ip: string, scope = 'openid liveness id_document') {
    const b = new Browser(ip);
    const a = await b.authorize({ scope });
    await b.state();
    expect((await b.post('/api/flow/consent', { accept: true, signals: humanSignals })).statusCode).toBe(200);
    return { b, ...a };
  }

  it('blocks automated browsers', async () => {
    const b = new Browser('203.0.113.40');
    await b.authorize();
    await b.state();
    const r = await b.post('/api/flow/consent', { accept: true, signals: { ...humanSignals, webdriver: true } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('automation_detected');
    expect((await b.state()).status).toBe('failed');
  });

  it('blocks a virtual camera at the live step', async () => {
    const { b } = await toLiveness('203.0.113.41');
    const r = await b.post('/api/flow/liveness/challenge', { signals: { ...humanSignals, videoLabel: 'OBS Virtual Camera' } });
    expect(r.json().error).toBe('automation_detected');
  });

  it('fails the session after 3 bad live attempts', async () => {
    const { b } = await toLiveness('203.0.113.42');
    for (let i = 0; i < 3; i++) {
      const r = await b.liveness({ movesOverride: ['up', 'up', 'up', 'up'].map((m, j) => (j % 2 ? 'down' : m)) as Move[] });
      expect(r.res.json().passed).toBe(false);
      expect(r.res.json().reasons).toContain('head_moves_wrong');
    }
    expect((await b.state()).status).toBe('failed');
    expect((await b.post('/api/flow/liveness/challenge', {})).json().error).toBe('session_failed');
  });

  it('refuses an ID that shows somebody else', async () => {
    const { b } = await toLiveness('203.0.113.43');
    expect((await b.liveness()).res.json().passed).toBe(true);
    const r = await b.idFront([{ nx: 0, ny: 0.45, mouth: 0, emb: PERSON_B, w: 180 }]);
    expect(r.json()).toMatchObject({ passed: false, reason: 'id_face_mismatch', attemptsLeft: 2 });
  });

  it('refuses an expired ID for good', async () => {
    const { b } = await toLiveness('203.0.113.44');
    expect((await b.liveness()).res.json().passed).toBe(true);
    reader.text = 'SPECIMEN NAME JEAN SPECIMEN DOB 1981-04-12 EXPIRATION 2020-01-31 NUMBER S1234';
    const r = await b.idFront([{ nx: 0, ny: 0.45, mouth: 0, emb: PERSON_A, w: 180 }]);
    expect(r.json()).toMatchObject({ passed: false, reason: 'id_expired', attemptsLeft: 0 });
    expect((await b.state()).status).toBe('failed');
    reader.text = 'SPECIMEN TEST CARD NAME SPECIMEN JEAN DOB 1981-04-12 EXPIRATION 2030-04-12';
  });

  it('hands the code to the opener in pop-up mode, only for the registered origin', async () => {
    const b = new Browser('203.0.113.45');
    await b.authorize({ scope: 'openid email', display: 'popup' });
    await b.state();
    await b.post('/api/flow/consent', { accept: true, signals: humanSignals });
    await b.passOtp('email', 'popup@takatak.ca');
    const r = (await b.post('/api/flow/finish')).json();
    expect(r).toMatchObject({ mode: 'popup', targetOrigin: 'https://pppmtl.example' });
    expect(r.code).toBeTruthy();
  });

  it('lets the person refuse', async () => {
    const b = new Browser('203.0.113.46');
    const { state } = await b.authorize();
    await b.state();
    const r = (await b.post('/api/flow/consent', { accept: false })).json();
    expect(r.redirect).toContain('error=access_denied');
    expect(r.redirect).toContain(`state=${state}`);
  });

  it('rejects files that are not images and oversized uploads', async () => {
    const { b } = await toLiveness('203.0.113.47');
    expect((await b.liveness()).res.json().passed).toBe(true);
    const r = await b.multipart('/api/flow/id/submit', [{ name: 'image', value: Buffer.from('<svg onload=alert(1)>'), filename: 'x.svg', type: 'image/svg+xml' }]);
    expect(r.json().error).toBe('image_invalid');
    const big = await b.multipart('/api/flow/id/submit', [{ name: 'image', value: Buffer.alloc(7 * 1024 * 1024, 0xff), filename: 'x.jpg', type: 'image/jpeg' }]);
    expect(big.statusCode).toBe(413);
  });
});
