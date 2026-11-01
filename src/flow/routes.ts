import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { many, one } from '../db/pool.js';
import { keyedHash, numericCode, randomToken, safeEqual } from '../lib/crypto.js';
import { FlowError } from '../lib/errors.js';
import { DEFAULT_PLAN, newChallenge, type ChallengePlan, type Move } from '../liveness/challenge.js';
import { verifyLiveness } from '../liveness/verify.js';
import { verifyIdFront } from '../idcheck/verify.js';
import { getClient } from '../oauth/clients.js';
import { emailContent, maskEmail, maskPhone, smsText } from './messages.js';
import { assessRisk, clientSignalsSchema, isDisposableEmail, mergeRisk, type ClientSignals } from './risk.js';
import {
  audit,
  ipHash,
  MAX_ID_ATTEMPTS,
  MAX_LIVENESS_ATTEMPTS,
  nextStep,
  noStore,
  plannedSteps,
  requirePending,
  requireSession,
  requireStep,
  stepDone,
  type SessionRow,
} from './session.js';

const OTP_TTL_SECONDS = 600;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 30;
const OTP_MAX_PER_SESSION = 5;
const CHALLENGE_TTL_SECONDS = 180;
const MAX_CHALLENGES = 8;
const MAX_FRAME_BYTES = 400 * 1024;
const MAX_FRAMES = 220;
const MAX_TOTAL_FRAME_BYTES = 24 * 1024 * 1024;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_ID_IMAGE_BYTES = 6 * 1024 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const FLOW_HTML = path.resolve(here, '..', '..', 'web', 'flow.html');

async function readMultipart(req: FastifyRequest): Promise<{ fields: Record<string, string>; files: Array<{ field: string; data: Buffer; mimetype: string }> }> {
  if (!req.isMultipart()) throw new FlowError('multipart_required', 415);
  const fields: Record<string, string> = {};
  const files: Array<{ field: string; data: Buffer; mimetype: string }> = [];
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const data = await part.toBuffer();
      if (part.file.truncated) throw new FlowError('file_too_large', 413);
      files.push({ field: part.fieldname, data, mimetype: part.mimetype });
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { fields, files };
}

function isJpegOrPng(b: Buffer): boolean {
  return (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47);
}

function publicState(deps: Deps, row: SessionRow, clientName: string) {
  const steps = plannedSteps(row.scopes).map((s) => ({ step: s, done: stepDone(row, s) }));
  return {
    client: { id: row.client_id, name: clientName },
    status: row.status,
    locale: row.locale,
    display: row.display,
    csrf: row.csrf_token,
    steps,
    next: row.status === 'pending' ? nextStep(row) : null,
    phone: row.phone_sealed ? maskPhone(deps.sealer.open(row.phone_sealed, `session:${row.id}:phone`)) : null,
    email: row.email_sealed ? maskEmail(deps.sealer.open(row.email_sealed, `session:${row.id}:email`)) : null,
    attempts: {
      livenessLeft: Math.max(0, MAX_LIVENESS_ATTEMPTS - row.liveness_attempts),
      idLeft: Math.max(0, MAX_ID_ATTEMPTS - row.id_attempts),
    },
    expiresAt: row.expires_at.toISOString(),
  };
}

async function failSession(deps: Deps, row: SessionRow, reason: string): Promise<void> {
  await deps.db.query(`update liveid_sessions set status = 'failed', face_template_sealed = null where id = $1 and status = 'pending'`, [row.id]);
  await audit(deps, row, 'session.failed', { reason });
}

