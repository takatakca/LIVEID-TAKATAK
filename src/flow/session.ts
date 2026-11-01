import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../deps.js';
import { one } from '../db/pool.js';
import { keyedHash, safeEqual } from '../lib/crypto.js';
import { FlowError } from '../lib/errors.js';

export interface SessionRow {
  id: string;
  client_id: string;
  browser_token_hash: string;
  csrf_token: string;
  redirect_uri: string;
  state: string;
  nonce: string | null;
  scopes: string[];
  code_challenge: string;
  display: 'page' | 'popup';
  locale: 'fr' | 'en';
  status: 'pending' | 'completed' | 'denied' | 'failed' | 'expired';
  consented_at: Date | null;
  phone_sealed: string | null;
  phone_hash: string | null;
  phone_verified_at: Date | null;
  email_sealed: string | null;
  email_hash: string | null;
  email_verified_at: Date | null;
  liveness_attempts: number;
  liveness_passed_at: Date | null;
  liveness_report: Record<string, unknown> | null;
  face_template_sealed: string | null;
  id_attempts: number;
  id_matched_at: Date | null;
  id_report: Record<string, unknown> | null;
  risk: { score?: number; hard?: string[]; soft?: string[] };
  auth_code_hash: string | null;
  auth_code_expires_at: Date | null;
  auth_code_used_at: Date | null;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: Date;
  expires_at: Date;
  completed_at: Date | null;
}

export type Step = 'consent' | 'phone' | 'email' | 'liveness' | 'id_document';

/**
 * Matt's order (2026-11-01): email first, then the mobile number, then "accept all the terms",
 * then the live check (the video starts right after the terms), then the ID front.
 */
export function plannedSteps(scopes: string[]): Step[] {
  const s: Step[] = [];
  if (scopes.includes('email')) s.push('email');
  if (scopes.includes('phone')) s.push('phone');
  s.push('consent');
  if (scopes.includes('liveness') || scopes.includes('id_document')) s.push('liveness');
  if (scopes.includes('id_document')) s.push('id_document');
  return s;
}

export function stepDone(row: SessionRow, step: Step): boolean {
  switch (step) {
    case 'consent':
      return !!row.consented_at;
    case 'phone':
      return !!row.phone_verified_at;
    case 'email':
      return !!row.email_verified_at;
    case 'liveness':
      return !!row.liveness_passed_at;
    case 'id_document':
      return !!row.id_matched_at;
  }
}

export function nextStep(row: SessionRow): Step | 'done' {
  for (const s of plannedSteps(row.scopes)) if (!stepDone(row, s)) return s;
  return 'done';
}

export const MAX_LIVENESS_ATTEMPTS = 3;
export const MAX_ID_ATTEMPTS = 3;

export function cookieName(deps: Deps): string {
  return deps.cfg.publicUrl.startsWith('https://') ? '__Host-liveid' : 'liveid_sid';
}

export function ipHash(deps: Deps, req: FastifyRequest): string {
  return keyedHash(deps.cfg.secret, 'ip', req.ip);
}

/**
 * Loads the session of the browser making this request. Requires the session cookie and, for
 * state-changing calls, the CSRF header that only our own page can read and send.
 */
export async function requireSession(deps: Deps, req: FastifyRequest, opts: { csrf: boolean } = { csrf: true }): Promise<SessionRow> {
  const token = req.cookies[cookieName(deps)];
  if (!token) throw new FlowError('session_missing', 401);
  const row = await one<SessionRow>(deps.db, 'select * from liveid_sessions where browser_token_hash = $1', [
    keyedHash(deps.cfg.secret, 'browser', token),
  ]);
  if (!row) throw new FlowError('session_missing', 401);
  if (opts.csrf) {
    const header = req.headers['x-liveid-csrf'];
    if (typeof header !== 'string' || !safeEqual(header, row.csrf_token)) throw new FlowError('csrf_invalid', 403);
  }
  if (row.status === 'pending' && row.expires_at.getTime() < Date.now()) {
    await deps.db.query(`update liveid_sessions set status = 'expired', face_template_sealed = null where id = $1`, [row.id]);
    row.status = 'expired';
  }
  return row;
}

export function requirePending(row: SessionRow): void {
  if (row.status !== 'pending') throw new FlowError(`session_${row.status}`, 409);
}

export function requireStep(row: SessionRow, step: Step): void {
  requirePending(row);
  const next = nextStep(row);
  if (next !== step) throw new FlowError('wrong_step', 409, { expected: next });
}

export async function audit(deps: Deps, row: Pick<SessionRow, 'id' | 'client_id'> | null, event: string, detail: Record<string, unknown> = {}): Promise<void> {
  await deps.db.query('insert into liveid_audit (session_id, client_id, event, detail) values ($1, $2, $3, $4)', [
    row?.id ?? null,
    row?.client_id ?? null,
    event,
    JSON.stringify(detail),
  ]);
}

export function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}
