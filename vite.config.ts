import { defineConfig } from 'vite';

// Served from https://michelmattos.github.io/horde-run/ on GitHub Pages.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/horde-run/' : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
}));
