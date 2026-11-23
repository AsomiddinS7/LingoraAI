// Real MediaPipe comparison on existing footage, not a sign-recognition accuracy test.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext();
  await context.routeWebSocket(/^wss?:\/\//, socket => socket.close());
  const page = await context.newPage();
  await page.goto('http://localhost:5173/#/console', { waitUntil: 'networkidle' });
  await page.locator('input[type=file][accept="video/*"]').setInputFiles(resolve('../../Telegram Desktop/doc_2026-11-20_17-11-40.mp4'));
  await page.waitForFunction(() => document.querySelector('video.source-video')?.readyState >= 2);
  const results = await page.evaluate(async () => {
    const { FilesetResolver, HandLandmarker } = await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
    const files = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm', document.baseURI).href);
    const tracker = await HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: new URL('model/hand_landmarker.task', document.baseURI).href, delegate: 'CPU' },
      runningMode: 'IMAGE', numHands: 2,
    });
    const video = document.querySelector('video.source-video');
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const draw = canvas.getContext('2d');
    const times = [];
    for (const [start, end] of [[1, 13.5], [24, 38.4]]) for (let t = start; t <= end; t += .125) times.push(t);
    const results = [];
    let clock = 0;
    for (const config of [
      { name: 'original-image', runningMode: 'IMAGE', minHandDetectionConfidence: .5, minHandPresenceConfidence: .5 },
      { name: 'continuous-video', runningMode: 'VIDEO', minHandDetectionConfidence: .5, minHandPresenceConfidence: .5 },
      { name: 'continuous-video-recovery', runningMode: 'VIDEO', minHandDetectionConfidence: .4, minHandPresenceConfidence: .4 },
    ]) {
      const { name, ...options } = config;
      await tracker.setOptions({ ...options, minTrackingConfidence: .5 });
      const counts = []; const processing = [];
      for (const t of times) {
        await new Promise((done, fail) => {
          const timer = setTimeout(() => fail(new Error('Video seek timed out')), 8000);
          video.addEventListener('seeked', () => { clearTimeout(timer); done(); }, { once: true }); video.currentTime = t;
        });
        draw.drawImage(video, 0, 0);
        const before = performance.now(); clock += 125;
        const result = config.runningMode === 'VIDEO' ? tracker.detectForVideo(canvas, clock) : tracker.detect(canvas);
        processing.push(performance.now() - before); counts.push(result.landmarks.length);
      }
      let current = 0, longest = 0;
      for (const n of counts) { current = n ? 0 : current + 1; longest = Math.max(longest, current); }
      processing.sort((a,b) => a-b);
      results.push({ name, frames: counts.length, anyHand: counts.filter(n => n > 0).length,
        bothHands: counts.filter(n => n === 2).length, longestEmptyFrames: longest,
        averageHandMs: processing.reduce((a,b) => a+b, 0) / processing.length,
        p95HandMs: processing[Math.floor(processing.length * .95)] });
    }
    tracker.close(); return results;
  });
  await mkdir('tmp/tracking', { recursive: true });
  await writeFile('tmp/tracking/hand-continuity.json', JSON.stringify({ scope: 'Same existing recording, same frames, CPU; visibility and speed, not language accuracy', results }, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
