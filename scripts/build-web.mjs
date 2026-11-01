// Builds the browser files into public/assets (served at /assets/).
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'assets');
await mkdir(out, { recursive: true });
await build({
  entryPoints: [path.join(root, 'src', 'web', 'app.ts')],
  outfile: path.join(out, 'app.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15', 'chrome100', 'firefox100'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});
for (const f of ['styles.css', 'pcm-worklet.js', 'liveid.js']) await copyFile(path.join(root, 'web', f), path.join(out, f));
console.log('web assets built in public/assets');
