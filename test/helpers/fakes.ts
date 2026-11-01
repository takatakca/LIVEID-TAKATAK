import type { AnalyzeOptions, FaceAnalyzer, FrameResult } from '../../src/face/analyzer.js';
import type { IdText, IdTextReader } from '../../src/idcheck/ocr.js';
import { encodeWav } from '../../src/liveness/audio.js';
import type { Move } from '../../src/liveness/challenge.js';
import type { SpeechRecognizer } from '../../src/liveness/speech.js';

/**
 * Test frames are tiny "JPEGs": the JPEG magic bytes followed by JSON describing what the fake analyzer
 * should "see". This lets the HTTP flow be tested end to end without a camera.
 */
export interface FakeFace {
  nx: number;
  ny: number;
  mouth: number;
  emb: number[];
  real?: number;
  w?: number;
}

export function fakeImage(faces: FakeFace[], extra: Record<string, unknown> = {}): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(JSON.stringify({ faces, ...extra }))]);
}

export class FakeFaceAnalyzer implements FaceAnalyzer {
  async ready(): Promise<void> {}
  async analyze(image: Buffer, opts: AnalyzeOptions = {}): Promise<FrameResult> {
    const data = JSON.parse(image.subarray(3).toString('utf8')) as { faces: FakeFace[]; width?: number };
    const width = data.width ?? 640;
    return {
      width,
      height: 480,
      faces: data.faces.map((f) => ({
        score: 0.95,
        box: [100, 100, f.w ?? 200, f.w ?? 200] as [number, number, number, number],
        nx: f.nx,
        ny: f.ny,
        mouth: f.mouth,
        real: opts.antispoof ? (f.real ?? 0.8) : undefined,
        live: opts.antispoof ? 0.9 : undefined,
        embedding: opts.embedding ? f.emb : undefined,
      })),
    };
  }
  /** Cosine similarity mapped to 0..1. */
  similarity(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! ** 2;
      nb += b[i]! ** 2;
    }
    return na && nb ? Math.max(0, dot / Math.sqrt(na * nb)) : 0;
  }
}

export class FakeRecognizer implements SpeechRecognizer {
  readonly name = 'fake';
  constructor(public answer: () => string) {}
  async transcribe(): Promise<string> {
    return this.answer();
  }
}

export class FakeReader implements IdTextReader {
  constructor(public text = 'SPECIMEN TEST CARD NAME SPECIMEN JEAN DOB 1981-04-12 EXPIRATION 2030-04-12 NO S1234') {}
  async read(): Promise<IdText> {
    return { chars: this.text.replace(/[^A-Za-z0-9]/g, '').length, confidence: 90, text: this.text };
  }
}

export const PERSON_A = [1, 0.2, 0.1, 0, 0.3];
export const PERSON_B = [0, 1, 0, 0.8, 0];
/** Same person as A seen on an ID photo: close (cosine ≈ 0.9) but not the identical capture. */
export const PERSON_A_ID = [0.8, 0.5, 0, 0.3, 0.3];

const POSE: Record<Move | 'center', { nx: number; ny: number }> = {
  center: { nx: 0, ny: 0.45 },
  left: { nx: 0.35, ny: 0.45 },
  right: { nx: -0.35, ny: 0.45 },
  up: { nx: 0, ny: 0.3 },
  down: { nx: 0, ny: 0.6 },
};

/**
 * Builds frames + audio for a person who does what the challenge asks: speaks during the first part
 * (mouth opening in rhythm with 4 voice bursts), then performs `moves` with returns to center.
 */
export function performance(opts: {
  moves: Move[];
  plan: { speakMs: number; moveMs: number; centerMs: number; fps: number };
  /** How long this person takes per move (≤ plan.moveMs). */
  moveDur?: number;
  person?: number[];
  swapPersonAfterMs?: number;
  speak?: boolean;
  mouthMoves?: boolean;
}): { frames: Array<{ t: number; image: Buffer }>; audio: Buffer } {
  const plan = { ...opts.plan, moveMs: Math.min(opts.plan.moveMs, opts.moveDur ?? 2200), centerMs: Math.max(opts.plan.centerMs, 900) };
  const person = opts.person ?? PERSON_A;
  const speak = opts.speak ?? true;
  const mouthMoves = opts.mouthMoves ?? true;
  const total = plan.speakMs + opts.moves.length * (plan.moveMs + plan.centerMs);
  const step = 1000 / plan.fps;
  // Voice bursts: 4 words of 350 ms starting at 600 ms, every 1000 ms.
  const bursts = [600, 1600, 2600, 3600].map((s) => [s, s + 350] as const);
  const talking = (t: number) => speak && bursts.some(([a, b]) => t >= a && t <= b);
  const frames: Array<{ t: number; image: Buffer }> = [];
  for (let t = 0; t <= total; t += step) {
    let pose = POSE.center;
    if (t >= plan.speakMs) {
      const k = t - plan.speakMs;
      const i = Math.floor(k / (plan.moveMs + plan.centerMs));
      const inMove = k - i * (plan.moveMs + plan.centerMs);
      if (i < opts.moves.length && inMove >= 300 && inMove < plan.moveMs) pose = POSE[opts.moves[i]!];
    }
    const who = opts.swapPersonAfterMs !== undefined && t > opts.swapPersonAfterMs ? PERSON_B : person;
    const mouth = mouthMoves && talking(t) ? 0.12 : 0.01;
    frames.push({ t: Math.round(t), image: fakeImage([{ ...pose, mouth, emb: who }]) });
  }
  const rate = 16000;
  const samples = new Int16Array(Math.ceil((total / 1000) * rate));
  for (let i = 0; i < samples.length; i++) {
    const t = (i / rate) * 1000;
    const noise = (Math.random() - 0.5) * 60;
    const voice = talking(t) ? Math.sin((2 * Math.PI * 180 * i) / rate) * 9000 : 0;
    samples[i] = Math.round(voice + noise);
  }
  return { frames, audio: encodeWav({ sampleRate: rate, samples }) };
}
