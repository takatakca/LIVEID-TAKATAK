import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadConfig, type Config } from '../../src/config.js';
import type { Deps } from '../../src/deps.js';
import { createPool, migrate } from '../../src/db/pool.js';
import { Sealer } from '../../src/lib/crypto.js';
import { PgRateLimiter } from '../../src/lib/rate-limit.js';
import { loadSigningKeys } from '../../src/oauth/keys.js';
import { ConsoleEmail, ConsoleSms, DevOutbox } from '../../src/providers/messaging.js';
import { FakeFaceAnalyzer, FakeReader, FakeRecognizer } from './fakes.js';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://liveid:liveid@127.0.0.1:5432/liveid_test';

export function testEnv(over: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PUBLIC_URL: 'http://localhost:8080',
    DATABASE_URL: TEST_DB_URL,
    LIVEID_SECRET: randomBytes(32).toString('hex'),
    LIVEID_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SPEECH_PROVIDER: 'none',
    BLOCK_AUTOMATION: 'true',
    DEV_OUTBOX: 'true',
    ...over,
  };
}

/** Empties the test database (public schema) and applies the migrations. */
export async function resetDb(url = TEST_DB_URL): Promise<void> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('drop schema public cascade; create schema public;');
  await c.end();
}

export async function testDeps(over: Record<string, string> = {}): Promise<{ deps: Deps; cfg: Config; recognizer: FakeRecognizer; reader: FakeReader }> {
  const cfg = loadConfig(testEnv(over));
  const db = createPool(cfg.databaseUrl, false);
  await migrate(db);
  const outbox = new DevOutbox();
  const recognizer = new FakeRecognizer(() => '');
  const reader = new FakeReader();
  const deps: Deps = {
    cfg,
    db,
    keys: await loadSigningKeys(undefined, true),
    sealer: new Sealer(cfg.encryptionKey),
    limiter: new PgRateLimiter(db),
    sms: new ConsoleSms(outbox, () => undefined),
    email: new ConsoleEmail(outbox, () => undefined),
    outbox,
    analyzer: new FakeFaceAnalyzer(),
    recognizer,
    idReader: reader,
  };
  return { deps, cfg, recognizer, reader };
}
