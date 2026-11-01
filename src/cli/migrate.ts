import { loadConfig } from '../config.js';
import { createPool, migrate } from '../db/pool.js';

const cfg = loadConfig();
const db = createPool(cfg.databaseUrl, cfg.databaseSsl);
const applied = await migrate(db);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
await db.end();
