import { cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'public', 'tv');

/** PDF.js needs its CMaps and standard font data at runtime; ship them with the app (offline). */
function copyPdfjsData() {
  return {
    name: 'briq-copy-pdfjs-data',
    apply: 'build',
    closeBundle() {
      for (const dir of ['cmaps', 'standard_fonts']) {
        cpSync(resolve(root, 'node_modules', 'pdfjs-dist', dir), resolve(outDir, 'pdfjs', dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: here,
  base: '/tv/',
  plugins: [react(), copyPdfjsData()],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    // `npm run dev:tv` against a running daemon.
    proxy: {
      '/local': { target: 'http://127.0.0.1:8787', ws: true },
      '/content': 'http://127.0.0.1:8787',
      '/relay': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
});
