import type { Move } from './challenge.js';

/**
 * Head direction from face landmarks, relative to the person's own neutral pose.
 *
 * Frames arrive as the camera sees them (not mirrored). When a person turns their head to THEIR left,
 * the nose tip moves toward the RIGHT of the image (+x). When they look UP, the nose tip (which sticks
 * out from the face) moves up relative to the eyes (−y). Offsets are divided by the distance between
 * the outer eye corners, so they do not depend on how far the person sits from the camera.
 */
export interface PoseSample {
  t: number;
  /** (nose.x − eyes-mid.x) / inter-ocular distance; null when no single face. */
  nx: number | null;
  /** (nose.y − eyes-mid.y) / inter-ocular distance. */
  ny: number | null;
}

export type PoseLabel = Move | 'center';

export interface PoseThresholds {
  yaw: number;
  pitch: number;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function classify(dx: number, dy: number, th: PoseThresholds): PoseLabel {
  const sx = Math.abs(dx) / th.yaw;
  const sy = Math.abs(dy) / th.pitch;
  if (sx < 1 && sy < 1) return 'center';
  if (sx >= sy) return dx > 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

export interface PoseRun {
  label: PoseLabel;
  start: number;
  end: number;
  frames: number;
}

/** Groups consecutive frames with the same label. Frames without a face break nothing; they are skipped. */
export function runs(samples: PoseSample[], baseline: { nx: number; ny: number }, th: PoseThresholds): PoseRun[] {
  const out: PoseRun[] = [];
  for (const s of samples) {
    if (s.nx === null || s.ny === null) continue;
    const label = classify(s.nx - baseline.nx, s.ny - baseline.ny, th);
    const last = out[out.length - 1];
    if (last && last.label === label) {
      last.end = s.t;
      last.frames++;
    } else {
      out.push({ label, start: s.t, end: s.t, frames: 1 });
    }
  }
  return out;
}

/** Ordered list of distinct head moves held for at least `minFrames` frames. */
export function observedMoves(r: PoseRun[], minFrames = 2): Move[] {
  const seq: Move[] = [];
  for (const run of r) {
    if (run.label === 'center' || run.frames < minFrames) continue;
    if (seq[seq.length - 1] !== run.label) seq.push(run.label);
  }
  return seq;
}

/** True when `expected` appears in order inside `observed` with at most `extra` additional moves. */
export function sequenceMatches(expected: readonly Move[], observed: readonly Move[], extra = 1): boolean {
  if (observed.length > expected.length + extra) return false;
  let i = 0;
  for (const m of observed) if (m === expected[i]) i++;
  return i === expected.length;
}

export interface PoseResult {
  passed: boolean;
  baseline: { nx: number; ny: number };
  observed: Move[];
  expected: Move[];
}

export function verifyPoseSequence(
  samples: PoseSample[],
  expected: Move[],
  th: PoseThresholds,
  neutralWindow?: { start: number; end: number },
): PoseResult {
  const neutral = samples.filter(
    (s) => s.nx !== null && s.ny !== null && (!neutralWindow || (s.t >= neutralWindow.start && s.t <= neutralWindow.end)),
  );
  const pool = neutral.length >= 3 ? neutral : samples.filter((s) => s.nx !== null && s.ny !== null);
  const baseline = { nx: median(pool.map((s) => s.nx!)), ny: median(pool.map((s) => s.ny!)) };
  const observed = observedMoves(runs(samples, baseline, th));
  return { passed: sequenceMatches(expected, observed), baseline, observed, expected };
}
