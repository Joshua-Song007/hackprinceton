import { defineConfig } from 'vitest/config';

// `?raw` imports (prelude.js, .usis.jsonl) are handled by Vite itself, so Vitest needs no plugin.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'studio/test/**/*.test.ts'],
    environment: 'node',
  },
});
