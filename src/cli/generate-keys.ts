import { randomBytes } from 'node:crypto';
import { generateSigningJwk } from '../oauth/keys.js';

/** Prints fresh secrets for a new environment. Paste them into Coolify secrets, never into git or notes. */
const jwk = await generateSigningJwk();
console.log(`LIVEID_SECRET=${randomBytes(48).toString('base64url')}`);
console.log(`LIVEID_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
console.log(`LIVEID_SIGNING_KEY='${JSON.stringify(jwk)}'`);
