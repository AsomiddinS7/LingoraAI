// Real camera/MediaPipe test. Synthetic references exercise UI/rejection only,
// never sign-language accuracy. No mocked inference or STT/TTS events.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.LINGORA_PRESENTATION_TEST_URL ?? 'http://localhost:5173';
const out = resolve('tmp/presentation');
const privateOut = resolve('private-video-work/full-speech');
const prepareReferences = process.argv.includes('--prepare-references');
const allPhrases = prepareReferences || process.argv.includes('--all-phrases');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
] });
const checks = [];
const errors = [];
const synthetic = (label) => ({ format: 'lingora-motion-templates', version: 1, templates: [{
  id: 'synthetic-ui-fixture', label,
  source: { kind: 'other', name: 'Synthetic UI fixture; not a signed phrase' },
  frames: Array.from({ length: 12 }, (_, i) => ({ t: i * 80, left: Array.from({ length: 21 }, (_, j) => ({
    x: .2 + (j % 4) * .02 + i * .001, y: .3 + Math.floor(j / 4) * .02, z: 0,
  })), right: null })),
}] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // Isolate this long diagnostic from Vite hot reload while other fixes proceed.
  await context.routeWebSocket(/^wss?:\/\//, (socket) => socket.close({ code: 1000, reason: 'Stable source verification; HMR disabled' }));
  await context.route('**/model/signed-speech-model.json', (route) => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ format: 'lingora-motion-templates', version: 1, templates: [] }),
  }));
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/#/presentation', { waitUntil: 'networkidle' });
  await page.locator('#lang-select').selectOption('en');
  await page.getByRole('heading', { name: 'Signed speech recognition', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sign recognition', exact: true }).click();
  // Vite-only test access clears bundled data so the empty state remains testable.
  await page.evaluate(async () => {
    const { loadHandLandmarker } = await import('/src/ml/handTracking.ts');
    await loadHandLandmarker();
    const { signedSpeechStore } = await import('/src/ml/signedSpeechStore.ts');
    signedSpeechStore.clear();
  });
  await page.getByText('No verified references for this speech are loaded.', { exact: false }).waitFor();
  assert(await page.getByRole('button', { name: 'Sign a phrase', exact: true }).isDisabled());
  assert.equal(await page.locator('.stage [lang=uz]').count(), 0);
  assert.equal(await page.getByRole('button', { name: /^(Next|Read the whole speech|Read this sentence)$/ }).count(), 0);
  checks.push('empty references disable inference; no prepared script is emitted as camera output');

  const details = page.locator('summary').filter({ hasText: 'Prepare speech references from an existing video' });
  await details.click();
  const importer = page.locator('input[type=file][accept="application/json,.json"]');
  await importer.setInputFiles({ name: 'wrong-vocabulary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(synthetic('hello'))) });
  await page.getByText('Could not load this file.', { exact: false }).waitFor();
  assert(await page.getByRole('button', { name: 'Sign a phrase', exact: true }).isDisabled());
  checks.push('greeting-label imports are rejected by the dedicated speech store');

  const candidate = resolve(process.env.LINGORA_SIGNED_VIDEO ?? 'C:/Users/asomi/Downloads/Telegram Desktop/doc_2026-11-20_17-11-40.mp4');
  await page.locator('input[type=file][accept="video/*"]').setInputFiles(candidate);
  await page.locator('.video-fields').waitFor();
  const select = page.locator('.video-fields select');
  assert.deepEqual(await select.locator('option').evaluateAll((options) => options.map((option) => option.value)),
    ['speech_01', 'speech_02', 'speech_03', 'speech_04', 'speech_05', 'speech_06']);
  const extract = page.getByRole('button', { name: 'Add this example', exact: true });
  const confirmation = page.getByRole('checkbox', { name: 'I verified that this video interval signs this exact phrase.', exact: true });
  assert(await extract.isDisabled());
  await confirmation.check();
  assert(await extract.isEnabled());
  await page.locator('.video-fields input[type=number]').first().fill('0.1');
  assert.equal(await confirmation.isChecked(), false);
  assert(await extract.isDisabled());
  await page.locator('.video-fields input[type=number]').nth(1).fill('14');
  await confirmation.check();
  assert(await extract.isEnabled(), 'long speech phrases may exceed the normal 12-second vocabulary limit');
  await page.locator('.video-fields input[type=number]').nth(1).fill('21');
  await confirmation.check();
  assert(await extract.isDisabled(), 'speech intervals must remain bounded to 20 seconds');
  // No unverified example is extracted or assigned a real phrase label.
  checks.push('six phrase labels are available; extraction requires confirmation and resets it after interval edits');

  await importer.setInputFiles({ name: 'synthetic-ui-only.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(synthetic('speech_01'))) });
  await page.getByText('Loaded 1 examples.', { exact: true }).waitFor();
  await details.click();
  await context.grantPermissions(['camera']);
  await page.getByRole('button', { name: 'Turn on camera', exact: true }).click();
  await page.locator('.camera video').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Sign a phrase', exact: true }).click();
  await page.getByRole('button', { name: 'Finish and recognize', exact: true }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Finish and recognize', exact: true }).click();
  await page.getByText('No reliable match. Try signing again.', { exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await page.locator('.stage [lang=uz]').count(), 0);
  checks.push('real MediaPipe and MotionRecognizer reject fake-camera frames without hands and emit no script');

  await page.locator('#reply').fill('Sizni tushundim.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Sizni tushundim.', { exact: true }).first().waitFor();
  checks.push('shared conversation displays a real typed listener reply');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${width}`);
    await page.screenshot({ path: resolve(out, `signed-speech-${width}.png`), fullPage: true });
  }
  checks.push('desktop, tablet and phone layouts have no horizontal overflow');
  // Restore the configured model and verify actual browser extraction from its
  // existing source. This is source replay consistency, never held-out accuracy.
  await context.unroute('**/model/signed-speech-model.json');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Sign recognition', exact: true }).click();
  const labels = await page.evaluate(async () => {
    const { signedSpeechStore } = await import('/src/ml/signedSpeechStore.ts');
    const deadline = performance.now() + 60000;
    while (signedSpeechStore.all().length !== 6 && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    return Object.keys(signedSpeechStore.counts()).sort();
  });
  assert.deepEqual(labels, ['speech_01', 'speech_02', 'speech_03', 'speech_04', 'speech_05', 'speech_06']);
  await page.locator('summary').filter({ hasText: 'Prepare speech references from an existing video' }).click();
  await page.locator('input[type=file][accept="video/*"]').setInputFiles(candidate);
  await page.locator('.video-fields').waitFor();
  await page.evaluate(async () => {
    const { handTracking } = await import('/src/ml/handTracking.ts');
    const deadline = performance.now() + 5000;
    while (handTracking.active() && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (handTracking.active()) throw new Error('Camera tracking did not detach before source extraction');
  });
  const review = JSON.parse(await readFile(resolve('private-video-work/full-speech/speech-review.json'), 'utf8'));
  const runtimeMetadata = await page.evaluate(async () => ({
    userAgent: navigator.userAgent, delegate: (await import('/src/ml/handTracking.ts')).delegate,
    runningMode: 'VIDEO', trackingProfile: (await import('/src/ml/handTracking.ts')).TRACKING_PROFILE,
    samplingHz: 12.5, endpointTrim: 'remove only leading/trailing frames without either hand',
  }));
  const hashes = {};
  for (const file of ['src/ml/handTracking.ts', 'src/ml/videoSequence.ts', 'src/ml/sequence.ts', 'public/model/hand_landmarker.task', 'public/model/pose_landmarker.task'])
    hashes[file] = createHash('sha256').update(await readFile(resolve(file))).digest('hex');
  if (prepareReferences) await writeFile(resolve(privateOut, 'browser-training-runtime.json'), JSON.stringify({
    method: 'Reference template preparation with the production browser extractor; no neural training.',
    timestamp: new Date().toISOString(), node: process.version, browser: browser.version(),
    mediaPipe: JSON.parse(await readFile(resolve('node_modules/@mediapipe/tasks-vision/package.json'), 'utf8')).version,
    ...runtimeMetadata, hashes, review,
    evaluationScope: 'One source take per phrase; source matching and raw/compiled parity are not held-out accuracy.',
  }, null, 2));
  const replays = [];
  const browserTemplates = [];
  for (const segment of allPhrases ? review.segments : review.segments.slice(0, 1)) {
    const { rawTemplate, ...replay } = await page.evaluate(async (segment) => {
      const { extractVideoSequence } = await import('/src/ml/videoSequence.ts');
      const { signedSpeechStore } = await import('/src/ml/signedSpeechStore.ts');
      const source = document.querySelector('video.source-video');
      const frames = await extractVideoSequence(source, segment.start_s, segment.end_s, { maxSeconds: 20 });
      // Same empty-endpoint removal as MotionRecognizer; never bridge dropouts.
      const first = frames.findIndex((frame) => frame.left || frame.right);
      let last = frames.length - 1;
      while (last > first && !frames[last].left && !frames[last].right) last--;
      const trimmed = first < 0 ? frames : frames.slice(first, last + 1);
      const tracked = frames.filter((frame) => frame.left || frame.right).length;
      const trimmedTracked = trimmed.filter((frame) => frame.left || frame.right).length;
      const result = signedSpeechStore.match(trimmed);
      return { expected: segment.label, start_s: segment.start_s, end_s: segment.end_s,
        ...result, frames: frames.length, trimmedFrames: trimmed.length,
        handCoverage: tracked / frames.length, trimmedHandCoverage: trimmedTracked / trimmed.length,
        trimmedDurationMs: trimmed.length ? trimmed.at(-1).t - trimmed[0].t : 0,
        rawTemplate: { id: `${segment.id}-browser`, label: segment.label, frames: trimmed,
          source: { kind: 'recording', name: `Existing signed-speech recording [${segment.start_s}-${segment.end_s}s]; browser extraction; audio-aligned reference only` } } };
    }, segment);
    replays.push(replay);
    browserTemplates.push(rawTemplate);
    console.log('actual browser source replay:', replay);
    if (prepareReferences) await writeFile(resolve(privateOut, 'browser-motion-templates.json'), JSON.stringify({
      format: 'lingora-motion-templates', version: 1, templates: browserTemplates,
    }));
    await writeFile(resolve(out, 'source-replays.json'), JSON.stringify({
      scope: 'Same-source browser/Python consistency only; not held-out accuracy.', replays,
    }, null, 2));
  }
  const failures = replays.filter((replay) => replay.label !== replay.expected);
  if (failures.length) console.warn('Configured model source mismatches (no threshold tuning):', failures.map((result) => result.expected));
  if (prepareReferences) {
  const compiled = await page.evaluate(async (templates) => {
    const { compileTemplateDataset } = await import('/src/ml/sequence.ts');
    const { createSequenceStore } = await import('/src/ml/sequenceStore.ts');
    const model = compileTemplateDataset(templates);
    const rawStore = createSequenceStore(); rawStore.replace(templates);
    const compiledStore = createSequenceStore(); compiledStore.importJson(JSON.stringify(model));
    const parity = templates.map((template) => ({ expected: template.label,
      raw: rawStore.match(template.frames), compiled: compiledStore.match(template.frames) }));
    return { model, parity };
  }, browserTemplates);
  await writeFile(resolve(privateOut, 'browser-signed-speech-model.json'), JSON.stringify(compiled.model));
  await writeFile(resolve(privateOut, 'browser-source-consistency.json'), JSON.stringify({
    scope: 'Same-source extraction/serialization consistency only, not held-out recognition accuracy.',
    configuredModelReplays: replays, configuredModelFailures: failures.map((result) => result.expected),
    browserRawCompiledParity: compiled.parity,
  }, null, 2));
  for (const result of compiled.parity) {
    assert.equal(result.raw.label, result.expected);
    assert.equal(result.compiled.label, result.expected);
    assert.deepEqual(result.compiled, result.raw);
  }
  checks.push('all six real browser source clips were retained privately and browser-derived raw/compiled matching agrees (no held-out accuracy claim)');
  } else {
    assert.equal(failures.length, 0, 'Configured model rejected a source replay; tests do not replace it with fitted examples');
    checks.push(`${replays.length} source clips match the configured model without modifying references (not held-out accuracy)`);
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} finally { await browser.close(); }
