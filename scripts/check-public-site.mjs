// Public release verification: exact selected asset hashes and real camera/model UI.
// Uses a synthetic camera, never uploads or records a person's camera/microphone.
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const option = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const base = new URL(option('--url', 'https://asomiddins7.github.io/LingoraAI/'));
const out = resolve(option('--out', 'tmp/release'));
await mkdir(out, { recursive: true });
const en = JSON.parse(await readFile('src/i18n/en.json', 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const assets = [];
for (const file of ['model/trained-sign-model.json', 'model/signed-speech-model.json', 'model/hand_landmarker.task',
                    'model/pose_landmarker.task', 'THIRD_PARTY_NOTICES.md', 'licenses/Apache-2.0.txt']) {
  const response = await fetch(new URL(file, base), { cache: 'no-store', signal: AbortSignal.timeout(45_000) });
  assert.equal(response.status, 200, `Public asset missing: ${file}`);
  const remote = Buffer.from(await response.arrayBuffer());
  const local = await readFile(resolve('public', file));
  assert.equal(hash(remote), hash(local), `Public asset differs from selected local release: ${file}`);
  assets.push({ file, bytes: remote.length, sha256: hash(remote) });
}
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
] });
const checks = [], errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['camera'] });
  await context.addInitScript(() => localStorage.setItem('signconnect.lang', 'en'));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL('#/conversation', base).href, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('#lang-select').selectOption('en');
  await page.getByText('Demo: prepared audio', { exact: true }).waitFor();
  const startCamera = page.getByRole('button', { name: en['camera.start'], exact: true });
  if (await startCamera.isVisible()) await startCamera.click();
  await page.waitForFunction(() => [...document.querySelectorAll('video')].some(video => video.videoWidth > 0),
                             undefined, { timeout: 60_000 });
  checks.push('Camera opened with synthetic input');
  await page.screenshot({ path: resolve(out, 'conversation-desktop.png'), fullPage: true });
  await page.evaluate(() => { location.hash = '/presentation'; });
  await page.getByText('Demo: prepared audio', { exact: true }).waitFor({ timeout: 30_000 });
  checks.push('Previous presentation link opens the conversation');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(out, 'presentation-mobile.png'), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile page overflows horizontally');
  checks.push('390 px mobile layout has no horizontal overflow');
  assert.deepEqual(errors, [], 'Browser page errors');
  const report = { created_at: new Date().toISOString(), url: base.href, assets, checks, errors,
    camera: 'Chromium synthetic input; real MediaPipe inference; no speech or camera data uploaded',
    limits: 'Packaging and UI checks, not signer accuracy or physical-device validation' };
  await writeFile(resolve(out, 'public-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
