// Real browser checks. Speech events are explicitly stubbed for UI lifecycle tests;
// MediaPipe, local video decoding, model loading and camera permission are real.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const base = process.env.LINGORA_TEST_URL ?? 'http://localhost:5173';
const out = resolve('tmp/browser');
const modelPath=process.env.LINGORA_TEST_MODEL ?? 'public/model/trained-sign-model.json';
const currentBundle=JSON.parse(await readFile(modelPath,'utf8'));
const currentMotionModel=currentBundle.gallery??currentBundle;
const rejectedLabels=new Set(currentMotionModel.matching?.rejectionLabels??[]);
const expectedMotionLabels=new Set(currentMotionModel.templates.map(t=>t.label).filter(label=>!rejectedLabels.has(label))).size;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
] });
const errors = [];
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // No voice service is needed to verify that confirmation happens before playback.
  await context.addInitScript(() => {
    window.__spoken = [];
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    const synth = { getVoices: () => [{ name: 'Test Uzbek', lang: 'uz-UZ' }, { name: 'Test English', lang: 'en-US' }],
      addEventListener() {}, cancel() {}, speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 30); } };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.__micOpen = false;
    window.SpeechRecognition = class {
      start() {
        window.__micOpen = true;
        window.__testRecognizer = this;
        setTimeout(() => {
          if (!window.__micOpen) return;
          const result = [{ transcript: 'Yaxshi, rahmat.' }];
          result.isFinal = false;
          this.onresult?.({ resultIndex: 0, results: [result] });
        }, 30);
      }
      stop() { window.__micOpen = false; this.onend?.(); }
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/#/conversation', { waitUntil: 'networkidle' });
  console.log('browser: conversation loaded');
  await page.locator('#lang-select').selectOption('en');
  await page.getByText('Experimental sign recognition', { exact: true }).waitFor();
  await page.getByText(`${expectedMotionLabels} signs have video examples. Confirm the text before speaking.`).waitFor({ state: 'attached', timeout: 60000 });
  // This diagnostic explicitly stubs browser speech for UI lifecycle checks;
  // select that provider instead of inheriting the operator's local STT setting.
  await page.evaluate(() => { location.hash = '/console'; });
  await page.locator('#sw-sttProvider').selectOption('browser-speech');
  await page.locator('#sw-ttsProvider').selectOption('browser-synthesis');
  await page.evaluate(() => { location.hash = '/conversation'; });
  console.log('browser: model ready');
  checks.push(`real local motion model loaded: ${expectedMotionLabels} labels`);

  await page.getByText('Write a message instead', { exact: true }).click();
  await page.locator('#signer-message').fill('Salom, men yozish orqali gaplashaman.');
  await page.getByRole('button', { name: 'Review message', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__spoken.length), 0);
  await page.getByRole('button', { name: 'Speak', exact: true }).click();
  console.log('browser: confirmed typed speech');
  try { await page.waitForFunction(() => window.__spoken.length >= 1, undefined, { timeout: 5000 }); }
  catch (error) {
    await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true });
    console.log(await page.locator('body').innerText());
    console.log({ errors, spoken: await page.evaluate(() => window.__spoken) });
    throw error;
  }
  checks.push('typed signer message requires confirmation before speech (playback stub)');
  console.log('browser: speech stub checked');
  await page.locator('#reply').fill('Sizni tushundim.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Sizni tushundim.', { exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Simplify', exact: true }).count(), 0);
  checks.push('hearing-person typed reply appears; unavailable simplification is hidden');
  await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__micOpen), false);
  await page.getByRole('button', { name: 'I understand', exact: true }).click();
  await page.getByText('Yaxshi, rahmat.', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
  await page.waitForFunction(() => window.__micOpen === false);
  await page.getByRole('button', { name: 'Start microphone', exact: true }).click();
  await page.waitForFunction(() => window.__micOpen === true);
  await page.getByRole('link', { name: 'Help', exact: true }).first().click();
  await page.waitForFunction(() => window.__micOpen === false);
  await page.goto(base + '/#/conversation', { waitUntil: 'networkidle' });
  checks.push('speech UI notice, interim captions, stop and navigation cleanup (recognition stub)');

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: resolve(out, `conversation-${width}.png`), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `overflow at ${width}`);
  }
  checks.push('conversation has no horizontal overflow at desktop, tablet and phone widths');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await context.grantPermissions(['camera', 'microphone']);
  const startCamera = page.getByRole('button', { name: 'Turn on camera', exact: true });
  if (await startCamera.isVisible()) await startCamera.click();
  await page.locator('.camera video').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('button', { name: 'Sign now', exact: true }).click();
  // Check the fixed recording limit too. On slow CPU inference the short window
  // can finish while Playwright waits for a two-frame-stable manual Finish button.
  await page.getByText('Not recognized. Try again or choose a phrase', { exact: true }).waitFor({ timeout: 10000 });
  checks.push('real MediaPipe camera pipeline rejects fake-camera frames without hands');

  await page.goto(base + '/#/console', { waitUntil: 'networkidle' });
  await page.getByText('Examples from existing videos', { exact: true }).waitFor();
  const lesson = resolve('../lingora-video-tools-v0.1/video_2026-11-17_18-25-35.mp4');
  if (existsSync(lesson) && process.env.LINGORA_TEST_DEVELOPMENT_MODULES === 'true') {
    await page.locator('input[type=file][accept="video/*"]').setInputFiles(lesson);
    await page.locator('.video-fields').waitFor({ timeout: 15000 });
    // Exercise the browser extractor against a disjoint repetition before adding
    // any browser-extracted training example. This imports production modules
    // through the local Vite server; it is a development test, not a public hook.
    const browserMatch = await page.evaluate(async () => {
      const { extractVideoSequence } = await import('/src/ml/videoSequence.ts');
      const { sequenceStore } = await import('/src/ml/sequenceStore.ts');
      const video = document.querySelector('video.source-video');
      const frames = await extractVideoSequence(video, 627.75, 630.15);
      return sequenceStore.match(frames);
    });
    console.log('browser extracted held-out hello:', browserMatch);
    assert.equal(browserMatch.label, 'hello', 'browser extractor/model mismatch on held-out hello');
    checks.push('real browser-extracted held-out hello matches the prepared model');
    await page.locator('.video-fields input[type=number]').nth(0).fill('625.05');
    await page.locator('.video-fields input[type=number]').nth(1).fill('627.25');
    await page.getByRole('button', { name: 'Add this example', exact: true }).click();
    await page.getByText(/Added hello: \d+ frames\./).waitFor({ timeout: 60000 });
    checks.push('real local lesson decoding and two-hand/pose extraction produce a valid example');
  }
  const invalid = Buffer.from(JSON.stringify({ format: 'wrong', templates: [] }));
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: invalid });
  await page.getByText('Could not load this file.', { exact: false }).waitFor();
  checks.push('invalid example imports are rejected without erasing the active model');
  const model = resolve(modelPath);
  if (existsSync(model)) {
    const referenceCount = currentMotionModel.templates.length;
    await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles(model);
    await page.getByText(`Loaded ${referenceCount} examples.`, { exact: true }).waitFor();
    checks.push('compiled model can be reimported after an invalid file');
  }
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `console overflow at ${width}`);
  }
  assert.deepEqual(errors, [], 'browser runtime errors');
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} finally { await browser.close(); }
