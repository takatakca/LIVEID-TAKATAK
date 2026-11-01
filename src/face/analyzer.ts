import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Landmark-derived numbers for one face. Coordinates are in image pixels. */
export interface FaceMeasure {
  score: number;
  box: [number, number, number, number];
  /** nose offset from the eyes' midpoint, divided by inter-ocular distance */
  nx: number;
  ny: number;
  /** inner-lip gap / inter-ocular distance */
  mouth: number;
  /** anti-spoofing model, 0 (fake) .. 1 (real) */
  real?: number;
  /** liveness model, 0..1 */
  live?: number;
  embedding?: number[];
}

export interface FrameResult {
  width: number;
  height: number;
  faces: FaceMeasure[];
}

export interface AnalyzeOptions {
  embedding?: boolean;
  antispoof?: boolean;
}

export interface FaceAnalyzer {
  ready(): Promise<void>;
  analyze(jpegOrPng: Buffer, opts?: AnalyzeOptions): Promise<FrameResult>;
  /** 0..1, higher = more likely the same person. */
  similarity(a: number[], b: number[]): number;
}

/** Simple counting semaphore so CPU-heavy analyses never pile up. */
export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

// MediaPipe face mesh indices.
const EYE_OUTER_A = 33;
const EYE_OUTER_B = 263;
const NOSE_TIP = 1;
const LIP_UPPER_INNER = 13;
const LIP_LOWER_INNER = 14;

type Point = [number, number, number?];

export function measureFromMesh(mesh: Point[]): { nx: number; ny: number; mouth: number } | null {
  const a = mesh[EYE_OUTER_A];
  const b = mesh[EYE_OUTER_B];
  const nose = mesh[NOSE_TIP];
  const up = mesh[LIP_UPPER_INNER];
  const lo = mesh[LIP_LOWER_INNER];
  if (!a || !b || !nose || !up || !lo) return null;
  const io = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (io < 4) return null;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  return {
    nx: (nose[0] - mx) / io,
    ny: (nose[1] - my) / io,
    mouth: Math.hypot(lo[0] - up[0], lo[1] - up[1]) / io,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type HumanLib = { Human: new (config: Record<string, unknown>) => any };

/**
 * Face analysis on the server with @vladmandic/human on TensorFlow (tfjs-node): face detector,
 * 468-point face mesh, face embedding (faceres), anti-spoofing and liveness models. All models ship
 * inside the npm package, nothing is downloaded at runtime and no image leaves this process.
 */
export class HumanFaceAnalyzer implements FaceAnalyzer {
  private human: any;
  private loading?: Promise<void>;
  private readonly sem: Semaphore;

  constructor(private readonly opts: { modelsPath?: string } = {}) {
    // One analysis at a time per instance: Human merges per-call options into its shared config,
    // so two overlapping calls could swap options. TensorFlow already uses every CPU core inside a call.
    this.sem = new Semaphore(1);
  }

  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    const require = createRequire(import.meta.url);
    const lib = require('@vladmandic/human/dist/human.node.js') as HumanLib;
    const modelsDir = this.opts.modelsPath ?? path.resolve(path.dirname(require.resolve('@vladmandic/human/dist/human.node.js')), '..', 'models');
    this.human = new lib.Human({
      modelBasePath: pathToFileURL(modelsDir + path.sep).href,
      backend: 'tensorflow',
      debug: false,
      async: true,
      cacheSensitivity: 0,
      face: {
        enabled: true,
        // skipFrames/skipTime 0 + cacheSensitivity 0: every frame is analyzed fresh, never reused.
        detector: { rotation: true, maxDetected: 4, minConfidence: 0.35, minSize: 32, return: false, skipFrames: 0, skipTime: 0 },
        mesh: { enabled: true },
        iris: { enabled: false },
        attention: { enabled: false },
        description: { enabled: false, skipFrames: 0, skipTime: 0 },
        emotion: { enabled: false },
        antispoof: { enabled: false, skipFrames: 0, skipTime: 0 },
        liveness: { enabled: false, skipFrames: 0, skipTime: 0 },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
      segmentation: { enabled: false },
      filter: { enabled: false },
    });
    // Load every model we may switch on per call.
    await this.human.load({ face: { description: { enabled: true }, antispoof: { enabled: true }, liveness: { enabled: true } } });
    await this.human.warmup();
  }

  async analyze(image: Buffer, opts: AnalyzeOptions = {}): Promise<FrameResult> {
    await this.ready();
    return this.sem.run(async () => {
      const tf = this.human.tf;
      let tensor: any;
      try {
        tensor = tf.node.decodeImage(image, 3, 'int32', false);
      } catch {
        throw new Error('image_decode_failed');
      }
      try {
        const [height, width] = tensor.shape as [number, number, number];
        const res = await this.human.detect(tensor, {
          face: {
            description: { enabled: !!opts.embedding },
            antispoof: { enabled: !!opts.antispoof },
            liveness: { enabled: !!opts.antispoof },
          },
        });
        const faces: FaceMeasure[] = [];
        for (const f of res.face as any[]) {
          const m = f.mesh?.length >= 468 ? measureFromMesh(f.mesh as Point[]) : null;
          if (!m) continue;
          faces.push({
            score: Number(f.score ?? f.faceScore ?? 0),
            box: f.box as [number, number, number, number],
            nx: m.nx,
            ny: m.ny,
            mouth: m.mouth,
            real: typeof f.real === 'number' ? f.real : undefined,
            live: typeof f.live === 'number' ? f.live : undefined,
            embedding: opts.embedding && Array.isArray(f.embedding) && f.embedding.length ? (f.embedding as number[]) : undefined,
          });
        }
        return { width, height, faces };
      } finally {
        tf.dispose(tensor);
        // Let other requests run between frames.
        await new Promise((r) => setImmediate(r));
      }
    });
  }

  similarity(a: number[], b: number[]): number {
    if (!this.human) throw new Error('analyzer_not_ready');
    return Number(this.human.match.similarity(a, b));
  }
}
