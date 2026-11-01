import type { Config } from '../config.js';
import type { FaceAnalyzer, FaceMeasure } from '../face/analyzer.js';
import { AudioFormatError, durationMs, encodeWav, parseWav, sliceMs } from './audio.js';
import { verifyAvSync, type AvSyncResult } from './avsync.js';
import { minDurationMs, type ChallengePlan, type Move } from './challenge.js';
import { verifyPoseSequence, type PoseSample } from './pose.js';
import { verifySpokenDigits, type SpeechRecognizer, type SpeechResult } from './speech.js';

export interface LivenessInput {
  digits: string;
  moves: Move[];
  plan: ChallengePlan;
  issuedAt: Date;
  submittedAt: Date;
  /** Frames as captured by the camera (not mirrored), `t` = ms since recording start. */
  frames: Array<{ t: number; image: Buffer }>;
  /** 16 kHz mono 16-bit WAV, sample 0 = recording start. */
  audio: Buffer | null;
  /** When the browser showed the digits (ms since recording start). */
  speakWindow?: { start: number; end: number };
  locale: 'fr' | 'en';
}

export interface LivenessReport {
  passed: boolean;
  reasons: string[];
  durationMs: number;
  frames: { total: number; singleFace: number; multiFace: number; noFace: number };
  pose: { passed: boolean; observed: Move[]; expected: Move[] };
  identity: { frontalFrames: number; minSimilarity: number | null; passed: boolean };
  antispoof: { real: number | null; live: number | null };
  speech: SpeechResult | null;
  avsync: AvSyncResult | null;
}

export interface LivenessOutcome {
  report: LivenessReport;
  /** Face embeddings of the frontal frames; kept sealed for the ID step only. */
  templates: number[][];
}

const MIN_FACE_SCORE = 0.5;

function mean(v: number[]): number | null {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Picks up to `n` items spread evenly over the array. */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]!);
  return out;
}

/**
 * Decides whether a live person, in front of the camera right now, answered the random challenge:
 * one face only, the same face from start to end, the head moves in the asked order, the asked digits
 * heard in the audio, and the mouth moving with the voice. Everything is measured here on the server.
 */
