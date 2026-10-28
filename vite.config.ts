/** Frontend bundling and same-origin development proxy; no external runtime assets. */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '#est-shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '#est-client': fileURLToPath(new URL('./src/client', import.meta.url)),
      '#est-server': fileURLToPath(new URL('./src/server', import.meta.url)),
    },
  },
  build: { outDir: 'dist/client' },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'] },
});
