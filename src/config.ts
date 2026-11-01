import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .transform((v) => v === 'true' || v === '1');

const num = (def: number) => z.coerce.number().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Public origin of this service. It is the token issuer and the origin bound into SMS codes. */
  PUBLIC_URL: z.url().default('http://localhost:8080'),
  TRUST_PROXY: bool.default(false),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool.default(false),

  /** Server pepper for HMAC hashes (codes, tokens, phone/email lookups, pairwise subjects). 32+ chars. */
  LIVEID_SECRET: z.string().min(32),
  /** AES-256-GCM key, base64 of exactly 32 bytes. Encrypts phone, email and the short-lived face template. */
  LIVEID_ENCRYPTION_KEY: z.string().min(1),
  /** Ed25519 private key as a JWK JSON string. Required in production (`npm run keys:generate`). */
  LIVEID_SIGNING_KEY: z.string().optional(),

  SMS_PROVIDER: z.enum(['twilio', 'console']).default('console'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  /** When true, Twilio Lookup rejects numbers that are not mobile (VoIP / landline are a fraud signal). */
  TWILIO_LOOKUP_LINE_TYPE: bool.default(false),
  ALLOWED_PHONE_COUNTRIES: z.string().default('CA,US'),

  EMAIL_PROVIDER: z.enum(['smtp', 'console']).default('console'),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('TAKATAK LIVE ID <no-reply@takatak.ca>'),

  SPEECH_PROVIDER: z.enum(['pocketsphinx', 'openai', 'none']).default('pocketsphinx'),
  POCKETSPHINX_PYTHON: z.string().default('python3'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TRANSCRIBE_MODEL: z.string().default('gpt-4o-transcribe'),

  FACE_MODELS_PATH: z.string().optional(),

  /** Refuse automation (navigator.webdriver) and virtual cameras. Always true in production. */
  BLOCK_AUTOMATION: bool.default(true),
  /** Exposes GET /dev/outbox with the console SMS/email messages. Never in production. */
  DEV_OUTBOX: bool.default(false),

  SESSION_TTL_MINUTES: num(30),
  RETENTION_DAYS: num(30),

  // Decision thresholds. Face scores are 1 − ResNet descriptor distance (calibrated on real photos, see docs/SECURITY.md).
  FACE_MATCH_THRESHOLD: num(0.5),
  FACE_MATCH_RETRY_BAND: num(0.44),
  FACE_REPLAY_SIMILARITY: num(0.93),
  SAME_PERSON_THRESHOLD: num(0.55),
  POSE_YAW_THRESHOLD: num(0.2),
  POSE_PITCH_THRESHOLD: num(0.09),
  MOUTH_RANGE_MIN: num(0.03),
  ANTISPOOF_HARD_FAIL: num(0.2),
});

export type Env = z.infer<typeof schema>;

export interface Config {
  env: Env['NODE_ENV'];
  isProd: boolean;
  host: string;
  port: number;
  publicUrl: string;
  issuer: string;
  trustProxy: boolean;
  databaseUrl: string;
  databaseSsl: boolean;
  secret: string;
  encryptionKey: Buffer;
  signingKeyJwk?: string;
  sms: {
    provider: 'twilio' | 'console';
    twilio?: { accountSid: string; authToken: string; from?: string; messagingServiceSid?: string };
    lookupLineType: boolean;
    allowedCountries: string[];
  };
  email: { provider: 'smtp' | 'console'; smtpUrl?: string; from: string };
  speech: { provider: 'pocketsphinx' | 'openai' | 'none'; python: string; openaiKey?: string; openaiModel: string };
  face: { modelsPath?: string };
  blockAutomation: boolean;
  devOutbox: boolean;
  sessionTtlMinutes: number;
  retentionDays: number;
  thresholds: {
    faceMatch: number;
    faceMatchRetryBand: number;
    faceReplay: number;
    samePerson: number;
    poseYaw: number;
    posePitch: number;
    mouthRange: number;
    antispoofHardFail: number;
  };
}

