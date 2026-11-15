import { defineConfig } from 'vite';

// fs.allow reaches the repo root: Games/QuickDraw, docs/brand-kit and Packages/PearScript are imported from there, never copied.
export default defineConfig({
  // src-tauri/target is rewritten by cargo during desktop builds; watching it crashes Vite with EBUSY on Windows.
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] }, watch: { ignored: ['**/src-tauri/**'] } },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
