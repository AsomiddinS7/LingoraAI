/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on Netlify, Vercel and GitHub Pages sub-paths.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
