import { z } from 'zod';

export const clientSignalsSchema = z
  .object({
    webdriver: z.boolean().optional(),
    languages: z.array(z.string().max(35)).max(20).optional(),
    touch: z.boolean().optional(),
    pointerEvents: z.number().int().min(0).max(1e6).optional(),
    keyEvents: z.number().int().min(0).max(1e6).optional(),
    msOnPage: z.number().min(0).max(1e8).optional(),
    videoLabel: z.string().max(200).optional(),
    audioLabel: z.string().max(200).optional(),
    hardwareConcurrency: z.number().int().min(0).max(1024).optional(),
    screen: z.object({ w: z.number().int().min(0).max(20000), h: z.number().int().min(0).max(20000) }).optional(),
  })
  .strict();

export type ClientSignals = z.infer<typeof clientSignalsSchema>;

export interface RiskAssessment {
  score: number;
  /** Signals that block the flow outright when automation blocking is on. */
  hard: string[];
  soft: string[];
}

const HEADLESS_UA = /HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium|electron/i;
const VIRTUAL_CAMERA =
  /virtual|\bobs\b|manycam|snap camera|xsplit|droidcam|epoccam|camtwist|v4l2loopback|dummy|fake|splitcam|youcam|iriun|ndi|mmhmm/i;

export function assessRisk(userAgent: string | undefined, s: ClientSignals | undefined): RiskAssessment {
  const hard: string[] = [];
  const soft: string[] = [];
  if (s?.webdriver) hard.push('automation');
  if (userAgent && HEADLESS_UA.test(userAgent)) hard.push('headless_browser');
  if (s?.videoLabel && VIRTUAL_CAMERA.test(s.videoLabel)) hard.push('virtual_camera');
  if (s?.audioLabel && VIRTUAL_CAMERA.test(s.audioLabel)) hard.push('virtual_microphone');
  if (s && (!s.languages || s.languages.length === 0)) soft.push('no_languages');
  if (s && !s.touch && (s.pointerEvents ?? 0) + (s.keyEvents ?? 0) === 0) soft.push('no_human_input');
  if (s && s.msOnPage !== undefined && s.msOnPage < 2500) soft.push('too_fast');
  if (s?.hardwareConcurrency === 0) soft.push('no_cpu_info');
  const score = Math.min(100, hard.length * 100 + soft.length * 20);
  return { score, hard, soft };
}

export function mergeRisk(a: Partial<RiskAssessment> | undefined, b: RiskAssessment): RiskAssessment {
  const hard = [...new Set([...(a?.hard ?? []), ...b.hard])];
  const soft = [...new Set([...(a?.soft ?? []), ...b.soft])];
  return { score: Math.min(100, hard.length * 100 + soft.length * 20), hard, soft };
}

// Throwaway inbox domains (short list of the most used; extend as needed).
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', 'yopmail.com',
  'yopmail.fr', 'tempmail.com', 'temp-mail.org', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
  'throwawaymail.com', 'fakeinbox.com', 'mintemail.com', 'mohmal.com', 'emailondeck.com', 'tempail.com', 'moakt.com',
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return DISPOSABLE.has(domain);
}
