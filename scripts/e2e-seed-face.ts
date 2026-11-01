// Test helper for scripts/e2e-browser.mjs ONLY (never used by the server).
// A fake camera cannot do a real live check, so to test the ID step in a real browser we mark the
// session's live check as passed and store the face template of the man in the sample photos —
// exactly what a passed live check stores. Usage:
//   tsx scripts/e2e-seed-face.ts fixtures            -> prints the fixture paths (JSON)
//   tsx scripts/e2e-seed-face.ts seed <sessionId>    -> needs DATABASE_URL and LIVEID_ENCRYPTION_KEY
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { HumanFaceAnalyzer } from '../src/face/analyzer.js';
import { Sealer } from '../src/lib/crypto.js';
import { makeFixtures } from '../test/helpers/fixtures.js';

const [cmd, sessionId] = process.argv.slice(2);
const fx = makeFixtures();
if (cmd === 'fixtures') {
  console.log(JSON.stringify({ specimen: fx.specimen, webcam: fx.webcam }));
  process.exit(0);
}
if (cmd !== 'seed' || !sessionId) {
  console.error('usage: e2e-seed-face.ts fixtures | seed <sessionId>');
  process.exit(2);
}
const analyzer = new HumanFaceAnalyzer();
await analyzer.ready();
const templates: number[][] = [];
for (const f of fx.same.slice(0, 3)) {
  const r = await analyzer.analyze(readFileSync(f), { embedding: true });
  const face = [...r.faces].sort((a, b) => b.box[2] - a.box[2])[0];
  if (face?.embedding) templates.push(face.embedding);
}
const sealer = new Sealer(Buffer.from(process.env.LIVEID_ENCRYPTION_KEY!, 'base64'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query('update liveid_sessions set liveness_passed_at = now(), face_template_sealed = $2 where id = $1', [
  sessionId,
  sealer.seal(JSON.stringify(templates), `session:${sessionId}:face`),
]);
await db.end();
console.log(`seeded ${templates.length} templates`);
process.exit(0);
