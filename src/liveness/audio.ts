/** Minimal, strict WAV (RIFF PCM 16-bit mono) reader and writer plus a simple energy voice detector. */

export interface Pcm {
  sampleRate: number;
  samples: Int16Array;
}

export class AudioFormatError extends Error {}

export function parseWav(buf: Buffer): Pcm {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new AudioFormatError('not_wav');
  }
  let offset = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | undefined;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buf.length) throw new AudioFormatError('bad_fmt');
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!fmt) throw new AudioFormatError('data_before_fmt');
      if (fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16) throw new AudioFormatError('unsupported_format');
      if (fmt.rate < 8000 || fmt.rate > 48000) throw new AudioFormatError('unsupported_rate');
      const end = Math.min(buf.length, body + size);
      const len = Math.floor((end - body) / 2);
      const samples = new Int16Array(len);
      for (let i = 0; i < len; i++) samples[i] = buf.readInt16LE(body + i * 2);
      return { sampleRate: fmt.rate, samples };
    }
    offset = body + size + (size % 2);
  }
  throw new AudioFormatError('no_data');
}

export function encodeWav(pcm: Pcm): Buffer {
  const dataLen = pcm.samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(pcm.sampleRate, 24);
  buf.writeUInt32LE(pcm.sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < pcm.samples.length; i++) buf.writeInt16LE(pcm.samples[i]!, 44 + i * 2);
  return buf;
}

export function sliceMs(pcm: Pcm, startMs: number, endMs: number): Pcm {
  const a = Math.max(0, Math.floor((startMs / 1000) * pcm.sampleRate));
  const b = Math.min(pcm.samples.length, Math.ceil((endMs / 1000) * pcm.sampleRate));
  return { sampleRate: pcm.sampleRate, samples: pcm.samples.slice(a, Math.max(a, b)) };
}

export function durationMs(pcm: Pcm): number {
  return (pcm.samples.length / pcm.sampleRate) * 1000;
}

/** RMS energy per window (default 20 ms), normalized to 0..1. */
export function energyEnvelope(pcm: Pcm, windowMs = 20): number[] {
  const win = Math.max(1, Math.round((windowMs / 1000) * pcm.sampleRate));
  const out: number[] = [];
  for (let i = 0; i + win <= pcm.samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) {
      const v = pcm.samples[j]! / 32768;
      sum += v * v;
    }
    out.push(Math.sqrt(sum / win));
  }
  return out;
}

export interface VoiceActivity {
  /** Fraction of windows that contain voice. */
  voicedRatio: number;
  /** Number of separate voiced stretches (about one per spoken word). */
  segments: number;
  /** Per-window voiced flags. */
  voiced: boolean[];
  noiseFloor: number;
  peak: number;
  windowMs: number;
}

export function voiceActivity(pcm: Pcm, windowMs = 20): VoiceActivity {
  const env = energyEnvelope(pcm, windowMs);
  if (!env.length) return { voicedRatio: 0, segments: 0, voiced: [], noiseFloor: 0, peak: 0, windowMs };
  const sorted = [...env].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.1)]!;
  const peak = sorted[Math.floor(sorted.length * 0.98)]!;
  // Voice must stand clearly above the room noise and above an absolute minimum (about −46 dBFS).
  const threshold = Math.max(noiseFloor * 3, noiseFloor + (peak - noiseFloor) * 0.25, 0.005);
  const raw = env.map((e) => e > threshold);
  // Close gaps shorter than 100 ms, drop blips shorter than 60 ms.
  const voiced = smooth(raw, Math.round(100 / windowMs), Math.round(60 / windowMs));
  let segments = 0;
  for (let i = 0; i < voiced.length; i++) if (voiced[i] && !voiced[i - 1]) segments++;
  const voicedRatio = voiced.filter(Boolean).length / voiced.length;
  return { voicedRatio, segments, voiced, noiseFloor, peak, windowMs };
}

function smooth(flags: boolean[], maxGap: number, minRun: number): boolean[] {
  const out = [...flags];
  // fill short gaps
  let i = 0;
  while (i < out.length) {
    if (!out[i]) {
      let j = i;
      while (j < out.length && !out[j]) j++;
      if (i > 0 && j < out.length && j - i <= maxGap) for (let k = i; k < j; k++) out[k] = true;
      i = j;
    } else i++;
  }
  // remove short runs
  i = 0;
  while (i < out.length) {
    if (out[i]) {
      let j = i;
      while (j < out.length && out[j]) j++;
      if (j - i < minRun) for (let k = i; k < j; k++) out[k] = false;
      i = j;
    } else i++;
  }
  return out;
}
