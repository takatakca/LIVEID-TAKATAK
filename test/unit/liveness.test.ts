import { describe, expect, it } from 'vitest';
import { encodeWav, parseWav, sliceMs, voiceActivity } from '../../src/liveness/audio.js';
import { pearson, verifyAvSync } from '../../src/liveness/avsync.js';
import { DEFAULT_PLAN, minDurationMs, randomDigits, randomMoves } from '../../src/liveness/challenge.js';
import { classify, observedMoves, runs, sequenceMatches, verifyPoseSequence, type PoseSample } from '../../src/liveness/pose.js';
import { digitsMatch, OpenAiRecognizer, transcriptToDigits, verifySpokenDigits } from '../../src/liveness/speech.js';
import { verifyLiveness } from '../../src/liveness/verify.js';
import { loadConfig } from '../../src/config.js';
import { FakeFaceAnalyzer, FakeRecognizer, performance as act } from '../helpers/fakes.js';
import { testEnv } from '../helpers/env.js';

const th = loadConfig(testEnv()).thresholds;

describe('challenge', () => {
  it('draws digits 1-9 without immediate repeats', () => {
    for (let i = 0; i < 200; i++) {
      const d = randomDigits(4);
      expect(d).toMatch(/^[1-9]{4}$/);
      for (let j = 1; j < d.length; j++) expect(d[j]).not.toBe(d[j - 1]);
    }
  });

  it('draws moves with no repeats in a row, at least one sideways and one vertical', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const m = randomMoves(4);
      seen.add(m.join(','));
      for (let j = 1; j < m.length; j++) expect(m[j]).not.toBe(m[j - 1]);
      expect(m.some((x) => x === 'left' || x === 'right')).toBe(true);
      expect(m.some((x) => x === 'up' || x === 'down')).toBe(true);
    }
    expect(seen.size).toBeGreaterThan(30);
    expect(minDurationMs(DEFAULT_PLAN, 4)).toBe(8600);
  });
});

describe('head pose', () => {
  const t = { yaw: 0.2, pitch: 0.09 };
  it('classifies directions from the camera view (nose to image right = person turned left)', () => {
    expect(classify(0.3, 0, t)).toBe('left');
    expect(classify(-0.3, 0, t)).toBe('right');
    expect(classify(0, -0.15, t)).toBe('up');
    expect(classify(0, 0.15, t)).toBe('down');
    expect(classify(0.05, 0.03, t)).toBe('center');
  });

  const seq = (labels: Array<[number, number, number]>): PoseSample[] => labels.map(([tt, nx, ny]) => ({ t: tt, nx, ny }));

  it('reads the ordered moves and ignores one-frame blips', () => {
    const s = seq([
      [0, 0, 0.45], [200, 0, 0.45], [400, 0.35, 0.45], [600, 0.35, 0.45], [800, 0, 0.45], [1000, 0, 0.3], [1200, 0, 0.3],
      [1400, 0, 0.45], [1600, -0.4, 0.45], [1800, 0, 0.45], [2000, 0, 0.62], [2200, 0, 0.62],
    ]);
    const r = runs(s, { nx: 0, ny: 0.45 }, t);
    expect(observedMoves(r)).toEqual(['left', 'up', 'down']);
  });

  it('accepts the asked order with at most one extra move, rejects anything else', () => {
    expect(sequenceMatches(['left', 'up', 'right', 'down'], ['left', 'up', 'right', 'down'])).toBe(true);
    expect(sequenceMatches(['left', 'up', 'right', 'down'], ['left', 'down', 'up', 'right', 'down'])).toBe(true);
    expect(sequenceMatches(['left', 'up', 'right', 'down'], ['up', 'left', 'right', 'down'])).toBe(false);
    expect(sequenceMatches(['left', 'up', 'right', 'down'], ['left', 'up', 'right'])).toBe(false);
    expect(sequenceMatches(['left', 'up'], ['left', 'right', 'up', 'down', 'left', 'up'])).toBe(false);
  });

  it('a still face never passes', () => {
    const still = Array.from({ length: 80 }, (_, i) => ({ t: i * 200, nx: 0.01, ny: 0.45 }));
    expect(verifyPoseSequence(still, ['left', 'up', 'right', 'down'], t).passed).toBe(false);
  });
});

