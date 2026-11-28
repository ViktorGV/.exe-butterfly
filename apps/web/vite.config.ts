import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { apiDevPlugin } from './dev/apiPlugin.ts';
import { racersPlugin } from './dev/racersPlugin.ts';

const root = fileURLToPath(new URL('.', import.meta.url));

// Every apps/web/demos/*.html page is built as an extra entry next to index.html.
const demoInputs = Object.fromEntries(
  readdirSync(resolve(root, 'demos'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [`demos/${f.slice(0, -5)}`, resolve(root, 'demos', f)]),
);

export default defineConfig({
  root,
  plugins: [apiDevPlugin({ apiDir: resolve(root, 'api') }), racersPlugin()],
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Three.js alone is ~540 KB raw (~135 KB gzipped); the real budget is 400 KB gzipped initial JS (#1).
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      input: { main: resolve(root, 'index.html'), ...demoInputs },
    },
  },
});
