import type { Db } from '../db/pool.js';

/**
 * Data minimisation, run every few minutes:
 * - face templates are wiped as soon as a session is no longer waiting for the ID step;
 * - stale sessions are marked expired;
 * - sessions (with their sealed phone/email) are deleted after the retention period;
 * - audit rows carry no personal data and are kept 12× longer.
 */
export async function purge(db: Db, retentionDays: number): Promise<void> {
  await db.query(
    `update liveid_sessions set face_template_sealed = null
      where face_template_sealed is not null and (expires_at < now() or status <> 'pending' or id_matched_at is not null)`,
  );
  await db.query(`update liveid_sessions set status = 'expired' where status = 'pending' and expires_at < now()`);
  await db.query(`delete from liveid_sessions where created_at < now() - make_interval(days => $1)`, [retentionDays]);
  await db.query(`delete from liveid_rate_limits where window_start < now() - interval '1 day'`);
  await db.query(`delete from liveid_audit where created_at < now() - make_interval(days => $1)`, [retentionDays * 12]);
}
