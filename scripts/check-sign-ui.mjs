// UI integration only: the recognizer is mocked; model accuracy is tested separately.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.LINGORA_PRESENTATION_TEST_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base + '/#/sign', { waitUntil: 'domcontentloaded' });
  await page.locator('#lang-select').selectOption('uz');
  await page.evaluate(async () => {
    const { runtime } = await import('/src/runtime.ts');
    runtime.setConfig({ recognizer: 'mock', ttsProvider: 'huggingface', speechSpaceUrl: 'https://example.com',
      signWindow: { ...runtime.get().config.signWindow, countdownMs: 100, maxRecordingMs: 1200 } });
    window.__played = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLAudioElement) window.__played.push(this.src);
      return play.call(this);
    };
  });
  const startCamera = page.getByRole('button', { name: 'Kamerani yoqish', exact: true });
  if (await startCamera.isVisible()) await startCamera.click();
  const sign = page.getByRole('button', { name: 'Ishora qilish', exact: true });
  await sign.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some(video => video.videoWidth > 0));
  if (process.env.LINGORA_SCREENSHOT) await page.screenshot({ path: process.env.LINGORA_SCREENSHOT, fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 8).map(el => ({ tag: el.tagName, className: el.className?.toString(), right: el.getBoundingClientRect().right })) }));
  assert(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow));
  await sign.click();
  const speak = page.getByRole('button', { name: 'Oʻqish', exact: true });
  await speak.waitFor({ timeout: 20000 });
  await speak.click();
  await page.waitForFunction(() => window.__played.some(src => src.endsWith('/audio/signs/hello.wav')));
  assert.equal(await page.getByText('Video namunalarini yuklash', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Video namunalari yuklanmagan. Iboralar va yozish ishlaydi.', { exact: true }).count(), 0);
  console.log('Recognition UI: separate section and confirmed word to audio passed with a mocked recognition result.');
} finally { await browser.close(); }
