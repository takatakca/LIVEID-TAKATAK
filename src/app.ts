import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import type { Deps } from './deps.js';
import { FlowError } from './lib/errors.js';
import { flowRoutes } from './flow/routes.js';
import { oauthRoutes } from './oauth/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(here, '..', 'public');

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function buildApp(deps: Deps, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger
      ? { level: deps.cfg.isProd ? 'info' : 'debug', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-liveid-csrf"]'] }
      : false,
    trustProxy: deps.cfg.trustProxy,
    bodyLimit: 64 * 1024,
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(multipart, {
    limits: { fileSize: 6 * 1024 * 1024, files: 230, fields: 10, fieldSize: 64 * 1024, parts: 250 },
  });
  if (existsSync(PUBLIC_DIR)) {
    await app.register(fastifyStatic, { root: path.join(PUBLIC_DIR, 'assets'), prefix: '/assets/', maxAge: '1h', index: false });
  }

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()');
    reply.header('Content-Security-Policy', CSP);
    // The popup must keep `window.opener` to hand the code back to the site that opened it.
    reply.header('Cross-Origin-Opener-Policy', 'unsafe-none');
    if (deps.cfg.publicUrl.startsWith('https://')) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof FlowError) {
      return reply.status(err.status).send({ error: err.code, ...(err.detail ?? {}) });
    }
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid_input' });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: status === 413 ? 'file_too_large' : 'bad_request' });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'server_error' });
  });

  app.get('/healthz', async () => {
    await deps.db.query('select 1');
    return { ok: true, service: 'liveid-takatak' };
  });

  app.get('/', async (_req, reply) => reply.redirect('/.well-known/openid-configuration'));

  await oauthRoutes(app, deps);
  await flowRoutes(app, deps);
  return app;
}
