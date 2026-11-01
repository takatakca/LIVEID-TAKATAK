import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type Db = pg.Pool;

export function createPool(databaseUrl: string, ssl: boolean): Db {
  return new pg.Pool({
    connectionString: databaseUrl,
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
}

export async function one<T extends pg.QueryResultRow>(db: Db | pg.PoolClient, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

export async function many<T extends pg.QueryResultRow>(db: Db | pg.PoolClient, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query<T>(sql, params);
  return r.rows;
}

function migrationsDir(): string {
  // Works from src/ (tsx) and dist/ (compiled): both sit one level under the repo root.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'migrations');
}

/** Applies migrations/*.sql in name order, once each, inside a transaction with an advisory lock. */
export async function migrate(db: Db, dir = migrationsDir()): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('select pg_advisory_lock(77417001)');
    await client.query(
      'create table if not exists liveid_schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set((await client.query<{ name: string }>('select name from liveid_schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into liveid_schema_migrations(name) values ($1)', [f]);
        await client.query('commit');
        applied.push(f);
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(77417001)').catch(() => undefined);
    client.release();
  }
  return applied;
}
