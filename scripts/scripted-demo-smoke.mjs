// Browser test for the explicitly scripted demo, not recognition accuracy.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.LINGORA_PRESENTATION_TEST_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Stub the browser voice only for lifecycle/timing assertions. Hosted speech
  // is tested independently against the actual service.
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__activeSpeech = 0;
    window.__maxActiveSpeech = 0;
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    let current = null;
    const synth = {
      getVoices: () => [{ name: 'Test Uzbek', lang: 'uz-UZ' }],
      addEventListener() {},
      speak(utterance) {
        window.__spoken.push(utterance.text);
        window.__activeSpeech++;
        window.__maxActiveSpeech = Math.max(window.__maxActiveSpeech, window.__activeSpeech);
        current = { utterance, timer: setTimeout(() => { current = null; window.__activeSpeech--; utterance.onend?.(); }, 300) };
      },
      cancel() {
        if (!current) return;
        const { utterance, timer } = current;
        current = null; clearTimeout(timer); window.__activeSpeech--; utterance.onerror?.({ error: 'canceled' });
      },
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  });
  await page.goto(base + '/#/conversation', { waitUntil: 'domcontentloaded' });
  await page.locator('#lang-select').selectOption('en');
  await page.evaluate(async () => { const { runtime } = await import('/src/runtime.ts'); runtime.setConfig({ ttsProvider: 'browser-synthesis' }); });
  await page.getByText('This audio reads prepared text; the camera is not translating signs.').waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Scripted text demonstration' }).count(), 0);
  await page.getByText('Edit text and timing', { exact: true }).click();
  await page.locator('#scripted-demo-text').fill('Salom dunyo! Yaxshimisiz?');
  assert.equal(await page.locator('#scripted-demo-speed').inputValue(), '3');
  await page.getByRole('button', { name: 'Start audio', exact: true }).click();
  assert.equal(await page.locator('#scripted-demo-text').isVisible(), false);
  await page.waitForTimeout(1000);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(1000);
  assert.deepEqual(await page.evaluate(() => window.__spoken), []);
  await page.getByText('Edit text and timing', { exact: true }).click();
  await page.locator('#scripted-demo-speed').fill('0.5');
  await page.getByRole('button', { name: 'Start audio', exact: true }).click();
  await page.getByText('Prepared audio · 2/2', { exact: true }).waitFor({ timeout: 10000 });
  assert.deepEqual(await page.evaluate(() => window.__spoken), ['Salom dunyo!', 'Yaxshimisiz?']);
  assert.equal(await page.evaluate(() => window.__maxActiveSpeech), 1);
  assert.equal(await page.locator('#scripted-demo-text').isVisible(), false);
  assert.equal(await page.getByTestId('scripted-demo-output').count(), 0);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByText('Prepared audio · 0/2', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign recognition', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Start audio', exact: true }).count(), 0);
  assert.equal(await page.locator('nav a[href="#/presentation"]').count(), 0);
  await page.goto(base + '/#/presentation', { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Start audio', exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log('Scripted audio: delay, pause, ordered playback, reset, disclosure, mode switch and mobile width passed (browser voice stub).');
} finally { await browser.close(); }
