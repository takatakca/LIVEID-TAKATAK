import { parseArgs } from 'node:util';
import { loadConfig } from '../config.js';
import { createPool, migrate } from '../db/pool.js';
import { createClient } from '../oauth/clients.js';

/**
 * Registers a website that may send people to LIVE ID.
 *   npm run client:create -- --id takatak-web --name "GROUPE TAKATAK" --redirect https://takatak.ca/auth/liveid/callback
 * The secret is printed ONCE. Store it in that website's secrets (Coolify), never in a file or a note.
 */
const { values } = parseArgs({
  options: {
    id: { type: 'string' },
    name: { type: 'string' },
    redirect: { type: 'string', multiple: true },
    scopes: { type: 'string' },
  },
});
if (!values.id || !values.name || !values.redirect?.length) {
  console.error('Usage: npm run client:create -- --id <id> --name <name> --redirect <https://...> [--redirect ...] [--scopes "openid phone email liveness id_document"]');
  process.exit(2);
}
const cfg = loadConfig();
const db = createPool(cfg.databaseUrl, cfg.databaseSsl);
await migrate(db);
const c = await createClient(db, cfg.secret, {
  id: values.id,
  name: values.name,
  redirectUris: values.redirect,
  scopes: values.scopes?.split(/\s+/).filter(Boolean),
});
console.log(`client_id=${c.id}`);
console.log(`client_secret=${c.secret}`);
console.log('Shown once. Put it in the website secrets now.');
await db.end();
