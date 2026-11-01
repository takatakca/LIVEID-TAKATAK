import type { Db } from '../db/pool.js';

export interface RateLimiter {
  /** Counts one hit for `key`. Returns true while the count in the current window is within `limit`. */
  hit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

/** Fixed-window limiter in PostgreSQL: atomic upsert, works across several app replicas. */
export class PgRateLimiter implements RateLimiter {
  constructor(private readonly db: Db) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const r = await this.db.query<{ count: number }>(
      `insert into liveid_rate_limits (key, window_start, count) values ($1, now(), 1)
       on conflict (key) do update set
         count = case when liveid_rate_limits.window_start < now() - make_interval(secs => $2) then 1
                      else liveid_rate_limits.count + 1 end,
         window_start = case when liveid_rate_limits.window_start < now() - make_interval(secs => $2) then now()
                      else liveid_rate_limits.window_start end
       returning count`,
      [key, windowSeconds],
    );
    return (r.rows[0]?.count ?? Infinity) <= limit;
  }
}
