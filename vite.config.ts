/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the build works on Netlify, Vercel and GitHub Pages sub-paths.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false },
  // Dev only: same-origin /api so the session cookie works (run the FastAPI backend on :8000).
  server: {
    host: '127.0.0.1', strictPort: true,
    watch: { ignored: ['**/output/**', '**/private-video-work/**', '**/tmp/**', '**/.taste-skill/**'] },
    proxy: { '/api': 'http://127.0.0.1:8000' },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/private-video-work/**'] },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
