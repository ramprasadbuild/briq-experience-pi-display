// Builds the Master Plan 3D scene (tv/src/masterplan) into one classic script, three.js included, and
// writes it into the tablet app as assets/web/masterplan.webjs (see its src/web/runtime.ts).
//   node scripts/build-masterplan-bundle.mjs [outFile]
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || resolve(root, '..', 'briq-experience-controller', 'assets', 'web', 'masterplan.webjs'));
const tmp = mkdtempSync(resolve(tmpdir(), 'briq-masterplan-'));
await build({
  configFile: false, root, logLevel: 'warn',
  build: {
    outDir: tmp, emptyOutDir: true, target: 'chrome100', minify: true,
    lib: { entry: resolve(root, 'tv/src/masterplan/bundle-entry.js'), formats: ['iife'], name: 'BriqMasterPlanBundle', fileName: () => 'masterplan.js' },
  },
});
copyFileSync(resolve(tmp, 'masterplan.js'), out);
rmSync(tmp, { recursive: true, force: true });
console.log('wrote', out);
