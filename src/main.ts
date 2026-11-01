import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { migrate } from './db/pool.js';
import { purge } from './flow/purge.js';
import { createDeps } from './runtime.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const deps = await createDeps(cfg, (m) => console.log(m));
  if (deps.ephemeralKey) console.warn('[liveid] LIVEID_SIGNING_KEY not set: using a throwaway key (development only).');
  const applied = await migrate(deps.db);
  if (applied.length) console.log(`[liveid] migrations applied: ${applied.join(', ')}`);
  await deps.analyzer.ready();
  const app = await buildApp(deps, { logger: true });
  const timer = setInterval(() => {
    purge(deps.db, cfg.retentionDays).catch((err) => app.log.error({ err }, 'purge failed'));
  }, 5 * 60_000);
  timer.unref();
  await purge(deps.db, cfg.retentionDays);

  const shutdown = async () => {
    clearInterval(timer);
    await app.close();
    await deps.idReader?.close?.();
    await deps.db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await app.listen({ host: cfg.host, port: cfg.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
