import { defineConfig } from 'vite';

// Served from https://michelmattos.github.io/horde-run/ on GitHub Pages.
// `vite preview` serves the build, so it needs the same base as `vite build`.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/horde-run/' : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
}));
