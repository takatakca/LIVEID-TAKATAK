import { randomInt } from 'node:crypto';

export const MOVES = ['left', 'right', 'up', 'down'] as const;
export type Move = (typeof MOVES)[number];

export interface ChallengePlan {
  /** Time the person reads the digits aloud, starting at 0 ms. */
  speakMs: number;
  /** Time each head move prompt is shown. */
  moveMs: number;
  /** Pause facing the camera after each move. */
  centerMs: number;
  /** Frames per second the browser sends. */
  fps: number;
}

export const DEFAULT_PLAN: ChallengePlan = { speakMs: 5000, moveMs: 2200, centerMs: 900, fps: 5 };

export interface Challenge {
  digits: string;
  moves: Move[];
  plan: ChallengePlan;
}

/** Digits 1-9 (no 0, which people say as "oh", "zero" or "zéro"), no digit twice in a row. */
export function randomDigits(count = 4): string {
  let out = '';
  while (out.length < count) {
    const d = String(randomInt(1, 10));
    if (out.endsWith(d)) continue;
    out += d;
  }
  return out;
}

/** Head moves: no move twice in a row, at least one sideways and one up/down. */
export function randomMoves(count = 4): Move[] {
  for (;;) {
    const moves: Move[] = [];
    while (moves.length < count) {
      const m = MOVES[randomInt(0, MOVES.length)]!;
      if (moves[moves.length - 1] === m) continue;
      moves.push(m);
    }
    const sideways = moves.some((m) => m === 'left' || m === 'right');
    const vertical = moves.some((m) => m === 'up' || m === 'down');
    if (sideways && vertical) return moves;
  }
}

export function newChallenge(plan: ChallengePlan = DEFAULT_PLAN): Challenge {
  return { digits: randomDigits(4), moves: randomMoves(4), plan };
}

/** Expected recording length for a plan and a move count. */
export function expectedDurationMs(plan: ChallengePlan, moveCount: number): number {
  return plan.speakMs + moveCount * (plan.moveMs + plan.centerMs);
}
