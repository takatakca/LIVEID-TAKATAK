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
 * Face analysis on the server, on TensorFlow (tfjs-node):
 * - @vladmandic/human: face detector, 468-point face mesh (head direction, mouth), anti-spoofing and
 *   liveness models;
 * - @vladmandic/face-api: ResNet face recognition (128-value descriptor) on an eye-aligned crop. It was
 *   chosen over Human's own embedding after measurement: on real photos Human's embedding scored two
 *   different women 0.56 (above some same-person pairs), the aligned ResNet separated every pair.
 * All models ship inside the npm packages: nothing is downloaded at runtime, no image leaves this process.
 */
export class HumanFaceAnalyzer implements FaceAnalyzer {
  private human: any;
  private faceapi: any;
  private loading?: Promise<void>;
  private readonly sem: Semaphore;

  constructor(private readonly opts: { modelsPath?: string; recognitionModelsPath?: string } = {}) {
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
    const lib = require('@vladmandic/human') as HumanLib;
    const modelsDir = this.opts.modelsPath ?? path.resolve(path.dirname(require.resolve('@vladmandic/human')), '..', 'models');
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
    await this.human.load({ face: { antispoof: { enabled: true }, liveness: { enabled: true } } });
    await this.human.warmup();
    // Face recognition: ResNet descriptor from @vladmandic/face-api (dlib-style network, 128 values).
    // It runs on the same TensorFlow instance as Human.
    const faceapi = require('@vladmandic/face-api/dist/face-api.node.js') as any;
    const faceapiModels = path.resolve(path.dirname(require.resolve('@vladmandic/face-api/dist/face-api.node.js')), '..', 'model');
    await faceapi.nets.faceRecognitionNet.loadFromDisk(this.opts.recognitionModelsPath ?? faceapiModels);
    this.faceapi = faceapi;
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
            description: { enabled: false },
            antispoof: { enabled: !!opts.antispoof },
            liveness: { enabled: !!opts.antispoof },
          },
        });
        const pixels: Int32Array | undefined = opts.embedding && res.face.length ? tensor.dataSync() : undefined;
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
            embedding: pixels ? await this.describe(pixels, width, height, f.mesh as Point[]) : undefined,
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

  /** 1 − Euclidean distance between ResNet descriptors: 0.5 ⇔ distance 0.5 (same person below ~0.5). */
  similarity(a: number[], b: number[]): number {
    return descriptorSimilarity(a, b);
  }

  /** Face straightened on the eye line, cropped and sent to the recognition network. */
  private async describe(pixels: Int32Array, width: number, height: number, mesh: Point[]): Promise<number[] | undefined> {
    const crop = alignedCrop(pixels, width, height, mesh);
    if (!crop) return undefined;
    const tf = this.human.tf;
    const input = tf.tensor3d(crop, [ALIGNED_SIZE, ALIGNED_SIZE, 3]);
    try {
      const d = (await this.faceapi.computeFaceDescriptor(input)) as Float32Array;
      return Array.from(d);
    } finally {
      tf.dispose(input);
    }
  }
}

export function descriptorSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return 1 - Math.sqrt(sum);
}

export const ALIGNED_SIZE = 150;

/**
 * Rotates the face so the eyes are level, scales it so the eye distance is fixed, and samples a
 * 150×150 RGB crop (bilinear). Done in plain JS: these TensorFlow image ops are missing on tfjs-node.
 */
export function alignedCrop(pixels: Int32Array | Uint8Array, width: number, height: number, mesh: Point[]): Float32Array | null {
  const l = mesh[EYE_OUTER_A];
  const r = mesh[EYE_OUTER_B];
  if (!l || !r) return null;
  const io = Math.hypot(r[0] - l[0], r[1] - l[1]);
  if (io < 8) return null;
  const angle = Math.atan2(r[1] - l[1], r[0] - l[0]);
  const cx = (l[0] + r[0]) / 2;
  const cy = (l[1] + r[1]) / 2;
  const S = ALIGNED_SIZE;
  const scale = (io * 2.2) / S;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x0 = S / 2;
  const y0 = 0.38 * S;
  const out = new Float32Array(S * S * 3);
  const at = (x: number, y: number, k: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : pixels[(y * width + x) * 3 + k]!);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xi = cx + scale * (cos * (x - x0) - sin * (y - y0));
      const yi = cy + scale * (sin * (x - x0) + cos * (y - y0));
      const xa = Math.floor(xi);
      const ya = Math.floor(yi);
      const fx = xi - xa;
      const fy = yi - ya;
      for (let k = 0; k < 3; k++) {
        out[(y * S + x) * 3 + k] =
          at(xa, ya, k) * (1 - fx) * (1 - fy) + at(xa + 1, ya, k) * fx * (1 - fy) + at(xa, ya + 1, k) * (1 - fx) * fy + at(xa + 1, ya + 1, k) * fx * fy;
      }
    }
  }
  return out;
}