export async function verifyLiveness(
  input: LivenessInput,
  deps: { analyzer: FaceAnalyzer; recognizer: SpeechRecognizer | null; thresholds: Config['thresholds']; requireSpeech: boolean },
): Promise<LivenessOutcome> {
  const th = deps.thresholds;
  const reasons = new Set<string>();
  const frames = [...input.frames].sort((a, b) => a.t - b.t);
  const span = frames.length ? frames[frames.length - 1]!.t - frames[0]!.t : 0;
  const report: LivenessReport = {
    passed: false,
    reasons: [],
    durationMs: Math.round(span),
    frames: { total: frames.length, singleFace: 0, multiFace: 0, noFace: 0 },
    pose: { passed: false, observed: [], expected: input.moves },
    identity: { frontalFrames: 0, minSimilarity: null, passed: false },
    antispoof: { real: null, live: null },
    speech: null,
    avsync: null,
  };
  const finish = (templates: number[][] = []): LivenessOutcome => {
    report.reasons = [...reasons];
    report.passed = reasons.size === 0;
    return { report, templates: report.passed ? templates : [] };
  };

  // 1. Timing: the recording must be as long as the challenge, and cannot arrive faster than real time.
  if (frames.length < 20 || span < minDurationMs(input.plan, input.moves.length)) {
    reasons.add('recording_too_short');
    return finish();
  }
  const elapsed = input.submittedAt.getTime() - input.issuedAt.getTime();
  if (elapsed + 1500 < span) {
    reasons.add('clock_mismatch');
    return finish();
  }

  // 2. Face on every frame.
  const perFrame: Array<{ t: number; face: FaceMeasure | null; image: Buffer }> = [];
  for (const f of frames) {
    let faces: FaceMeasure[] = [];
    try {
      faces = (await deps.analyzer.analyze(f.image)).faces.filter((x) => x.score >= MIN_FACE_SCORE);
    } catch {
      faces = [];
    }
    if (faces.length === 1) report.frames.singleFace++;
    else if (faces.length > 1) report.frames.multiFace++;
    else report.frames.noFace++;
    perFrame.push({ t: f.t, face: faces.length === 1 ? faces[0]! : null, image: f.image });
  }
  if (report.frames.multiFace > Math.max(2, frames.length * 0.05)) reasons.add('multiple_faces');
  if (report.frames.singleFace < frames.length * 0.8) reasons.add('face_not_visible');
  if (reasons.size) return finish();

  // 3. Head moves in the asked order.
  const speak = {
    start: Math.max(0, input.speakWindow?.start ?? 0),
    end: Math.min(input.plan.speakMs + 1500, input.speakWindow?.end ?? input.plan.speakMs),
  };
  const samples: PoseSample[] = perFrame.map((p) => ({ t: p.t, nx: p.face?.nx ?? null, ny: p.face?.ny ?? null }));
  const pose = verifyPoseSequence(samples, input.moves, { yaw: th.poseYaw, pitch: th.posePitch }, speak);
  report.pose = { passed: pose.passed, observed: pose.observed, expected: pose.expected };
  if (!pose.passed) reasons.add('head_moves_wrong');

  // 4. Same person all along: compare frontal frames from the start and from after the moves.
  const frontal = perFrame.filter(
    (p) => p.face && Math.abs(p.face.nx - pose.baseline.nx) < th.poseYaw * 0.5 && Math.abs(p.face.ny - pose.baseline.ny) < th.posePitch * 0.6,
  );
  const early = frontal.filter((p) => p.t <= speak.end);
  const late = frontal.filter((p) => p.t > speak.end);
  const picked = [...spread(early, 3), ...spread(late, 3)];
  const templates: number[][] = [];
  const reals: number[] = [];
  const lives: number[] = [];
  for (const p of picked) {
    try {
      const r = await deps.analyzer.analyze(p.image, { embedding: true, antispoof: true });
      const f = r.faces.filter((x) => x.score >= MIN_FACE_SCORE);
      if (f.length !== 1) continue;
      if (f[0]!.embedding) templates.push(f[0]!.embedding);
      if (typeof f[0]!.real === 'number') reals.push(f[0]!.real);
      if (typeof f[0]!.live === 'number') lives.push(f[0]!.live);
    } catch {
      // unreadable frame: skipped
    }
  }
  report.identity.frontalFrames = templates.length;
  if (templates.length < 3 || !early.length || !late.length) {
    reasons.add('not_enough_frontal_frames');
  } else {
    let min = 1;
    for (let i = 0; i < templates.length; i++)
      for (let j = i + 1; j < templates.length; j++) min = Math.min(min, deps.analyzer.similarity(templates[i]!, templates[j]!));
    report.identity.minSimilarity = Number(min.toFixed(3));
    report.identity.passed = min >= th.samePerson;
    if (!report.identity.passed) reasons.add('face_changed');
  }
  const real = mean(reals);
  const live = mean(lives);
  report.antispoof = { real: real === null ? null : Number(real.toFixed(3)), live: live === null ? null : Number(live.toFixed(3)) };
  if (real !== null && real < th.antispoofHardFail) reasons.add('spoof_suspected');

  // 5. Voice: the asked digits, said by this mouth, now.
  if (!input.audio) {
    reasons.add('no_audio');
    return finish(templates);
  }
  let pcm;
  try {
    pcm = parseWav(input.audio);
  } catch (e) {
    reasons.add(e instanceof AudioFormatError ? 'bad_audio' : 'no_audio');
    return finish(templates);
  }
  if (pcm.sampleRate !== 16000 || durationMs(pcm) < speak.end - 500) {
    reasons.add('bad_audio');
    return finish(templates);
  }
  const from = Math.max(0, speak.start - 300);
  const to = speak.end + 700;
  const speech = sliceMs(pcm, from, to);
  const mouth = perFrame.filter((p) => p.t >= from && p.t <= to).map((p) => ({ t: p.t - from, mouth: p.face?.mouth ?? null }));
  report.avsync = verifyAvSync(speech, mouth, { minMouthRange: th.mouthRange });
  for (const r of report.avsync.reasons) reasons.add(r);

  try {
    report.speech = await verifySpokenDigits(deps.recognizer, encodeWav(speech), input.digits, input.locale);
  } catch {
    report.speech = { status: 'unavailable', heard: '', provider: deps.recognizer?.name ?? 'none' };
    reasons.add('speech_error');
  }
  if (report.speech.status === 'fail') reasons.add('digits_wrong');
  if (report.speech.status === 'unavailable' && deps.requireSpeech) reasons.add('speech_unavailable');

  return finish(templates);
}
