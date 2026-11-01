import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import type { FaceAnalyzer } from './face/analyzer.js';
import type { IdTextReader } from './idcheck/ocr.js';
import type { Sealer } from './lib/crypto.js';
import type { RateLimiter } from './lib/rate-limit.js';
import type { SpeechRecognizer } from './liveness/speech.js';
import type { SigningKeys } from './oauth/keys.js';
import type { DevOutbox, EmailSender, SmsSender } from './providers/messaging.js';

export interface Deps {
  cfg: Config;
  db: Db;
  keys: SigningKeys;
  sealer: Sealer;
  limiter: RateLimiter;
  sms: SmsSender;
  email: EmailSender;
  outbox: DevOutbox;
  analyzer: FaceAnalyzer;
  recognizer: SpeechRecognizer | null;
  idReader: IdTextReader | null;
}
