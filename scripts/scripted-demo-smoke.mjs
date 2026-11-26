// Synthetic hand frames exercise timing, pause and resume; not sign-language accuracy.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.LINGORA_PRESENTATION_TEST_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = descriptor => descriptor.name === 'camera' ? Promise.resolve({ state: 'prompt' }) : query(descriptor);
  });
  await page.goto(base + '/#/conversation', { waitUntil: 'domcontentloaded' });
  await page.locator('#lang-select').selectOption('en');
  await page.evaluate(async () => {
    const { handTracking } = await import('/src/ml/handTracking.ts');
    const listeners = new Set();
    handTracking.subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
    window.__hand = x => {
      const points = Array.from({ length: 21 }, () => ({ x, y: .5, z: 0 }));
      for (const listener of listeners) listener({ left: points, right: null, at: performance.now(), width: 640, height: 480 });
    };
    window.__plays = 0; window.__pauses = 0;
    const play = HTMLMediaElement.prototype.play, pause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.play = function () { if (this instanceof HTMLAudioElement) window.__plays++; return play.call(this); };
    HTMLMediaElement.prototype.pause = function () { if (this instanceof HTMLAudioElement && !this.paused) window.__pauses++; return pause.call(this); };
  });
  assert.equal(await page.getByText('Demo: prepared audio', { exact: true }).count(), 0);
  if (process.env.LINGORA_SCREENSHOT) await page.screenshot({ path: process.env.LINGORA_SCREENSHOT, fullPage: true });
  await page.getByRole('button', { name: 'Turn on camera', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some(v => v.videoWidth > 0));
  await page.locator('.hand-overlay').waitFor({ timeout: 60000 });
  await page.evaluate(() => window.__hand(.2));
  await page.getByText('Hand detected', { exact: true }).waitFor();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.__plays), 0, 'A stationary hand should not start playback');
  await page.evaluate(() => window.__hand(.3));
  await page.getByText('Tracking hand movement', { exact: true }).waitFor();
  await page.waitForFunction(() => window.__plays >= 1);
  await page.waitForFunction(() => window.__pauses >= 1, undefined, { timeout: 5000 });
  await page.evaluate(() => window.__hand(.4));
  await page.waitForFunction(() => window.__plays >= 2);
  assert.equal(await page.locator('#reply').count(), 0);
  await page.goto(base + '/#/sign', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign now', exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await page.getByText('No video examples loaded. Phrases and typing still work.', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Load video examples' }).count(), 0);
  const spoken = await page.evaluate(async () => {
    const { SignAudioTts } = await import('/src/providers/signAudio.ts');
    let fallbackCalled = false;
    const voice = new SignAudioTts({ speak: async () => { fallbackCalled = true; }, cancel: () => {} });
    await voice.speak('Salom.', 'uz');
    return { fallbackCalled };
  });
  assert.equal(spoken.fallbackCalled, false, 'Trial word must play the bundled clip');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  console.log('Movement-controlled prepared audio: stillness, start, pause, resume and mobile layout passed with synthetic landmarks.');
} finally { await browser.close(); }