export async function flowRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { cfg } = deps;
  const host = new URL(cfg.publicUrl).host;
  let flowHtml: string | undefined;

  app.get('/flow', async (_req, reply) => {
    flowHtml ??= await readFile(FLOW_HTML, 'utf8');
    noStore(reply);
    return reply.type('text/html; charset=utf-8').send(flowHtml);
  });

  app.get('/api/flow/state', async (req, reply) => {
    noStore(reply);
    const row = await requireSession(deps, req, { csrf: false });
    const client = await getClient(deps.db, row.client_id);
    return publicState(deps, row, client?.name ?? row.client_id);
  });

  // ---- Consent ("Accept" / "Refuse") ---------------------------------------------------------------
  app.post('/api/flow/consent', async (req) => {
    const body = z.object({ accept: z.boolean(), signals: clientSignalsSchema.optional() }).parse(req.body);
    const row = await requireSession(deps, req);
    requireStep(row, 'consent');
    const risk = mergeRisk(row.risk, assessRisk(req.headers['user-agent'], body.signals));
    if (!body.accept) {
      await deps.db.query(`update liveid_sessions set status = 'denied', risk = $2 where id = $1`, [row.id, JSON.stringify(risk)]);
      await audit(deps, row, 'consent.denied');
      return { ok: true, redirect: errorRedirect(row, 'access_denied') };
    }
    if (cfg.blockAutomation && risk.hard.length) {
      await deps.db.query(`update liveid_sessions set risk = $2 where id = $1`, [row.id, JSON.stringify(risk)]);
      await failSession(deps, row, 'automation');
      throw new FlowError('automation_detected', 403, { signals: risk.hard });
    }
    await deps.db.query(`update liveid_sessions set consented_at = now(), risk = $2 where id = $1`, [row.id, JSON.stringify(risk)]);
    await audit(deps, row, 'consent.accepted', { risk: risk.score });
    return { ok: true };
  });

  // ---- Phone and email codes -------------------------------------------------------------------------
  async function startOtp(req: FastifyRequest, channel: 'sms' | 'email', rawTarget: string, signals?: ClientSignals) {
    const row = await requireSession(deps, req);
    requireStep(row, channel === 'sms' ? 'phone' : 'email');
    const ip = ipHash(deps, req);

    // Codes are now the first thing a person does: robots are stopped before any SMS or email goes out.
    const risk = mergeRisk(row.risk, assessRisk(req.headers['user-agent'], signals));
    await deps.db.query('update liveid_sessions set risk = $2 where id = $1', [row.id, JSON.stringify(risk)]);
    if (cfg.blockAutomation && risk.hard.length) {
      await failSession(deps, row, 'automation');
      throw new FlowError('automation_detected', 403, { signals: risk.hard });
    }

    let target: string;
    if (channel === 'sms') {
      const parsed = parsePhoneNumberFromString(rawTarget, 'CA');
      if (!parsed || !parsed.isValid()) throw new FlowError('phone_invalid');
      if (!cfg.sms.allowedCountries.includes((parsed.country ?? '') as CountryCode)) throw new FlowError('phone_country_not_supported');
      target = parsed.number;
    } else {
      const email = rawTarget.trim().toLowerCase();
      if (!z.email().safeParse(email).success || email.length > 254) throw new FlowError('email_invalid');
      if (isDisposableEmail(email)) throw new FlowError('email_disposable');
      target = email;
    }
    const targetHash = keyedHash(cfg.secret, channel, target);

    const recent = await many<{ created_at: Date }>(
      deps.db,
      'select created_at from liveid_otps where session_id = $1 and channel = $2 order by created_at desc',
      [row.id, channel],
    );
    if (recent.length >= OTP_MAX_PER_SESSION) throw new FlowError('too_many_codes', 429);
    const last = recent[0];
    if (last && Date.now() - last.created_at.getTime() < OTP_RESEND_SECONDS * 1000) {
      throw new FlowError('resend_too_soon', 429, { retryAfter: OTP_RESEND_SECONDS });
    }
    if (!(await deps.limiter.hit(`otp:${channel}:${targetHash}`, 3, 900))) throw new FlowError('too_many_codes', 429);
    if (!(await deps.limiter.hit(`otp:ip:${ip}`, 10, 3600))) throw new FlowError('too_many_codes', 429);

    if (channel === 'sms' && cfg.sms.lookupLineType && deps.sms.lineType) {
      const type = await deps.sms.lineType(target).catch(() => 'unknown');
      if (type === 'voip' || type === 'landline') {
        await audit(deps, row, 'otp.rejected', { channel, reason: `line_${type}` });
        throw new FlowError('phone_not_mobile');
      }
    }

    const otpId = randomUUID();
    const code = numericCode(6);
    const column = channel === 'sms' ? 'phone' : 'email';
    await deps.db.query('update liveid_otps set consumed_at = now() where session_id = $1 and channel = $2 and consumed_at is null', [row.id, channel]);
    await deps.db.query(
      `insert into liveid_otps (id, session_id, channel, target_hash, code_hash, expires_at)
       values ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
      [otpId, row.id, channel, targetHash, keyedHash(cfg.secret, 'otp', otpId, code), OTP_TTL_SECONDS],
    );
    await deps.db.query(`update liveid_sessions set ${column}_sealed = $2, ${column}_hash = $3, ${column}_verified_at = null where id = $1`, [
      row.id,
      deps.sealer.seal(target, `session:${row.id}:${column}`),
      targetHash,
    ]);
    try {
      if (channel === 'sms') await deps.sms.send(target, smsText(row.locale, code, host));
      else {
        const m = emailContent(row.locale, code);
        await deps.email.send(target, m.subject, m.text, m.html);
      }
    } catch (err) {
      req.log.error({ err: (err as Error).message, channel }, 'otp send failed');
      await deps.db.query('delete from liveid_otps where id = $1', [otpId]);
      throw new FlowError('send_failed', 502);
    }
    await audit(deps, row, 'otp.sent', { channel });
    return { sent: true, to: channel === 'sms' ? maskPhone(target) : maskEmail(target), expiresIn: OTP_TTL_SECONDS, resendIn: OTP_RESEND_SECONDS };
  }

  async function verifyOtp(req: FastifyRequest, channel: 'sms' | 'email', code: string) {
    const row = await requireSession(deps, req);
    requireStep(row, channel === 'sms' ? 'phone' : 'email');
    const otp = await one<{ id: string; target_hash: string; code_hash: string; expires_at: Date }>(
      deps.db,
      `select id, target_hash, code_hash, expires_at from liveid_otps
        where session_id = $1 and channel = $2 and consumed_at is null order by created_at desc limit 1`,
      [row.id, channel],
    );
    if (!otp) throw new FlowError('code_missing');
    if (otp.expires_at.getTime() < Date.now()) throw new FlowError('code_expired');
    const counted = await one<{ attempts: number }>(
      deps.db,
      'update liveid_otps set attempts = attempts + 1 where id = $1 and attempts < $2 returning attempts',
      [otp.id, OTP_MAX_ATTEMPTS],
    );
    if (!counted) throw new FlowError('too_many_attempts', 429);
    const sessionHash = channel === 'sms' ? row.phone_hash : row.email_hash;
    const ok = safeEqual(otp.code_hash, keyedHash(cfg.secret, 'otp', otp.id, code)) && sessionHash === otp.target_hash;
    if (!ok) {
      await audit(deps, row, 'otp.failed', { channel, attempts: counted.attempts });
      throw new FlowError('code_invalid', 400, { attemptsLeft: OTP_MAX_ATTEMPTS - counted.attempts });
    }
    await deps.db.query('update liveid_otps set consumed_at = now() where id = $1', [otp.id]);
    const column = channel === 'sms' ? 'phone' : 'email';
    await deps.db.query(`update liveid_sessions set ${column}_verified_at = now() where id = $1`, [row.id]);
    await audit(deps, row, 'otp.verified', { channel });
    return { verified: true };
  }

  const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
  const phoneBody = z.object({ phone: z.string().min(1).max(32), signals: clientSignalsSchema.optional() });
  const emailBody = z.object({ email: z.string().min(1).max(254), signals: clientSignalsSchema.optional() });
  app.post('/api/flow/phone/start', async (req) => {
    const b = phoneBody.parse(req.body);
    return startOtp(req, 'sms', b.phone, b.signals);
  });
  app.post('/api/flow/phone/verify', async (req) => verifyOtp(req, 'sms', codeSchema.parse(req.body).code));
  app.post('/api/flow/email/start', async (req) => {
    const b = emailBody.parse(req.body);
    return startOtp(req, 'email', b.email, b.signals);
  });
  app.post('/api/flow/email/verify', async (req) => verifyOtp(req, 'email', codeSchema.parse(req.body).code));

  // ---- Live check -------------------------------------------------------------------------------------
  app.post('/api/flow/liveness/challenge', async (req) => {
    const body = z.object({ signals: clientSignalsSchema.optional() }).parse(req.body ?? {});
    const row = await requireSession(deps, req);
    requireStep(row, 'liveness');
    if (row.liveness_attempts >= MAX_LIVENESS_ATTEMPTS) throw new FlowError('too_many_attempts', 429);
    const risk = mergeRisk(row.risk, assessRisk(req.headers['user-agent'], body.signals));
    await deps.db.query('update liveid_sessions set risk = $2 where id = $1', [row.id, JSON.stringify(risk)]);
    if (cfg.blockAutomation && risk.hard.length) {
      await failSession(deps, row, 'automation');
      throw new FlowError('automation_detected', 403, { signals: risk.hard });
    }
    // Each challenge is new random digits and moves: cap them so a bot cannot farm challenges for free.
    const issued = await one<{ n: number }>(deps.db, 'select count(*)::int as n from liveid_challenges where session_id = $1', [row.id]);
    if ((issued?.n ?? 0) >= MAX_CHALLENGES) {
      await failSession(deps, row, 'too_many_challenges');
      throw new FlowError('too_many_attempts', 429);
    }
    const ch = newChallenge(DEFAULT_PLAN);
    await deps.db.query('update liveid_challenges set used_at = now() where session_id = $1 and used_at is null', [row.id]);
    const created = await one<{ id: string; expires_at: Date }>(
      deps.db,
      `insert into liveid_challenges (session_id, digits, moves, plan, expires_at)
       values ($1, $2, $3, $4, now() + make_interval(secs => $5)) returning id, expires_at`,
      [row.id, ch.digits, ch.moves, JSON.stringify(ch.plan), CHALLENGE_TTL_SECONDS],
    );
    await audit(deps, row, 'liveness.challenge');
    return { challengeId: created!.id, digits: ch.digits, moves: ch.moves, plan: ch.plan, expiresAt: created!.expires_at.toISOString() };
  });

  const metaSchema = z.object({
    frames: z.array(z.number().min(0).max(120_000)).max(MAX_FRAMES),
    speakWindow: z.object({ start: z.number().min(0).max(60_000), end: z.number().min(0).max(60_000) }).optional(),
    signals: clientSignalsSchema.optional(),
  });

  app.post('/api/flow/liveness/submit', async (req) => {
    const row = await requireSession(deps, req);
    requireStep(row, 'liveness');
    if (row.liveness_attempts >= MAX_LIVENESS_ATTEMPTS) throw new FlowError('too_many_attempts', 429);
    const { fields, files } = await readMultipart(req);
    const submittedAt = new Date();
    const challengeId = z.uuid().safeParse(fields.challengeId);
    if (!challengeId.success) throw new FlowError('challenge_invalid');
    let meta: z.infer<typeof metaSchema>;
    try {
      meta = metaSchema.parse(JSON.parse(fields.meta ?? '{}'));
    } catch {
      throw new FlowError('meta_invalid');
    }
    const frameFiles = files.filter((f) => f.field === 'frame');
    const audioFile = files.find((f) => f.field === 'audio');
    if (frameFiles.length !== meta.frames.length) throw new FlowError('meta_invalid');
    if (frameFiles.some((f) => f.data.length > MAX_FRAME_BYTES || !isJpegOrPng(f.data))) throw new FlowError('frame_invalid');
    if (frameFiles.reduce((s, f) => s + f.data.length, 0) > MAX_TOTAL_FRAME_BYTES) throw new FlowError('file_too_large', 413);
    if (audioFile && audioFile.data.length > MAX_AUDIO_BYTES) throw new FlowError('file_too_large', 413);

    // The challenge works once, for this session, before it expires.
    const ch = await one<{ id: string; digits: string; moves: Move[]; plan: ChallengePlan; issued_at: Date }>(
      deps.db,
      `update liveid_challenges set used_at = now()
        where id = $1 and session_id = $2 and used_at is null and expires_at > now()
        returning id, digits, moves, plan, issued_at`,
      [challengeId.data, row.id],
    );
    if (!ch) throw new FlowError('challenge_invalid');
    const attempts = (await one<{ liveness_attempts: number }>(
      deps.db,
      'update liveid_sessions set liveness_attempts = liveness_attempts + 1 where id = $1 returning liveness_attempts',
      [row.id],
    ))!.liveness_attempts;

    const risk = mergeRisk(row.risk, assessRisk(req.headers['user-agent'], meta.signals));
    if (cfg.blockAutomation && risk.hard.length) {
      await deps.db.query('update liveid_sessions set risk = $2 where id = $1', [row.id, JSON.stringify(risk)]);
      await failSession(deps, row, 'automation');
      throw new FlowError('automation_detected', 403, { signals: risk.hard });
    }

    const outcome = await verifyLiveness(
      {
        digits: ch.digits,
        moves: ch.moves,
        plan: ch.plan,
        issuedAt: ch.issued_at,
        submittedAt,
        frames: frameFiles.map((f, i) => ({ t: meta.frames[i]!, image: f.data })),
        audio: audioFile?.data ?? null,
        speakWindow: meta.speakWindow,
        locale: row.locale,
      },
      { analyzer: deps.analyzer, recognizer: deps.recognizer, thresholds: cfg.thresholds, requireSpeech: cfg.isProd },
    );
    const r = outcome.report;
    if (r.passed) {
      await deps.db.query(
        `update liveid_sessions set liveness_passed_at = now(), liveness_report = $2, face_template_sealed = $3, risk = $4 where id = $1`,
        [row.id, JSON.stringify(r), deps.sealer.seal(JSON.stringify(outcome.templates), `session:${row.id}:face`), JSON.stringify(risk)],
      );
      await audit(deps, row, 'liveness.passed', { attempts });
    } else {
      await deps.db.query('update liveid_sessions set liveness_report = $2, risk = $3 where id = $1', [row.id, JSON.stringify(r), JSON.stringify(risk)]);
      await audit(deps, row, 'liveness.failed', { attempts, reasons: r.reasons });
      if (attempts >= MAX_LIVENESS_ATTEMPTS) await failSession(deps, row, 'liveness');
    }
    return { passed: r.passed, reasons: r.reasons, attemptsLeft: Math.max(0, MAX_LIVENESS_ATTEMPTS - attempts) };
  });

  // ---- ID front ---------------------------------------------------------------------------------------
  app.post('/api/flow/id/submit', async (req) => {
    const row = await requireSession(deps, req);
    requireStep(row, 'id_document');
    if (row.id_attempts >= MAX_ID_ATTEMPTS) throw new FlowError('too_many_attempts', 429);
    const { files } = await readMultipart(req);
    const image = files.find((f) => f.field === 'image');
    if (!image || image.data.length > MAX_ID_IMAGE_BYTES || !isJpegOrPng(image.data)) throw new FlowError('image_invalid');
    if (!row.face_template_sealed) {
      await failSession(deps, row, 'face_template_missing');
      throw new FlowError('liveness_required', 409);
    }
    const attempts = (await one<{ id_attempts: number }>(
      deps.db,
      'update liveid_sessions set id_attempts = id_attempts + 1 where id = $1 returning id_attempts',
      [row.id],
    ))!.id_attempts;
    const templates = JSON.parse(deps.sealer.open(row.face_template_sealed, `session:${row.id}:face`)) as number[][];
    const rep = await verifyIdFront(deps.analyzer, deps.idReader, image.data, templates, cfg.thresholds);
    if (rep.passed) {
      // The face template has done its job: wipe it now.
      await deps.db.query('update liveid_sessions set id_matched_at = now(), id_report = $2, face_template_sealed = null where id = $1', [
        row.id,
        JSON.stringify(rep),
      ]);
      await audit(deps, row, 'id.passed', { attempts, similarity: rep.similarity });
    } else {
      await deps.db.query('update liveid_sessions set id_report = $2 where id = $1', [row.id, JSON.stringify(rep)]);
      await audit(deps, row, 'id.failed', { attempts, reason: rep.reason });
      if (!rep.retryable || attempts >= MAX_ID_ATTEMPTS) await failSession(deps, row, rep.reason ?? 'id');
    }
    const left = rep.retryable ? Math.max(0, MAX_ID_ATTEMPTS - attempts) : 0;
    return { passed: rep.passed, reason: rep.reason ?? null, attemptsLeft: left };
  });

  // ---- Finish / cancel --------------------------------------------------------------------------------
  function errorRedirect(row: SessionRow, error: string): string {
    const u = new URL(row.redirect_uri);
    u.searchParams.set('error', error);
    u.searchParams.set('state', row.state);
    return u.toString();
  }

  app.post('/api/flow/finish', async (req) => {
    const row = await requireSession(deps, req);
    requirePending(row);
    if (nextStep(row) !== 'done') throw new FlowError('steps_incomplete', 409, { next: nextStep(row) });
    const code = randomToken(32);
    const updated = await one<{ id: string }>(
      deps.db,
      `update liveid_sessions set status = 'completed', completed_at = now(), face_template_sealed = null,
         auth_code_hash = $2, auth_code_expires_at = now() + interval '2 minutes'
       where id = $1 and status = 'pending' returning id`,
      [row.id, keyedHash(cfg.secret, 'code', code)],
    );
    if (!updated) throw new FlowError('session_completed', 409);
    await audit(deps, row, 'code.issued');
    const redirect = new URL(row.redirect_uri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', row.state);
    if (row.display === 'popup') {
      return { mode: 'popup', targetOrigin: redirect.origin, code, state: row.state, fallback: redirect.toString() };
    }
    return { mode: 'redirect', redirect: redirect.toString() };
  });

  app.post('/api/flow/cancel', async (req) => {
    const row = await requireSession(deps, req);
    if (row.status === 'pending') {
      await deps.db.query(`update liveid_sessions set status = 'denied', face_template_sealed = null where id = $1`, [row.id]);
      await audit(deps, row, 'session.cancelled');
    }
    const error = row.status === 'failed' ? 'verification_failed' : 'access_denied';
    const url = errorRedirect(row, error);
    return row.display === 'popup'
      ? { mode: 'popup', targetOrigin: new URL(row.redirect_uri).origin, error, state: row.state, fallback: url }
      : { mode: 'redirect', redirect: url };
  });

  // ---- Development only ---------------------------------------------------------------------------------
  if (cfg.devOutbox && !cfg.isProd) {
    app.get('/dev/outbox', async () => deps.outbox.list());
  }
}
