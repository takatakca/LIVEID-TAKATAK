import { createRequire } from 'node:module';
import path from 'node:path';

export interface IdText {
  /** Letters and digits in words the OCR is reasonably sure about. */
  chars: number;
  confidence: number;
  text: string;
}

export interface IdTextReader {
  read(image: Buffer): Promise<IdText>;
  close?(): Promise<void>;
}

/** Offline OCR (tesseract.js with English data from npm). Text stays in memory and is never stored. */
export class TesseractReader implements IdTextReader {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private worker?: Promise<any>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getWorker(): Promise<any> {
    this.worker ??= (async () => {
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const T = require('tesseract.js') as any;
      const eng = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
      // English data reads the bilingual (EN/FR) front of Canadian IDs well; accents are not needed here.
      return T.createWorker(['eng'], 1, {
        langPath: path.join(eng, '4.0.0_best_int'),
        gzip: true,
        cacheMethod: 'none',
        logger: () => undefined,
      });
    })();
    return this.worker;
  }

  async read(image: Buffer): Promise<IdText> {
    const worker = await this.getWorker();
    const r = await worker.recognize(image);
    const text = String(r.data.text ?? '');
    const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]{2,}/u.test(w));
    const chars = words.join('').replace(/[^\p{L}\p{N}]/gu, '').length;
    return { chars, confidence: Number(r.data.confidence ?? 0), text };
  }

  async close(): Promise<void> {
    if (this.worker) await (await this.worker).terminate();
  }
}

const DATE_PATTERNS: Array<{ re: RegExp; order: 'ymd' | 'dmy' }> = [
  { re: /\b(19|20)(\d{2})[-/. ](\d{2})[-/. ](\d{2})\b/g, order: 'ymd' },
  { re: /\b(\d{2})[-/. ](\d{2})[-/. ](19|20)(\d{2})\b/g, order: 'dmy' },
];

/** Every plausible calendar date in a text, as UTC dates. */
export function findDates(text: string): Array<{ date: Date; index: number }> {
  const out: Array<{ date: Date; index: number }> = [];
  for (const { re, order } of DATE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      let y: number, mo: number, d: number;
      if (order === 'ymd') {
        y = Number(m[1]! + m[2]!);
        mo = Number(m[3]);
        d = Number(m[4]);
      } else {
        d = Number(m[1]);
        mo = Number(m[2]);
        y = Number(m[3]! + m[4]!);
      }
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      out.push({ date: new Date(Date.UTC(y, mo - 1, d)), index: m.index ?? 0 });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The expiry date: the first date printed after an "EXP" / "EXPIRATION" / "VALID" label. */
export function findExpiry(text: string): Date | undefined {
  const label = /(EXP|EXPIR|EXPIRATION|EXPIRY|VALID|VALIDE|FIN DE VALIDIT)/i.exec(text);
  if (!label) return undefined;
  return findDates(text).find((d) => d.index > label.index)?.date;
}
