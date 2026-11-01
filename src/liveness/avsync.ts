import { energyEnvelope, voiceActivity, type Pcm } from './audio.js';

export interface MouthSample {
  /** ms from recording start */
  t: number;
  /** inner-lip gap / inter-ocular distance; null when no single face */
  mouth: number | null;
}

export interface AvSyncResult {
  passed: boolean;
  voicedRatio: number;
  segments: number;
  mouthRange: number;
  correlation: number;
  reasons: string[];
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]!;
}

/**
 * The voice must be live and come from this face: someone must be speaking (several voiced stretches),
 * the mouth must open and close, and mouth opening must rise and fall with the loudness of the voice.
 * A photo or a mask with a recording played next to it fails here even if the words are right.
 *
 * `audio` and `mouth` share the same clock: 0 ms = start of the speaking window.
 */
export function verifyAvSync(
  audio: Pcm,
  mouth: MouthSample[],
  opts: { minMouthRange: number; minCorrelation?: number; minVoicedRatio?: number; minSegments?: number },
): AvSyncResult {
  const minCorrelation = opts.minCorrelation ?? 0.12;
  const minVoicedRatio = opts.minVoicedRatio ?? 0.12;
  const minSegments = opts.minSegments ?? 2;
  const reasons: string[] = [];

  const va = voiceActivity(audio);
  if (va.voicedRatio < minVoicedRatio || va.segments < minSegments) reasons.push('no_voice');

  const valid = mouth.filter((m): m is { t: number; mouth: number } => m.mouth !== null);
  const values = valid.map((m) => m.mouth);
  const mouthRange = percentile(values, 0.9) - percentile(values, 0.1);
  if (valid.length < 5 || mouthRange < opts.minMouthRange) reasons.push('mouth_not_moving');

  // Loudness around each video frame (±100 ms), aligned to the frame times.
  const windowMs = 20;
  const env = energyEnvelope(audio, windowMs);
  const loud = valid.map((m) => {
    const a = Math.max(0, Math.floor((m.t - 100) / windowMs));
    const b = Math.min(env.length, Math.ceil((m.t + 100) / windowMs));
    let s = 0;
    for (let i = a; i < b; i++) s += env[i]!;
    return b > a ? s / (b - a) : 0;
  });
  const correlation = pearson(values, loud);
  if (correlation < minCorrelation) reasons.push('voice_not_in_sync');

  return {
    passed: reasons.length === 0,
    voicedRatio: Number(va.voicedRatio.toFixed(3)),
    segments: va.segments,
    mouthRange: Number(mouthRange.toFixed(4)),
    correlation: Number(correlation.toFixed(3)),
    reasons,
  };
}
