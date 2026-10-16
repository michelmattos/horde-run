import { defineConfig } from 'vite';

// Served from https://michelmattos.github.io/horde-run/ on GitHub Pages.
// `vite preview` serves the build, so it needs the same base as `vite build`.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/horde-run/' : '/',
  // Source maps let a stack trace from a phone's error report be mapped back to the source.
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: true },
}));
