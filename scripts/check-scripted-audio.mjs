// Play the bundled introduction through the real browser audio element.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const site = process.env.LINGORA_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], jobs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/gradio_api/call/')) jobs.push(request.url()); });
  await page.addInitScript(() => {
    window.__audioChecks = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const row = { ended: false, duration: 0 }; window.__audioChecks.push(row);
      this.addEventListener('loadedmetadata', () => { row.duration = this.duration; }, { once: true });
      this.addEventListener('ended', () => { row.ended = true; }, { once: true });
      return play.call(this);
    };
  });
  await page.goto(site + '/#/conversation', { waitUntil: 'domcontentloaded' });
  await page.locator('#lang-select').selectOption('en');
  await page.getByText('Edit text and timing', { exact: true }).click();
  await page.locator('#scripted-demo-speed').fill('0.5');
  await page.getByRole('button', { name: 'Start audio', exact: true }).click();
  await Promise.race([
    page.getByText('Prepared audio · 6/6', { exact: true }).waitFor({ timeout: 90000 }),
    page.getByRole('region', { name: 'Prepared text' }).getByRole('alert').waitFor({ timeout: 90000 })
      .then(() => { throw new Error('Bundled audio playback failed'); }),
  ]);
  const audio = await page.evaluate(() => window.__audioChecks);
  assert.equal(audio.length, 6);
  assert(audio.every(a => a.ended && a.duration > 0));
  assert.equal(jobs.length, 0);
  assert.equal(await page.locator('#scripted-demo-text').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ bundledAudioPlayed: audio.length, durations: audio.map(a => a.duration), hostedJobs: jobs.length, physicalPhoneTested: false }));
} finally { await browser.close(); }
