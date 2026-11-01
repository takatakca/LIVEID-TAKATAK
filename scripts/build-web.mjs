// Builds the browser files into public/assets (served at /assets/).
// app.js is small; the face detector (detector-*.js + its model) loads only when a camera opens.
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'assets');
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'models'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'src', 'web', 'app.ts')],
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  chunkNames: 'chunks/[name]-[hash]',
  target: ['es2020', 'safari15', 'chrome100', 'firefox100'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});
for (const f of ['styles.css', 'pcm-worklet.js', 'liveid.js']) await copyFile(path.join(root, 'web', f), path.join(out, f));
const models = path.resolve(path.dirname(require.resolve('@vladmandic/human')), '..', 'models');
for (const f of ['blazeface.json', 'blazeface.bin', 'facemesh.json', 'facemesh.bin']) await copyFile(path.join(models, f), path.join(out, 'models', f));
console.log('web assets built in public/assets');
