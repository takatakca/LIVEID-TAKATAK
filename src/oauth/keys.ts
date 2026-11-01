import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, SignJWT, type JWK, type CryptoKey } from 'jose';

export interface SigningKeys {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

export async function generateSigningJwk(): Promise<JWK> {
  const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const jwk = await exportJWK(privateKey);
  return { ...jwk, alg: 'EdDSA', use: 'sig' };
}

/** Loads the Ed25519 signing key from a private JWK JSON string, or creates a throwaway one (dev/test only). */
export async function loadSigningKeys(privateJwkJson: string | undefined, allowEphemeral: boolean): Promise<SigningKeys & { ephemeral: boolean }> {
  let jwk: JWK;
  let ephemeral = false;
  if (privateJwkJson) {
    jwk = JSON.parse(privateJwkJson) as JWK;
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.d) throw new Error('LIVEID_SIGNING_KEY must be an Ed25519 private JWK');
  } else {
    if (!allowEphemeral) throw new Error('LIVEID_SIGNING_KEY is required');
    jwk = await generateSigningJwk();
    ephemeral = true;
  }
  const publicJwk: JWK = { kty: 'OKP', crv: 'Ed25519', x: jwk.x, alg: 'EdDSA', use: 'sig' };
  const kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  const privateKey = (await importJWK({ ...jwk, alg: 'EdDSA' }, 'EdDSA')) as CryptoKey;
  return { kid, privateKey, publicJwk, ephemeral };
}

export async function signIdToken(
  keys: SigningKeys,
  claims: Record<string, unknown>,
  opts: { issuer: string; audience: string; subject: string; ttlSeconds: number },
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'EdDSA', kid: keys.kid, typ: 'JWT' })
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setSubject(opts.subject)
    .setIssuedAt()
    .setExpirationTime(`${opts.ttlSeconds}s`)
    .sign(keys.privateKey);
}
