import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { HumanFaceAnalyzer } from '../../src/face/analyzer.js';
import { TesseractReader } from '../../src/idcheck/ocr.js';
import { verifyIdFront } from '../../src/idcheck/verify.js';
import { encodeWav, parseWav } from '../../src/liveness/audio.js';
import { DEFAULT_PLAN, type Move } from '../../src/liveness/challenge.js';
import { PocketsphinxRecognizer, verifySpokenDigits } from '../../src/liveness/speech.js';
import { verifyLiveness } from '../../src/liveness/verify.js';
import { makeFixtures, type Fixtures } from '../helpers/fixtures.js';
import { testEnv } from '../helpers/env.js';

/**
 * Real engines, real data: the face models, the offline speech recognizer and the OCR, on real photos,
 * a synthetic voice and a specimen card. These tests set and guard the decision thresholds.
 */
const th = loadConfig(testEnv()).thresholds;
const python = process.env.POCKETSPHINX_PYTHON ?? 'python3';
let fx: Fixtures;
const analyzer = new HumanFaceAnalyzer();
const reader = new TesseractReader();
const embeddings = new Map<string, number[]>();

async function embed(file: string): Promise<number[]> {
  const cached = embeddings.get(file);
  if (cached) return cached;
  const r = await analyzer.analyze(readFileSync(file), { embedding: true });
  const face = [...r.faces].sort((a, b) => b.box[2] - a.box[2])[0];
  if (!face?.embedding) throw new Error(`no face in ${file}`);
  embeddings.set(file, face.embedding);
  return face.embedding;
}

beforeAll(async () => {
  fx = makeFixtures();
  await analyzer.ready();
}, 180_000);

afterAll(async () => {
  await reader.close();
});

describe('face matching on real photos', () => {
  it('separates the same man from other people (every pair, both ways of the retry band)', async () => {
    const man = [fx.webcam, ...fx.same];
    const genuine: number[] = [];
    const impostor: number[] = [];
    for (let i = 0; i < man.length; i++) for (let j = i + 1; j < man.length; j++) genuine.push(analyzer.similarity(await embed(man[i]!), await embed(man[j]!)));
    for (const o of fx.others) for (const m of man) impostor.push(analyzer.similarity(await embed(o), await embed(m)));
    for (let i = 0; i < fx.others.length; i++)
      for (let j = i + 1; j < fx.others.length; j++) impostor.push(analyzer.similarity(await embed(fx.others[i]!), await embed(fx.others[j]!)));
    console.log(`[faces] same person worst ${Math.min(...genuine).toFixed(3)}, different people best ${Math.max(...impostor).toFixed(3)}`);
    expect(Math.min(...genuine)).toBeGreaterThanOrEqual(th.faceMatchRetryBand);
    expect(Math.max(...impostor)).toBeLessThan(th.faceMatchRetryBand);
    expect(Math.min(...genuine)).toBeGreaterThan(Math.max(...impostor));
  });

  it('measures head direction and mouth from the landmarks', async () => {
    const r = await analyzer.analyze(readFileSync(fx.webcam));
    expect(r.faces).toHaveLength(1);
    expect(Math.abs(r.faces[0]!.nx)).toBeLessThan(0.1); // facing the camera
    expect(r.faces[0]!.mouth).toBeLessThan(0.05); // mouth closed
  });
});

describe('ID front on a specimen card', () => {
  it('passes when the card photo is the same man as the live templates', async () => {
    const templates = [await embed(fx.same[0]!), await embed(fx.same[1]!), await embed(fx.same[2]!)];
    const r = await verifyIdFront(analyzer, reader, readFileSync(fx.specimen), templates, th, new Date('2026-11-01'));
    expect(r, JSON.stringify(r)).toMatchObject({ passed: true, expired: false });
    expect(r.textChars).toBeGreaterThan(40);
    expect(r.similarity!).toBeGreaterThanOrEqual(th.faceMatch);
  });

  it('handles a full-size phone photo (scaled down before analysis)', async () => {
    const big = path.join(fx.dir, 'id-specimen-big.jpg');
    if (!existsSync(big)) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', fx.specimen, '-vf', 'scale=3200:-2', big]);
    const templates = [await embed(fx.same[0]!), await embed(fx.same[1]!), await embed(fx.same[2]!)];
    const r = await verifyIdFront(analyzer, reader, readFileSync(big), templates, th, new Date('2026-11-01'));
    expect(r.passed, JSON.stringify(r)).toBe(true);
  });

  it('refuses the card for somebody else', async () => {
    const templates = await Promise.all(fx.others.slice(0, 3).map(embed));
    const r = await verifyIdFront(analyzer, reader, readFileSync(fx.specimen), templates, th, new Date('2026-11-01'));
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('id_face_mismatch');
  });

  it('refuses the card once it has expired', async () => {
    const templates = [await embed(fx.same[0]!), await embed(fx.same[1]!)];
    const r = await verifyIdFront(analyzer, reader, readFileSync(fx.specimen), templates, th, new Date('2031-01-01'));
    expect(r).toMatchObject({ passed: false, reason: 'id_expired', retryable: false });
  });

  it('refuses a face shown instead of a card', async () => {
    const templates = [await embed(fx.same[0]!), await embed(fx.same[1]!)];
    const r = await verifyIdFront(analyzer, reader, readFileSync(fx.webcam), templates, th);
    expect(r.passed).toBe(false);
    expect(['id_looks_like_selfie', 'id_text_not_found']).toContain(r.reason);
  });
});

