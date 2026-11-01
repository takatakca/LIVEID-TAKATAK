import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Config } from '../config.js';

const WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', won: '1', two: '2', to: '2', too: '2', three: '3', four: '4', for: '4',
  five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9',
  zéro: '0', un: '1', une: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', sept: '7', huit: '8', neuf: '9',
  // Words returned by the local recognizer for French pronunciations (see py/digits.py).
  fr_zero: '0', fr_un: '1', fr_deux: '2', fr_trois: '3', fr_quatre: '4', fr_cinq: '5', fr_six: '6', fr_sept: '7', fr_huit: '8', fr_neuf: '9',
};

/** Turns a transcript ("seven, three... 9 one" / "sept trois neuf un") into a digit string ("7391"). */
export function transcriptToDigits(text: string): string {
  let out = '';
  const tokens = text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) {
      out += tok;
      continue;
    }
    const d = WORDS[tok] ?? WORDS[tok.normalize('NFD').replace(/\p{M}/gu, '')];
    if (d) out += d;
  }
  return out;
}

/** The spoken digits must contain the expected ones in order, with at most one extra (a mis-heard word). */
export function digitsMatch(expected: string, heard: string, extra = 1): boolean {
  if (!expected || heard.length > expected.length + extra) return false;
  let i = 0;
  for (const c of heard) if (c === expected[i]) i++;
  return i === expected.length;
}

export interface SpeechResult {
  status: 'pass' | 'fail' | 'unavailable';
  heard: string;
  provider: string;
}

export interface SpeechRecognizer {
  readonly name: string;
  /** Transcribes a 16 kHz mono 16-bit WAV. Returns the raw transcript. */
  transcribe(wav: Buffer, locale: 'fr' | 'en'): Promise<string>;
}

export class PocketsphinxRecognizer implements SpeechRecognizer {
  readonly name = 'pocketsphinx';
  private readonly script: string;
  constructor(private readonly python: string, script?: string) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    this.script = script ?? path.resolve(here, '..', '..', 'py', 'digits.py');
  }

  transcribe(wav: Buffer, locale: 'fr' | 'en'): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, ['-I', this.script, '--lang', locale], { stdio: ['pipe', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('speech_timeout'));
      }, 20_000);
      child.stdout.on('data', (d: Buffer) => out.push(d));
      child.stderr.on('data', (d: Buffer) => err.push(d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`pocketsphinx exited ${code}: ${Buffer.concat(err).toString().slice(-300)}`));
        try {
          const json = JSON.parse(Buffer.concat(out).toString('utf8')) as { text?: string };
          resolve(json.text ?? '');
        } catch (e) {
          reject(e);
        }
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(wav);
    });
  }
}

export class OpenAiRecognizer implements SpeechRecognizer {
  readonly name = 'openai';
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(wav: Buffer, locale: 'fr' | 'en'): Promise<string> {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.set('model', this.model);
    form.set('language', locale);
    form.set('prompt', locale === 'fr' ? 'Chiffres seulement : sept trois neuf un.' : 'Digits only: seven three nine one.');
    const res = await this.fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`openai transcription HTTP ${res.status}`);
    const json = (await res.json()) as { text?: string };
    return json.text ?? '';
  }
}

export function createRecognizer(cfg: Config): SpeechRecognizer | null {
  if (cfg.speech.provider === 'pocketsphinx') return new PocketsphinxRecognizer(cfg.speech.python);
  if (cfg.speech.provider === 'openai' && cfg.speech.openaiKey) return new OpenAiRecognizer(cfg.speech.openaiKey, cfg.speech.openaiModel);
  return null;
}

export async function verifySpokenDigits(
  recognizer: SpeechRecognizer | null,
  wav: Buffer,
  expected: string,
  locale: 'fr' | 'en',
): Promise<SpeechResult> {
  if (!recognizer) return { status: 'unavailable', heard: '', provider: 'none' };
  const text = await recognizer.transcribe(wav, locale);
  const heard = transcriptToDigits(text);
  return { status: digitsMatch(expected, heard) ? 'pass' : 'fail', heard, provider: recognizer.name };
}
