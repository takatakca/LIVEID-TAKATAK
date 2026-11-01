import type { FaceAnalyzer } from '../face/analyzer.js';
import { findExpiry, type IdTextReader } from './ocr.js';

export interface IdThresholds {
  faceMatch: number;
  faceMatchRetryBand: number;
  faceReplay: number;
}

export interface IdReport {
  passed: boolean;
  reason?: string;
  retryable: boolean;
  similarity: number | null;
  faces: number;
  faceWidthRatio: number | null;
  textChars: number;
  expired: boolean | null;
}

/** Minimum letters/digits an ID front must show (name, dates, number). A selfie shows almost none. */
export const MIN_ID_TEXT_CHARS = 20;

/**
 * Checks the FRONT of an ID: there is a card with printed text, it carries a face photo, the card is not
 * expired (when the expiry date can be read), and the face photo is the same person as the live check.
 * `templates` are the face embeddings kept (sealed) from the live check.
 */
export async function verifyIdFront(
  analyzer: FaceAnalyzer,
  reader: IdTextReader | null,
  image: Buffer,
  templates: number[][],
  th: IdThresholds,
  now = new Date(),
): Promise<IdReport> {
  const base: IdReport = { passed: false, retryable: true, similarity: null, faces: 0, faceWidthRatio: null, textChars: 0, expired: null };
  if (!templates.length) return { ...base, reason: 'liveness_required', retryable: false };

  let frame;
  try {
    frame = await analyzer.analyze(image, { embedding: true });
  } catch {
    return { ...base, reason: 'id_image_unreadable' };
  }
  const faces = frame.faces.filter((f) => f.score >= 0.5).sort((a, b) => b.box[2] - a.box[2]);
  const report: IdReport = { ...base, faces: faces.length };
  const main = faces[0];
  if (!main || !main.embedding) return { ...report, reason: 'id_face_not_found' };
  report.faceWidthRatio = Number((main.box[2] / frame.width).toFixed(3));
  if (report.faceWidthRatio > 0.5) return { ...report, reason: 'id_looks_like_selfie' };
  if (report.faceWidthRatio < 0.04) return { ...report, reason: 'id_too_far' };
  // A second, smaller face is normal (the "ghost" photo on Canadian licences). A second big face is not.
  const second = faces[1];
  if (second && second.box[2] > main.box[2] * 0.6) return { ...report, reason: 'id_multiple_faces' };

  if (reader) {
    const text = await reader.read(image);
    report.textChars = text.chars;
    if (text.chars < MIN_ID_TEXT_CHARS) return { ...report, reason: 'id_text_not_found' };
    const expiry = findExpiry(text.text);
    if (expiry) {
      report.expired = expiry.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      if (report.expired) return { ...report, reason: 'id_expired', retryable: false };
    }
  }

  const sims = templates.map((t) => analyzer.similarity(t, main.embedding!)).sort((a, b) => b - a);
  const top = sims.slice(0, 3);
  const score = top.reduce((s, v) => s + v, 0) / top.length;
  report.similarity = Number(score.toFixed(3));
  if ((sims[0] ?? 0) >= th.faceReplay) return { ...report, reason: 'id_replay_suspected' };
  if (score >= th.faceMatch) return { ...report, passed: true, retryable: false };
  if (score >= th.faceMatchRetryBand) return { ...report, reason: 'id_match_uncertain' };
  return { ...report, reason: 'id_face_mismatch' };
}
