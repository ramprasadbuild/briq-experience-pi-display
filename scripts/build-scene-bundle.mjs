// Builds the Inventory 3D scene (tv/src/scene3d) into one classic script, three.js included, and
// writes it into the tablet app as assets/web/scene3d.webjs (see its src/web/runtime.ts).
//   node scripts/build-scene-bundle.mjs [outFile]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || resolve(root, '..', 'briq-experience-controller', 'assets', 'web', 'scene3d.webjs'));
const tmp = mkdtempSync(resolve(tmpdir(), 'briq-scene-'));
await build({
  configFile: false, root, logLevel: 'warn',
  build: {
    outDir: tmp, emptyOutDir: true, target: 'chrome100', minify: true,
    lib: { entry: resolve(root, 'tv/src/scene3d/bundle-entry.js'), formats: ['iife'], name: 'BriqSceneBundle', fileName: () => 'scene3d.js' },
  },
});
copyFileSync(resolve(tmp, 'scene3d.js'), out);
rmSync(tmp, { recursive: true, force: true });
console.log('wrote', out);
