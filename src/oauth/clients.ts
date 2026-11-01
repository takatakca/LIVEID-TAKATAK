import { keyedHash, randomToken, safeEqual } from '../lib/crypto.js';
import { one, type Db } from '../db/pool.js';

export const ALL_SCOPES = ['openid', 'phone', 'email', 'liveness', 'id_document'] as const;
export type Scope = (typeof ALL_SCOPES)[number];

export interface ClientRow {
  id: string;
  name: string;
  secret_hash: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  disabled_at: Date | null;
}

export async function getClient(db: Db, id: string): Promise<ClientRow | undefined> {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(id)) return undefined;
  const c = await one<ClientRow>(db, 'select * from liveid_clients where id = $1', [id]);
  return c && !c.disabled_at ? c : undefined;
}

export function hashClientSecret(secret: string, clientSecret: string): string {
  return keyedHash(secret, 'client-secret', clientSecret);
}

export function verifyClientSecret(serverSecret: string, client: ClientRow, presented: string): boolean {
  return safeEqual(client.secret_hash, hashClientSecret(serverSecret, presented));
}

/** A redirect URI must be https (or http on localhost for development) with no fragment. */
export function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export async function createClient(
  db: Db,
  serverSecret: string,
  input: { id: string; name: string; redirectUris: string[]; scopes?: string[] },
): Promise<{ id: string; secret: string }> {
  for (const r of input.redirectUris) if (!validRedirectUri(r)) throw new Error(`Invalid redirect URI: ${r}`);
  const scopes = input.scopes ?? [...ALL_SCOPES];
  for (const s of scopes) if (!(ALL_SCOPES as readonly string[]).includes(s)) throw new Error(`Unknown scope: ${s}`);
  const secret = `lid_${randomToken(32)}`;
  await db.query(
    `insert into liveid_clients (id, name, secret_hash, redirect_uris, allowed_scopes) values ($1, $2, $3, $4, $5)`,
    [input.id, input.name, hashClientSecret(serverSecret, secret), input.redirectUris, scopes],
  );
  return { id: input.id, secret };
}