describe('audio', () => {
  const tone = (ms: number, on: Array<[number, number]>) => {
    const rate = 16000;
    const s = new Int16Array(Math.round((ms / 1000) * rate));
    for (let i = 0; i < s.length; i++) {
      const tt = (i / rate) * 1000;
      s[i] = on.some(([a, b]) => tt >= a && tt < b) ? Math.round(Math.sin(i / 3) * 8000) : Math.round((Math.random() - 0.5) * 40);
    }
    return { sampleRate: rate, samples: s };
  };

  it('round-trips WAV and refuses other formats', () => {
    const pcm = tone(500, [[0, 500]]);
    const back = parseWav(encodeWav(pcm));
    expect(back.sampleRate).toBe(16000);
    expect(back.samples.length).toBe(pcm.samples.length);
    const bad = encodeWav(pcm);
    bad.writeUInt16LE(2, 22); // stereo
    expect(() => parseWav(bad)).toThrow();
    expect(() => parseWav(Buffer.from('hello world, not a wav file at all.........'))).toThrow();
    expect(sliceMs(pcm, 100, 200).samples.length).toBe(1600);
  });

  it('counts spoken words as voiced segments', () => {
    const va = voiceActivity(tone(4000, [[500, 850], [1500, 1850], [2500, 2850], [3300, 3650]]));
    expect(va.segments).toBe(4);
    expect(va.voicedRatio).toBeGreaterThan(0.25);
    expect(voiceActivity(tone(3000, [])).segments).toBeLessThanOrEqual(1);
  });

  it('requires the mouth to move with the voice', () => {
    const bursts: Array<[number, number]> = [[500, 850], [1500, 1850], [2500, 2850], [3300, 3650]];
    const audio = tone(4200, bursts);
    const inBurst = (tt: number) => bursts.some(([a, b]) => tt >= a && tt <= b);
    const synced = Array.from({ length: 21 }, (_, i) => ({ t: i * 200, mouth: inBurst(i * 200) ? 0.12 : 0.01 }));
    expect(verifyAvSync(audio, synced, { minMouthRange: 0.03 }).passed).toBe(true);

    const frozen = synced.map((m) => ({ ...m, mouth: 0.01 }));
    expect(verifyAvSync(audio, frozen, { minMouthRange: 0.03 }).reasons).toContain('mouth_not_moving');

    const opposite = synced.map((m) => ({ ...m, mouth: inBurst(m.t) ? 0.01 : 0.12 }));
    expect(verifyAvSync(audio, opposite, { minMouthRange: 0.03 }).reasons).toContain('voice_not_in_sync');

    expect(verifyAvSync(tone(4200, []), synced, { minMouthRange: 0.03 }).reasons).toContain('no_voice');
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });
});

describe('spoken digits', () => {
  it('reads transcripts in English, French and numerals', () => {
    expect(transcriptToDigits('Seven, three... nine one')).toBe('7391');
    expect(transcriptToDigits('sept trois neuf un')).toBe('7391');
    expect(transcriptToDigits('7 3 9 1')).toBe('7391');
    expect(transcriptToDigits('quatre, cinq, huit et deux')).toBe('4582');
    expect(transcriptToDigits('fr_sept fr_trois')).toBe('73');
  });

  it('allows one mis-heard extra word, nothing more', () => {
    expect(digitsMatch('7391', '7391')).toBe(true);
    expect(digitsMatch('7391', '73291')).toBe(true);
    expect(digitsMatch('7391', '739')).toBe(false);
    expect(digitsMatch('7391', '1937')).toBe(false);
    expect(digitsMatch('7391', '7123456789391')).toBe(false);
  });

  it('calls the OpenAI transcription API with the right shape', async () => {
    let seen: { url?: string; auth?: string; form?: FormData } = {};
    const fetchMock = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).Authorization, form: init.body as FormData };
      return new Response(JSON.stringify({ text: 'Sept, trois, neuf, un.' }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await verifySpokenDigits(new OpenAiRecognizer('sk-test', 'gpt-4o-transcribe', fetchMock), Buffer.from('RIFF'), '7391', 'fr');
    expect(r).toEqual({ status: 'pass', heard: '7391', provider: 'openai' });
    expect(seen.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(seen.auth).toBe('Bearer sk-test');
    expect(seen.form?.get('language')).toBe('fr');
  });
});

describe('liveness decision (fake camera, real rules)', () => {
  const moves = ['left', 'up', 'right', 'down'] as const;
  const base = (over: Partial<Parameters<typeof act>[0]> = {}) => {
    const p = act({ moves: [...moves], plan: DEFAULT_PLAN, ...over });
    return {
      digits: '7391',
      moves: [...moves],
      plan: DEFAULT_PLAN,
      issuedAt: new Date(Date.now() - 25_000),
      submittedAt: new Date(),
      frames: p.frames,
      audio: p.audio,
      speakWindow: { start: 0, end: DEFAULT_PLAN.speakMs },
      locale: 'fr' as const,
    };
  };
  const deps = (heard = 'seven three nine one') => ({
    analyzer: new FakeFaceAnalyzer(),
    recognizer: new FakeRecognizer(() => heard),
    thresholds: th,
    requireSpeech: true,
  });

  it('passes a person who does exactly what is asked', async () => {
    const r = await verifyLiveness(base(), deps());
    expect(r.report.reasons).toEqual([]);
    expect(r.report.passed).toBe(true);
    expect(r.report.pose.observed).toEqual([...moves]);
    expect(r.templates.length).toBeGreaterThanOrEqual(3);
  });

  it('fails wrong moves, wrong digits, a silent mouth, a swapped face, and a recording sent too fast', async () => {
    expect((await verifyLiveness({ ...base(), moves: ['right', 'up', 'left', 'down'] }, deps())).report.reasons).toContain('head_moves_wrong');
    expect((await verifyLiveness(base(), deps('one two three four'))).report.reasons).toContain('digits_wrong');
    expect((await verifyLiveness(base({ mouthMoves: false }), deps())).report.reasons).toContain('mouth_not_moving');
    expect((await verifyLiveness(base({ swapPersonAfterMs: 9000 }), deps())).report.reasons).toContain('face_changed');
    expect((await verifyLiveness({ ...base(), issuedAt: new Date() }, deps())).report.reasons).toContain('clock_mismatch');
    const failed = await verifyLiveness(base({ speak: false }), deps());
    expect(failed.report.reasons).toContain('no_voice');
    expect(failed.templates).toEqual([]);
  });

  it('refuses without speech recognition when speech is required', async () => {
    const r = await verifyLiveness(base(), { ...deps(), recognizer: null });
    expect(r.report.reasons).toContain('speech_unavailable');
  });
});