export class ConfigError extends Error {}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration: ${fields}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  const encryptionKey = Buffer.from(e.LIVEID_ENCRYPTION_KEY, 'base64');
  if (encryptionKey.length !== 32) {
    throw new ConfigError('LIVEID_ENCRYPTION_KEY must be base64 of exactly 32 bytes');
  }
  const publicUrl = e.PUBLIC_URL.replace(/\/+$/, '');

  const problems: string[] = [];
  if (isProd) {
    if (!publicUrl.startsWith('https://')) problems.push('PUBLIC_URL must be https in production');
    if (e.SMS_PROVIDER === 'console') problems.push('SMS_PROVIDER=console is not allowed in production');
    if (e.EMAIL_PROVIDER === 'console') problems.push('EMAIL_PROVIDER=console is not allowed in production');
    if (!e.LIVEID_SIGNING_KEY) problems.push('LIVEID_SIGNING_KEY is required in production');
    if (e.DEV_OUTBOX) problems.push('DEV_OUTBOX must be false in production');
    if (e.SPEECH_PROVIDER === 'none') problems.push('SPEECH_PROVIDER=none is not allowed in production');
  }
  if (e.SMS_PROVIDER === 'twilio') {
    if (!e.TWILIO_ACCOUNT_SID || !e.TWILIO_AUTH_TOKEN) problems.push('Twilio needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
    if (!e.TWILIO_FROM && !e.TWILIO_MESSAGING_SERVICE_SID) problems.push('Twilio needs TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID');
  }
  if (e.EMAIL_PROVIDER === 'smtp' && !e.SMTP_URL) problems.push('EMAIL_PROVIDER=smtp needs SMTP_URL');
  if (e.SPEECH_PROVIDER === 'openai' && !e.OPENAI_API_KEY) problems.push('SPEECH_PROVIDER=openai needs OPENAI_API_KEY');
  if (problems.length) throw new ConfigError(problems.join('; '));

  return {
    env: e.NODE_ENV,
    isProd,
    host: e.HOST,
    port: e.PORT,
    publicUrl,
    issuer: publicUrl,
    trustProxy: e.TRUST_PROXY,
    databaseUrl: e.DATABASE_URL,
    databaseSsl: e.DATABASE_SSL,
    secret: e.LIVEID_SECRET,
    encryptionKey,
    signingKeyJwk: e.LIVEID_SIGNING_KEY,
    sms: {
      provider: e.SMS_PROVIDER,
      twilio:
        e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN
          ? {
              accountSid: e.TWILIO_ACCOUNT_SID,
              authToken: e.TWILIO_AUTH_TOKEN,
              from: e.TWILIO_FROM,
              messagingServiceSid: e.TWILIO_MESSAGING_SERVICE_SID,
            }
          : undefined,
      lookupLineType: e.TWILIO_LOOKUP_LINE_TYPE,
      allowedCountries: e.ALLOWED_PHONE_COUNTRIES.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
    },
    email: { provider: e.EMAIL_PROVIDER, smtpUrl: e.SMTP_URL, from: e.EMAIL_FROM },
    speech: {
      provider: e.SPEECH_PROVIDER,
      python: e.POCKETSPHINX_PYTHON,
      openaiKey: e.OPENAI_API_KEY,
      openaiModel: e.OPENAI_TRANSCRIBE_MODEL,
    },
    face: { modelsPath: e.FACE_MODELS_PATH },
    blockAutomation: isProd ? true : e.BLOCK_AUTOMATION,
    devOutbox: isProd ? false : e.DEV_OUTBOX,
    sessionTtlMinutes: e.SESSION_TTL_MINUTES,
    retentionDays: e.RETENTION_DAYS,
    thresholds: {
      faceMatch: e.FACE_MATCH_THRESHOLD,
      faceMatchRetryBand: e.FACE_MATCH_RETRY_BAND,
      faceReplay: e.FACE_REPLAY_SIMILARITY,
      samePerson: e.SAME_PERSON_THRESHOLD,
      poseYaw: e.POSE_YAW_THRESHOLD,
      posePitch: e.POSE_PITCH_THRESHOLD,
      mouthRange: e.MOUTH_RANGE_MIN,
      antispoofHardFail: e.ANTISPOOF_HARD_FAIL,
    },
  };
}
