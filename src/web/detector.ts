/*
 * In-browser face finder used ONLY to trigger captures at the right moment (face in the oval, card in
 * the frame). It never decides anything: the server re-checks every frame and photo it receives.
 * Loaded on demand (separate file) so the first screens stay light.
 */
import { Human } from '../../node_modules/@vladmandic/human/dist/human.esm.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  /** Head direction, same measure as the server: nose offset from the eyes' midpoint / eye distance. */
  pose?: { nx: number; ny: number };
}

export interface Detector {
  backend: string;
  faces(source: HTMLVideoElement | HTMLCanvasElement): Promise<Box[]>;
}

export async function createDetector(): Promise<Detector> {
  const config = {
    modelBasePath: '/assets/models/',
    backend: 'webgl',
    debug: false,
    warmup: 'none',
    cacheSensitivity: 0,
    face: {
      enabled: true,
      detector: { modelPath: 'blazeface.json', rotation: false, maxDetected: 3, minConfidence: 0.45, minSize: 16, return: false, skipFrames: 0, skipTime: 0 },
      mesh: { enabled: true, modelPath: 'facemesh.json' },
      attention: { enabled: false },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
    segmentation: { enabled: false },
    filter: { enabled: false },
  };
  let human = new Human(config as never);
  try {
    await human.load();
    await human.detect(blank());
  } catch {
    // No WebGL (old phone, locked-down browser): plain CPU is slower but works for this small model.
    human = new Human({ ...config, backend: 'cpu' } as never);
    await human.load();
  }
  return {
    backend: String(human.tf.getBackend?.() ?? 'unknown'),
    async faces(source) {
      const r = await human.detect(source);
      return (r.face ?? []).map((f) => {
        const mesh = f.mesh as unknown as number[][];
        // The library's box adds a wide margin (~1.6× the face): use the tight outline of the landmarks.
        const b = tightBox(mesh) ?? { x: f.box[0], y: f.box[1], w: f.box[2], h: f.box[3] };
        return { ...b, score: f.score, pose: poseOf(mesh) };
      });
    },
  };
}

function tightBox(mesh: number[][] | undefined): { x: number; y: number; w: number; h: number } | undefined {
  if (!mesh || mesh.length < 100) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of mesh) {
    x0 = Math.min(x0, p[0]!);
    y0 = Math.min(y0, p[1]!);
    x1 = Math.max(x1, p[0]!);
    y1 = Math.max(y1, p[1]!);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// MediaPipe face-mesh indices: outer eye corners and nose tip (identical to src/face/analyzer.ts).
function poseOf(mesh: number[][] | undefined): { nx: number; ny: number } | undefined {
  const a = mesh?.[33];
  const b = mesh?.[263];
  const n = mesh?.[1];
  if (!a || !b || !n) return undefined;
  const io = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  if (io < 4) return undefined;
  return { nx: (n[0]! - (a[0]! + b[0]!) / 2) / io, ny: (n[1]! - (a[1]! + b[1]!) / 2) / io };
}

function blank(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  return c;
}

/**
 * Sharpness and light of a region, from a small grey copy: variance of the Laplacian (blur makes it
 * small), mean brightness, and the share of blown-out pixels (glare on the card).
 */
export function imageQuality(video: HTMLVideoElement, region: { x: number; y: number; w: number; h: number }): { sharpness: number; brightness: number; glare: number } {
  const W = 320;
  const H = Math.max(1, Math.round((region.h / region.w) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(video, region.x, region.y, region.w, region.h, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const grey = new Float32Array(W * H);
  let sum = 0;
  let blown = 0;
  for (let i = 0; i < W * H; i++) {
    const v = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
    grey[i] = v;
    sum += v;
    if (v > 248) blown++;
  }
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const lap = grey[i - W]! + grey[i + W]! + grey[i - 1]! + grey[i + 1]! - 4 * grey[i]!;
      n++;
      const delta = lap - mean;
      mean += delta / n;
      m2 += delta * (lap - mean);
    }
  }
  return { sharpness: n > 1 ? m2 / (n - 1) : 0, brightness: sum / (W * H), glare: blown / (W * H) };
}
