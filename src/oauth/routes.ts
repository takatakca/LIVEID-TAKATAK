import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { one } from '../db/pool.js';
import { keyedHash, randomToken, verifyPkce } from '../lib/crypto.js';
import { audit, cookieName, ipHash, noStore, type SessionRow } from '../flow/session.js';
import { ALL_SCOPES, getClient, verifyClientSecret } from './clients.js';
import { signIdToken } from './keys.js';

const authorizeQuery = z.object({
  response_type: z.string(),
  client_id: z.string().max(64),
  redirect_uri: z.string().max(2048),
  scope: z.string().max(200).default('openid'),
  state: z.string().min(1).max(512),
  nonce: z.string().max(512).optional(),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal('S256'),
  display: z.enum(['page', 'popup']).default('page'),
  ui_locales: z.string().max(50).optional(),
});

const tokenBody = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(20).max(200),
  redirect_uri: z.string().max(2048),
  code_verifier: z.string().min(43).max(128),
  client_id: z.string().max(64).optional(),
  client_secret: z.string().max(200).optional(),
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function errorPage(reply: FastifyReply, status: number, title: string, detail: string): FastifyReply {
  noStore(reply);
  return reply
    .status(status)
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TAKATAK LIVE ID</title><link rel="stylesheet" href="/assets/styles.css"></head><body><main class="card"><p class="eyebrow">GROUPE TAKATAK · LIVE ID</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></main></body></html>`,
    );
}

function redirectWithError(reply: FastifyReply, redirectUri: string, error: string, state: string | undefined): FastifyReply {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  if (state) u.searchParams.set('state', state);
  return reply.redirect(u.toString(), 303);
}

function locale(uiLocales: string | undefined): 'fr' | 'en' {
  const first = (uiLocales ?? '').split(/[\s,]+/).find(Boolean)?.toLowerCase() ?? 'fr';
  return first.startsWith('en') ? 'en' : 'fr';
}

export async function oauthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { cfg } = deps;

  app.get('/.well-known/openid-configuration', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return {
      issuer: cfg.issuer,
      authorization_endpoint: `${cfg.publicUrl}/authorize`,
      token_endpoint: `${cfg.publicUrl}/oauth/token`,
      jwks_uri: `${cfg.publicUrl}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      response_modes_supported: ['query', 'web_message'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['pairwise'],
      id_token_signing_alg_values_supported: ['EdDSA'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: [...ALL_SCOPES],
      display_values_supported: ['page', 'popup'],
      ui_locales_supported: ['fr', 'en'],
      claims_supported: ['sub', 'phone_number', 'phone_number_verified', 'email', 'email_verified', 'liveid'],
    };
  });

  app.get('/.well-known/jwks.json', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return { keys: [deps.keys.publicJwk] };
  });

  /**
   * Step 1 for a website (takatak.ca, a restaurant): send the person here. Like "Continue with Facebook":
   * they see who asks, what will be checked, and accept or refuse.
   */
  app.get('/authorize', async (req, reply) => {
    const parsed = authorizeQuery.safeParse(req.query);
    const raw = (req.query ?? {}) as Record<string, string | undefined>;
    const client = raw.client_id ? await getClient(deps.db, raw.client_id) : undefined;
    if (!client) return errorPage(reply, 400, 'Application inconnue', 'Ce site n’est pas autorisé à utiliser TAKATAK LIVE ID.');
    if (!raw.redirect_uri || !client.redirect_uris.includes(raw.redirect_uri)) {
      // Never redirect to an address the site did not register.
      return errorPage(reply, 400, 'Adresse de retour invalide', 'L’adresse de retour ne correspond pas à celle enregistrée pour ce site.');
    }
    const redirectUri = raw.redirect_uri;
    if (!parsed.success) return redirectWithError(reply, redirectUri, 'invalid_request', raw.state);
    const q = parsed.data;
    if (q.response_type !== 'code') return redirectWithError(reply, redirectUri, 'unsupported_response_type', q.state);
    const scopes = [...new Set(q.scope.split(/\s+/).filter(Boolean))];
    if (!scopes.includes('openid') || scopes.some((s) => !client.allowed_scopes.includes(s))) {
      return redirectWithError(reply, redirectUri, 'invalid_scope', q.state);
    }
    if (!(await deps.limiter.hit(`authorize:${ipHash(deps, req)}`, 30, 600))) {
      return redirectWithError(reply, redirectUri, 'temporarily_unavailable', q.state);
    }

    const browserToken = randomToken(32);
    const session = await one<{ id: string }>(
      deps.db,
      `insert into liveid_sessions
        (client_id, browser_token_hash, csrf_token, redirect_uri, state, nonce, scopes, code_challenge, display, locale, ip_hash, user_agent, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + make_interval(mins => $13))
       returning id`,
      [
        client.id,
        keyedHash(cfg.secret, 'browser', browserToken),
        randomToken(24),
        redirectUri,
        q.state,
        q.nonce ?? null,
        scopes,
        q.code_challenge,
        q.display,
        locale(q.ui_locales),
        ipHash(deps, req),
        String(req.headers['user-agent'] ?? '').slice(0, 300),
        cfg.sessionTtlMinutes,
      ],
    );
    await audit(deps, { id: session!.id, client_id: client.id }, 'session.created', { scopes, display: q.display });
    noStore(reply);
    reply.setCookie(cookieName(deps), browserToken, {
      path: '/',
      httpOnly: true,
      secure: cfg.publicUrl.startsWith('https://'),
      sameSite: 'lax',
      maxAge: cfg.sessionTtlMinutes * 60,
    });
    return reply.redirect('/flow', 303);
  });

  /** Step 3 for a website, server to server: trade the one-time code for the signed verification result. */
  app.post('/oauth/token', async (req, reply) => {
    noStore(reply);
    const fail = (status: number, error: string) => reply.status(status).send({ error });
    const parsed = tokenBody.safeParse(req.body);
    if (!parsed.success) return fail(400, 'invalid_request');
    const b = parsed.data;

    let clientId = b.client_id;
    let clientSecret = b.client_secret;
    const authz = req.headers.authorization;
    if (authz?.startsWith('Basic ')) {
      const decoded = Buffer.from(authz.slice(6), 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i > 0) {
        clientId = decodeURIComponent(decoded.slice(0, i));
        clientSecret = decodeURIComponent(decoded.slice(i + 1));
      }
    }
    if (!clientId || !clientSecret) return fail(401, 'invalid_client');
    if (!(await deps.limiter.hit(`token:${clientId}:${ipHash(deps, req)}`, 60, 60))) return fail(429, 'slow_down');
    const client = await getClient(deps.db, clientId);
    if (!client || !verifyClientSecret(cfg.secret, client, clientSecret)) return fail(401, 'invalid_client');

    const codeHash = keyedHash(cfg.secret, 'code', b.code);
    // Single use, atomically: a second presentation of the same code finds nothing.
    const row = await one<SessionRow>(
      deps.db,
      `update liveid_sessions set auth_code_used_at = now()
        where auth_code_hash = $1 and auth_code_used_at is null and auth_code_expires_at > now() and status = 'completed'
        returning *`,
      [codeHash],
    );
    if (!row) {
      const reused = await one<{ id: string; client_id: string }>(deps.db, 'select id, client_id from liveid_sessions where auth_code_hash = $1', [codeHash]);
      if (reused) await audit(deps, reused, 'code.rejected', { reason: 'used_or_expired' });
      return fail(400, 'invalid_grant');
    }
    if (row.client_id !== client.id || row.redirect_uri !== b.redirect_uri || !verifyPkce(b.code_verifier, row.code_challenge)) {
      await audit(deps, row, 'code.rejected', { reason: 'binding_mismatch' });
      return fail(400, 'invalid_grant');
    }

    const claims: Record<string, unknown> = {
      auth_time: Math.floor((row.completed_at ?? new Date()).getTime() / 1000),
    };
    if (row.nonce) claims.nonce = row.nonce;
    if (row.scopes.includes('phone') && row.phone_sealed && row.phone_verified_at) {
      claims.phone_number = deps.sealer.open(row.phone_sealed, `session:${row.id}:phone`);
      claims.phone_number_verified = true;
    }
    if (row.scopes.includes('email') && row.email_sealed && row.email_verified_at) {
      claims.email = deps.sealer.open(row.email_sealed, `session:${row.id}:email`);
      claims.email_verified = true;
    }
    const liveness = row.liveness_passed_at !== null;
    const idMatched = row.id_matched_at !== null;
    claims.liveid = {
      level: idMatched ? 'premium' : liveness ? 'live' : 'basic',
      phone_verified: !!row.phone_verified_at,
      email_verified: !!row.email_verified_at,
      liveness: liveness ? { passed: true, at: Math.floor(row.liveness_passed_at!.getTime() / 1000) } : { passed: false },
      id_document: idMatched
        ? { matched: true, at: Math.floor(row.id_matched_at!.getTime() / 1000), similarity: (row.id_report as { similarity?: number } | null)?.similarity ?? null }
        : { matched: false },
      risk: { score: row.risk.score ?? 0, signals: [...(row.risk.hard ?? []), ...(row.risk.soft ?? [])] },
      session: row.id,
    };
    // Pairwise subject: stable for one person (phone, else email) at one site, unlinkable across sites.
    const anchor = row.phone_hash ?? row.email_hash ?? `session:${row.id}`;
    const sub = keyedHash(cfg.secret, 'sub', client.id, anchor).slice(0, 40);
    const idToken = await signIdToken(deps.keys, claims, { issuer: cfg.issuer, audience: client.id, subject: sub, ttlSeconds: 600 });
    await audit(deps, row, 'token.issued', { level: (claims.liveid as { level: string }).level });
    return { token_type: 'Bearer', id_token: idToken, expires_in: 600, scope: row.scopes.join(' ') };
  });
}
