import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/** URL-safe random token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Uniform random numeric code (rejection-free: crypto.randomInt is unbiased). */
export function numericCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

/** Keyed hash of one or more parts. Parts are length-prefixed so ("ab","c") != ("a","bc"). */
export function keyedHash(secret: string, ...parts: string[]): string {
  const h = createHmac('sha256', secret);
  for (const p of parts) {
    const b = Buffer.from(p, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    h.update(len);
    h.update(b);
  }
  return h.digest('hex');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Compare against itself to keep timing flat, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('base64url');
}

/** RFC 7636 S256 check. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return safeEqual(sha256Base64Url(verifier), challenge);
}

/**
 * AES-256-GCM sealing with associated data. The AAD binds a ciphertext to its row and column
 * (for example `session:<id>:phone`) so a value cannot be copied to another row and still open.
 */
export class Sealer {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Sealer key must be 32 bytes');
  }

  seal(plaintext: string | Buffer, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
  }

  openBuffer(sealed: string, aad: string): Buffer {
    const [v, ivB, tagB, ctB] = sealed.split('.');
    if (v !== 'v1' || !ivB || !tagB || ctB === undefined) throw new Error('Unsupported sealed value');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]);
  }

  open(sealed: string, aad: string): string {
    return this.openBuffer(sealed, aad).toString('utf8');
  }
}
