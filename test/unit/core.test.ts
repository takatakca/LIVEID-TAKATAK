import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';
import { keyedHash, numericCode, safeEqual, Sealer, sha256Base64Url, verifyPkce } from '../../src/lib/crypto.js';
import { emailContent, maskEmail, maskPhone, smsText } from '../../src/flow/messages.js';
import { assessRisk, isDisposableEmail, mergeRisk } from '../../src/flow/risk.js';
import { nextStep, plannedSteps, type SessionRow } from '../../src/flow/session.js';
import { findDates, findExpiry } from '../../src/idcheck/ocr.js';
import { validRedirectUri } from '../../src/oauth/clients.js';
import { testEnv } from '../helpers/env.js';

describe('crypto', () => {
  const sealer = new Sealer(randomBytes(32));

  it('seals and opens with the same associated data only', () => {
    const s = sealer.seal('+15145550123', 'session:1:phone');
    expect(s.startsWith('v1.')).toBe(true);
    expect(s).not.toContain('5145550123');
    expect(sealer.open(s, 'session:1:phone')).toBe('+15145550123');
    expect(() => sealer.open(s, 'session:2:phone')).toThrow();
    const parts = s.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => sealer.open(parts.join('.'), 'session:1:phone')).toThrow();
  });

  it('never produces the same ciphertext twice', () => {
    expect(sealer.seal('x', 'a')).not.toBe(sealer.seal('x', 'a'));
  });

  it('length-prefixes keyed hash parts', () => {
    expect(keyedHash('k'.repeat(32), 'ab', 'c')).not.toBe(keyedHash('k'.repeat(32), 'a', 'bc'));
    expect(keyedHash('k'.repeat(32), 'a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compares in constant time and handles different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('makes 6-digit codes using every digit', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const c = numericCode(6);
      expect(c).toMatch(/^\d{6}$/);
      for (const d of c) seen.add(d);
    }
    expect(seen.size).toBe(10);
  });

  it('checks PKCE S256', () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = sha256Base64Url(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(verifier + 'x', challenge)).toBe(false);
    expect(verifyPkce('short', sha256Base64Url('short'))).toBe(false);
  });
});

describe('config', () => {
  it('loads a development config', () => {
    const c = loadConfig(testEnv());
    expect(c.isProd).toBe(false);
    expect(c.thresholds.faceMatch).toBe(0.5);
  });

  it('refuses unsafe production settings', () => {
    expect(() => loadConfig(testEnv({ NODE_ENV: 'production' }))).toThrow(ConfigError);
    try {
      loadConfig(testEnv({ NODE_ENV: 'production' }));
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain('PUBLIC_URL must be https');
      expect(m).toContain('SMS_PROVIDER=console');
      expect(m).toContain('EMAIL_PROVIDER=console');
      expect(m).toContain('LIVEID_SIGNING_KEY');
      expect(m).toContain('DEV_OUTBOX');
      expect(m).toContain('SPEECH_PROVIDER=none');
    }
  });

  it('rejects a short encryption key', () => {
    expect(() => loadConfig(testEnv({ LIVEID_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }))).toThrow(/32 bytes/);
  });

  it('requires Twilio credentials when Twilio is chosen', () => {
    expect(() => loadConfig(testEnv({ SMS_PROVIDER: 'twilio' }))).toThrow(/TWILIO_ACCOUNT_SID/);
  });
});

describe('messages', () => {
  it('binds the SMS code to our domain for WebOTP', () => {
    const t = smsText('fr', '123456', 'liveid.takatak.ca');
    expect(t).toContain('123456');
    expect(t.trim().endsWith('@liveid.takatak.ca #123456')).toBe(true);
    expect(smsText('en', '654321', 'x.ca')).toContain('Never share it');
  });

  it('builds bilingual email', () => {
    expect(emailContent('fr', '111222').subject).toContain('code');
    expect(emailContent('en', '111222').html).toContain('111222');
  });

  it('masks contact details', () => {
    expect(maskPhone('+15145550134')).toBe('+1 ••••••••34');
    expect(maskEmail('jean@exemple.ca')).toBe('je••@exemple.ca');
  });
});

describe('risk', () => {
  it('flags automation, headless browsers and virtual cameras as hard signals', () => {
    expect(assessRisk('Mozilla/5.0', { webdriver: true }).hard).toContain('automation');
    expect(assessRisk('Mozilla/5.0 HeadlessChrome/120', {}).hard).toContain('headless_browser');
    expect(assessRisk('Mozilla/5.0', { videoLabel: 'OBS Virtual Camera' }).hard).toContain('virtual_camera');
    expect(assessRisk('Mozilla/5.0', { videoLabel: 'fake_device_0' }).hard).toContain('virtual_camera');
    expect(assessRisk('Mozilla/5.0', { videoLabel: 'FaceTime HD Camera', languages: ['fr-CA'], pointerEvents: 3 }).hard).toEqual([]);
  });

  it('scores soft signals and merges', () => {
    const r = assessRisk('Mozilla/5.0', { languages: [], pointerEvents: 0, keyEvents: 0, msOnPage: 500 });
    expect(r.soft).toEqual(expect.arrayContaining(['no_languages', 'no_human_input', 'too_fast']));
    expect(mergeRisk({ hard: ['automation'] }, r).score).toBe(100);
  });

  it('knows throwaway inboxes', () => {
    expect(isDisposableEmail('a@mailinator.com')).toBe(true);
    expect(isDisposableEmail('a@takatak.ca')).toBe(false);
  });
});

describe('steps', () => {
  it('follows the order email, phone, terms, live, ID', () => {
    expect(plannedSteps(['openid', 'id_document', 'email', 'phone'])).toEqual(['email', 'phone', 'consent', 'liveness', 'id_document']);
    expect(plannedSteps(['openid', 'phone'])).toEqual(['phone', 'consent']);
    const row = { scopes: ['openid', 'phone', 'liveness'], consented_at: new Date(), phone_verified_at: null } as unknown as SessionRow;
    expect(nextStep(row)).toBe('phone');
  });
});

describe('redirect URIs', () => {
  it('accepts https and localhost only, never fragments', () => {
    expect(validRedirectUri('https://takatak.ca/auth/liveid/callback')).toBe(true);
    expect(validRedirectUri('http://localhost:3000/cb')).toBe(true);
    expect(validRedirectUri('http://takatak.ca/cb')).toBe(false);
    expect(validRedirectUri('https://takatak.ca/cb#x')).toBe(false);
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
  });
});

describe('ID text', () => {
  it('finds dates in both orders and the expiry after its label', () => {
    expect(findDates('DOB 1981-04-12 / 12/04/2030').map((d) => d.date.toISOString().slice(0, 10))).toEqual(['1981-04-12', '2030-04-12']);
    expect(findExpiry('NAISSANCE 1981-04-12\nEXPIRATION 2030-04-12')?.toISOString().slice(0, 10)).toBe('2030-04-12');
    expect(findExpiry('no label 2030-04-12')).toBeUndefined();
    expect(findDates('2030-13-45')).toEqual([]);
  });
});
