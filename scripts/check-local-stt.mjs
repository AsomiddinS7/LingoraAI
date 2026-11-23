// Real local STT flow: existing WAV -> Chromium capture -> MediaRecorder -> HTTP model -> Chat.
// No model response, microphone callback, or application provider is mocked.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';

const args = process.argv.slice(2);
const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const wav = resolve(value('--wav', 'tmp/stt/lesson-uzbek-0-18.wav'));
const service = value('--service', 'http://127.0.0.1:8791');
const app = value('--app', 'http://localhost:5173/#/conversation');
const duration = Number(value('--duration-ms', '18000'));
const expectNoSpeech = args.includes('--expect-no-speech');
const out = resolve(value('--out', 'private-video-work/speech-evaluation/free-candidates/local-ui.json'));
const health = await (await fetch(`${service}/api/health`)).json();
if (!health.ready || !health.languages?.includes('uz')) throw new Error('Local Uzbek model is not ready.');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required',
] });
let page;
try {
  const context = await browser.newContext({ permissions: ['microphone'] });
  await context.addInitScript(() => localStorage.setItem('signconnect.lang', 'uz'));
  page = await context.newPage();
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) console.error(message.text()); });
  page.on('request', request => { if (request.url().includes('/api/transcribe')) console.log(`Transcription request: ${request.method()} ${request.url()}`); });
  page.on('requestfailed', request => { if (request.url().includes('/api/transcribe')) console.error(request.failure()); });
  await page.goto(app, { waitUntil: 'domcontentloaded' });
  if (!args.includes('--configured-provider')) {
    await page.evaluate(async service => {
      const { runtime } = await import('/src/runtime.ts');
      runtime.setConfig({ sttProvider: 'local-stt', localSttUrl: service });
    }, service);
  }
  console.log('Local STT UI loaded; starting prerecorded microphone capture.');
  // Attach a rejection handler immediately: failures are reported with UI diagnostics below.
  const responsePromise = page.waitForResponse(response =>
    response.url().startsWith(`${service}/api/transcribe`) && response.request().method() === 'POST', { timeout: 150_000 });
  void responsePromise.catch(() => {});
  const mic = page.locator('.composer .mic');
  await mic.click();
  const consent = page.getByRole('button', { name: 'Tushundim', exact: true });
  if (await consent.isVisible()) await consent.click();
  await page.waitForFunction(() => document.querySelector('.composer .mic')?.getAttribute('aria-pressed') === 'true',
                             undefined, { timeout: 10_000 });
  await page.waitForTimeout(duration);
  if (await mic.getAttribute('aria-pressed') === 'true') await mic.click();
  console.log('Microphone capture stopped; waiting for actual model response.');
  const response = await responsePromise;
  const actual = await response.json();
  if (!response.ok()) throw new Error(`Actual STT endpoint returned HTTP ${response.status()}`);
  if (expectNoSpeech) {
    if (actual.text !== '') throw new Error('Expected empty recognition for this silence recording.');
    await page.waitForFunction(() => document.querySelector('.chat .notice.warn[role="alert"]'), undefined, { timeout: 10_000 });
  } else {
    await page.waitForFunction(() => document.querySelectorAll('.msg-listener:not(.msg-live) .msg-text').length > 0,
                               undefined, { timeout: 10_000 });
  }
  const messages = await page.locator('.msg-listener:not(.msg-live) .msg-text').allTextContents();
  if (!expectNoSpeech && (!actual.text?.trim() || !messages.includes(actual.text.trim()))) throw new Error('Actual model transcript did not reach Chat.');
  if (expectNoSpeech && messages.length) throw new Error('Silence must not create an invented message.');
  const noSpeechNotice = await page.locator('.chat .notice.warn').allTextContents();
  const errors = await page.locator('.chat .notice.bad').allTextContents();
  if (errors.length) throw new Error('Chat displayed a speech error.');
  await mkdir(dirname(out), { recursive: true });
  const screenshot = out.replace(/\.json$/, '.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  const report = { created_at: new Date().toISOString(), health, modelResponse: actual,
    source: { file: wav, sha256: createHash('sha256').update(await readFile(wav)).digest('hex') },
    input: 'existing recording through Chromium virtual microphone; physical microphone untested',
    flow: 'application microphone -> MediaRecorder -> actual local inference -> Chat',
    captureMs: duration, transcript: messages.join(' '), noSpeechNotice, errors, screenshot, engineVersion: browser.version() };
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ provider: actual.provider, model: actual.model, transcript: report.transcript,
    audioSeconds: actual.duration_seconds, processingMs: actual.processing_ms, errors, report: out }));
} catch (error) {
  await mkdir(dirname(out), { recursive: true });
  if (page) {
    await page.screenshot({ path: out.replace(/\.json$/, '.failure.png'), fullPage: true }).catch(() => {});
    console.error((await page.locator('body').innerText().catch(() => '')).slice(-3000));
  }
  throw error;
} finally {
  await browser.close();
}