describe('spoken digits, offline recognizer', () => {
  const rec = new PocketsphinxRecognizer(python);
  it('hears the right digits and refuses wrong digits or noise', async () => {
    const wav = readFileSync(fx.speech('seven three nine one'));
    expect(await verifySpokenDigits(rec, wav, '7391', 'en')).toMatchObject({ status: 'pass', heard: '7391' });
    expect((await verifySpokenDigits(rec, wav, '1234', 'en')).status).toBe('fail');
    expect((await verifySpokenDigits(rec, readFileSync(fx.noise), '7391', 'en')).status).toBe('fail');
    const other = readFileSync(fx.speech('four eight two six'));
    expect(await verifySpokenDigits(rec, other, '4826', 'fr')).toMatchObject({ status: 'pass' });
  }, 60_000);
});

describe('attacks on the live check (real models)', () => {
  const moves: Move[] = ['left', 'up', 'right', 'down'];
  const plan = DEFAULT_PLAN;
  // How long a person takes: digits, then ~2.2 s per move and ~0.9 s back to centre.
  const sched = { moveMs: 2200, centerMs: 900 };
  const total = plan.speakMs + moves.length * (sched.moveMs + sched.centerMs);
  const times = Array.from({ length: Math.floor(total / 200) + 1 }, (_, i) => i * 200);

  function audioWithSpeech(): Buffer {
    // The right digits, spoken at 0.5 s, then silence for the rest of the recording.
    const words = parseWav(readFileSync(fx.speech('seven three nine one')));
    const samples = new Int16Array(Math.ceil((total / 1000) * 16000));
    samples.set(words.samples.subarray(0, Math.min(words.samples.length, samples.length - 8000)), 8000);
    return encodeWav({ sampleRate: 16000, samples });
  }

  const deps = () => ({ analyzer, recognizer: new PocketsphinxRecognizer(python), thresholds: th, requireSpeech: true });

  it('a still photo with the right words played next to it fails', async () => {
    const [still] = fx.photoFrames({ name: 'still', warps: [''] });
    const img = readFileSync(still!);
    const t0 = Date.now();
    const r = await verifyLiveness(
      {
        digits: '7391',
        moves,
        plan,
        issuedAt: new Date(Date.now() - 30_000),
        submittedAt: new Date(),
        frames: times.map((t) => ({ t, image: img })),
        audio: audioWithSpeech(),
        speakWindow: { start: 0, end: plan.speakMs },
        locale: 'en',
      },
      deps(),
    );
    const ms = Date.now() - t0;
    expect(r.report.passed).toBe(false);
    expect(r.report.reasons).toContain('head_moves_wrong');
    expect(r.report.reasons).toContain('mouth_not_moving');
    // The voice itself was understood: the photo is caught by the face checks, not by luck.
    expect(r.report.speech?.status).toBe('pass');
    expect(r.templates).toEqual([]);
    console.log(`[liveness] ${times.length} frames analysed in ${ms} ms`);
  }, 120_000);

  it('a printed photo tilted to imitate head turns fails', async () => {
    // Paper rotated: one side recedes (perspective). Order follows the challenge: left, up, right, down.
    const W = 480;
    const H = 480;
    const k = 0.18;
    const warp = (dst: number[]) => `perspective=${dst.join(':')}:sense=destination`;
    const tilts: Record<Move, string> = {
      left: warp([0, 0, W * (1 - k), H * k, 0, H, W * (1 - k), H * (1 - k)]),
      right: warp([W * k, H * k, W, 0, W * k, H * (1 - k), W, H]),
      up: warp([W * k, 0, W * (1 - k), 0, 0, H * (1 - k), W, H * (1 - k)]),
      down: warp([0, H * k, W, H * k, W * k, H, W * (1 - k), H]),
    };
    const frames = fx.photoFrames({ name: 'tilt', warps: ['', tilts.left, tilts.up, tilts.right, tilts.down] });
    const [center, ...tilted] = frames.map((f) => readFileSync(f));
    const at = (t: number): Buffer => {
      if (t < plan.speakMs) return center!;
      const kk = t - plan.speakMs;
      const i = Math.floor(kk / (sched.moveMs + sched.centerMs));
      const inMove = kk - i * (sched.moveMs + sched.centerMs);
      return i < 4 && inMove >= 300 && inMove < sched.moveMs ? tilted[i]! : center!;
    };
    const r = await verifyLiveness(
      {
        digits: '7391',
        moves,
        plan,
        issuedAt: new Date(Date.now() - 30_000),
        submittedAt: new Date(),
        frames: times.map((t) => ({ t, image: at(t) })),
        audio: audioWithSpeech(),
        speakWindow: { start: 0, end: plan.speakMs },
        locale: 'en',
      },
      deps(),
    );
    expect(r.report.passed).toBe(false);
    expect(r.report.reasons).toContain('mouth_not_moving');
    console.log(`[liveness] tilted photo: observed moves ${JSON.stringify(r.report.pose.observed)}, reasons ${r.report.reasons.join(',')}`);
  }, 120_000);
});
