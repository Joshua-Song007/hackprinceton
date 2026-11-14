import { defineConfig } from 'vite';

// fs.allow reaches the repo root: Games/Flagship, docs/brand-kit and Packages/OmniScript are imported from there, never copied.
export default defineConfig({
  // src-tauri/target is rewritten by cargo during desktop builds; watching it crashes Vite with EBUSY on Windows.
  server: { port: 5173, strictPort: true, fs: { allow: ['../..'] }, watch: { ignored: ['**/src-tauri/**'] } },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
