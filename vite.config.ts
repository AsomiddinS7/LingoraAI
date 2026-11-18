/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on Netlify, Vercel and GitHub Pages sub-paths.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false },
  // Dev only: same-origin /api so the session cookie works (run the FastAPI backend on :8000).
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
