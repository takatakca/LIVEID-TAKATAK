import type { Config } from './config.js';
import type { Deps } from './deps.js';
import { createPool } from './db/pool.js';
import { HumanFaceAnalyzer } from './face/analyzer.js';
import { TesseractReader } from './idcheck/ocr.js';
import { Sealer } from './lib/crypto.js';
import { PgRateLimiter } from './lib/rate-limit.js';
import { createRecognizer } from './liveness/speech.js';
import { loadSigningKeys } from './oauth/keys.js';
import { createMessaging } from './providers/messaging.js';

/** Wires the real implementations from the configuration. */
export async function createDeps(cfg: Config, log: (msg: string) => void): Promise<Deps & { ephemeralKey: boolean }> {
  const db = createPool(cfg.databaseUrl, cfg.databaseSsl);
  const keys = await loadSigningKeys(cfg.signingKeyJwk, !cfg.isProd);
  const { sms, email, outbox } = createMessaging(cfg, log);
  return {
    cfg,
    db,
    keys,
    ephemeralKey: keys.ephemeral,
    sealer: new Sealer(cfg.encryptionKey),
    limiter: new PgRateLimiter(db),
    sms,
    email,
    outbox,
    analyzer: new HumanFaceAnalyzer({ modelsPath: cfg.face.modelsPath }),
    recognizer: createRecognizer(cfg),
    idReader: new TesseractReader(),
  };
}
