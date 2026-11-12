// Copies the MediaPipe WASM runtime into public/ so it is served from our own origin (no CDN).
import { cpSync, mkdirSync } from 'node:fs';
const from = new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url);
const to = new URL('../public/mediapipe/wasm/', import.meta.url);
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log('[copy-mediapipe] wasm runtime copied to public/mediapipe/wasm');
