// Real native browser STT diagnostic. It does not inject fake recognition or results.
// A prerecorded WAV is fed through Chromium's fake audio-capture device. No real
// microphone or new participant recording is used. Audio may reach the browser vendor.
// node scripts/check-real-stt.mjs --wav tmp/stt/lesson-uzbek-0-18.wav --audio-track
// --audio-track uses the native start(audioTrack) overload to keep the controlled
// input explicit; omit it to diagnose the browser's default microphone capture.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const args = process.argv.slice(2);
const configuredProvider = args.includes('--configured-provider');
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const wav = resolve(value('--wav', 'tmp/stt/lesson-uzbek-0-18.wav'));
if (!existsSync(wav)) throw new Error('Provide a controlled, prerecorded WAV via --wav. A silent/fake beep is not a speech test.');
const url = value('--url', 'http://localhost:8787/#/conversation');
const channels = value('--channels', 'chrome,msedge').split(',');
const language = value('--lang', 'uz-UZ');
const duration = Number(value('--duration-ms', '24000'));
const audioTrackInput = args.includes('--audio-track');
const adapterMode = args.includes('--adapter');
const uiMode = args.includes('--ui');
const out = resolve(value('--out', 'tmp/stt/native-results.json'));
const results = [];

for (const channel of channels) {
  let browser;
  try {
    browser = await chromium.launch({ channel, headless: true, args: [
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required',
    ] });
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    if (uiMode) await page.addInitScript(() => localStorage.setItem('signconnect.lang', 'uz'));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    let result;
    if (uiMode) {
      if (!configuredProvider) await page.evaluate(async () => {
        const { runtime } = await import('/src/runtime.ts');
        runtime.setConfig({ sttProvider: 'browser-speech' });
      });
      const mic = page.locator('.composer .mic');
      await mic.click();
      const notice = page.getByRole('button', { name: 'Tushundim', exact: true });
      if (await notice.isVisible()) await notice.click();
      await page.waitForTimeout(duration);
      const partial = await page.locator('.msg-live .msg-text').textContent().catch(() => '');
      if (await mic.getAttribute('aria-pressed') === 'true') await mic.click();
      await page.waitForFunction(() => document.querySelector('.composer .mic')?.getAttribute('aria-pressed') === 'false', undefined, { timeout: 8000 });
      const finalMessages = await page.locator('.msg-listener:not(.msg-live) .msg-text').allTextContents();
      const screenshot = out.replace(/\.json$/, '') + `-${channel}.png`;
      await mkdir(resolve(screenshot, '..'), { recursive: true });
      await page.screenshot({ path: screenshot, fullPage: true });
      result = { supported: true, nativeConstructor: await page.evaluate(() => String(window.SpeechRecognition ?? window.webkitSpeechRecognition).includes('[native code]')),
        language: 'uz-UZ', input: 'actual application microphone button → BrowserSpeechStt → Chat',
        partial, transcript: finalMessages.join(' '), finalMessages, errors: await page.locator('.chat .notice.bad').allTextContents(),
        screenshot, endReason: 'ui_microphone_stopped' };
    } else result = await page.evaluate(({ language, duration, audioTrackInput, adapterMode }) => new Promise(async (resolve) => {
      const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (typeof Ctor !== 'function') return resolve({ supported: false, transcript: '', errors: ['unsupported'] });
      if (adapterMode) {
        const errors = []; const events = []; let transcript = ''; let finished = false; let adapter;
        const done = async (reason) => {
          if (finished) return; finished = true; clearTimeout(timer);
          await adapter?.stop();
          resolve({ supported: true, nativeConstructor: String(Ctor).includes('[native code]'), language,
            input: 'actual BrowserSpeechStt adapter', transcript, errors, events, endReason: reason });
        };
        const timer = setTimeout(() => void done('diagnostic_stop'), duration);
        try {
          const { BrowserSpeechStt } = await import('/src/providers/stt.ts');
          adapter = new BrowserSpeechStt((error) => { errors.push(error.code); void done('adapter_error'); });
          await adapter.start(language.split('-')[0], (text, final) => {
            transcript = text;
            events.push({ event: 'adapter_text', final, text, at: Math.round(performance.now()) });
          });
        } catch (error) { errors.push(error.code ?? error.name); void done('adapter_start_exception'); }
        return;
      }
      const events = [];
      const errors = [];
      let transcript = '';
      let finished = false;
      let audioRms = null;
      let captureStream;
      // Snapshot the virtual capture level. Silence at this instant does not
      // establish sample silence (the clip may begin with a pause).
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        captureStream = stream;
        const audio = new AudioContext();
        const source = audio.createMediaStreamSource(stream);
        const analyser = audio.createAnalyser(); source.connect(analyser);
        await new Promise((r) => setTimeout(r, 1000));
        const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
        audioRms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
        if (!audioTrackInput) stream.getTracks().forEach((track) => track.stop());
        await audio.close();
      } catch (error) { errors.push('capture:' + error.name); }
      const recognition = new Ctor();
      recognition.lang = language; recognition.continuous = true; recognition.interimResults = true;
      const done = (reason) => {
        if (finished) return; finished = true; clearTimeout(timer);
        recognition.onend = null; try { recognition.stop(); } catch {}
        captureStream?.getTracks().forEach((track) => track.stop());
        resolve({ supported: true, nativeConstructor: String(Ctor).includes('[native code]'), language, audioRms,
          input: audioTrackInput ? 'explicit audio track' : 'default browser capture', transcript, errors, events, endReason: reason });
      };
      const timer = setTimeout(() => done('diagnostic_timeout'), duration);
      for (const event of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'audioend'])
        recognition.addEventListener(event, () => events.push({ event, at: Math.round(performance.now()) }));
      recognition.onresult = (e) => {
        transcript = Array.from(e.results).map((r) => r[0]?.transcript?.trim()).filter(Boolean).join(' ');
        events.push({ event: 'result', final: e.results[e.results.length - 1]?.isFinal,
          alternatives: Array.from(e.results).map((r) => ({ count: r.length, transcript: r[0]?.transcript, confidence: r[0]?.confidence })),
          at: Math.round(performance.now()) });
      };
      recognition.onerror = (e) => { errors.push(e.error); events.push({ event: 'error', code: e.error }); };
      recognition.onend = () => done('native_end');
      try {
        if (audioTrackInput) recognition.start(captureStream?.getAudioTracks()[0]);
        else recognition.start();
      } catch (error) { errors.push(error.name); done('start_exception'); }
    }), { language, duration, audioTrackInput, adapterMode });
    results.push({ channel, engineVersion: browser.version(), source: `${basename(wav)}, virtual capture device`,
      actualTranscriptionProduced: Boolean(result.transcript?.trim()), ...result });
  } catch (error) { results.push({ channel, actualTranscriptionProduced: false, diagnosticFailure: error.message }); }
  finally { await browser?.close(); }
  const latest = results.at(-1);
  console.log(JSON.stringify({ ...latest, events: latest.events?.length }));
}
await mkdir(resolve(out, '..'), { recursive: true });
await writeFile(out, JSON.stringify({ note: 'Native browser engine test, no recognition mocks. A nonempty transcript still requires human comparison against the sample before claiming accuracy.', results }, null, 2));
console.log(`Saved native STT evidence: ${out}`);
