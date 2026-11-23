// Private reference preparation through the production browser VIDEO pipeline.
// Reviewed source windows are fixed. Matching thresholds are never adjusted here.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.LINGORA_TRACKING_TEST_URL ?? 'http://localhost:5173';
const option = (flag) => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
const selectedScope = option('--scope') ?? 'all';
if (!['all', 'greeting', 'speech'].includes(selectedScope)) throw new Error('--scope must be all, greeting or speech');
const out = resolve(option('--out') ?? 'private-video-work/tracking-v1');
const greetingNegatives = resolve(option('--greeting-negatives') ?? 'private-video-work/tracking-v1/greeting-templates-negative.json');
await mkdir(out, { recursive: true });
const scopes = [
  { name: 'greeting', review: 'private-video-work/greeting-review.json', source: resolve('../lingora-video-tools-v0.1/video_2026-11-17_18-25-35.mp4'), kind: 'lesson' },
  { name: 'speech', review: 'private-video-work/full-speech/speech-review.json', source: resolve('../../Telegram Desktop/doc_2026-11-20_17-11-40.mp4'), kind: 'recording' },
].filter((scope) => selectedScope === 'all' || scope.name === selectedScope);
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: [
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
] });
const report = { startedAt: new Date().toISOString(), scope: 'Reference preparation; speech source consistency is not held-out accuracy.', clips: [], evaluations: {}, errors: [] };
const datasets = {};
const save = () => writeFile(resolve(out, 'extraction-report.json'), JSON.stringify(report, null, 2));
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.routeWebSocket(/^wss?:\/\//, (socket) => socket.close({ code: 1000, reason: 'Reference preparation: HMR disabled' }));
  const page = await context.newPage();
  page.on('pageerror', (error) => { report.errors.push(error.message); console.error('browser error:', error.message); });
  await page.goto(base + '/#/console', { waitUntil: 'networkidle' });
  const runtime = await page.evaluate(async () => {
    const tracking = await import('/src/ml/handTracking.ts');
    await tracking.loadHandLandmarker();
    return { userAgent: navigator.userAgent, delegate: tracking.delegate, trackingProfile: tracking.TRACKING_PROFILE,
      handOptions: tracking.HAND_TRACKING_OPTIONS, sampleHz: 12.5, preRollSeconds: .5,
      timestampExport: 'absolute milliseconds within the original source video',
      endpointTrim: 'remove only leading and trailing frames without either hand' };
  });
  const hashes = {};
  for (const file of ['src/ml/handTracking.ts', 'src/ml/trackingClock.ts', 'src/ml/videoSequence.ts', 'src/ml/sequence.ts', 'public/model/hand_landmarker.task', 'public/model/pose_landmarker.task'])
    hashes[file] = createHash('sha256').update(await readFile(resolve(file))).digest('hex');
  const metadata = { ...runtime, node: process.version, browser: browser.version(),
    mediaPipe: JSON.parse(await readFile(resolve('node_modules/@mediapipe/tasks-vision/package.json'), 'utf8')).version,
    preparedAt: report.startedAt, hashes, matching: 'Unmodified production defaults', reviews: {} };
  await writeFile(resolve(out, 'runtime.json'), JSON.stringify(metadata, null, 2));
  console.log('runtime:', JSON.stringify(runtime));
  for (const scope of scopes) {
    const review = JSON.parse(await readFile(resolve(scope.review), 'utf8'));
    metadata.reviews[scope.name] = review;
    metadata.hashes[scope.source] = createHash('sha256').update(await readFile(scope.source)).digest('hex');
    await writeFile(resolve(out, 'runtime.json'), JSON.stringify(metadata, null, 2));
    datasets[scope.name] = { train: [], heldout: [], negative: [] };
    await page.locator('input[type=file][accept="video/*"]').setInputFiles(scope.source);
    await page.locator('.video-fields').waitFor({ timeout: 20000 });
    for (const segment of review.segments) {
      const nodeStart = performance.now();
      const extracted = await page.evaluate(async ({ segment, scope }) => {
        const { extractVideoSequence } = await import('/src/ml/videoSequence.ts');
        const { normalizeSequence } = await import('/src/ml/sequence.ts');
        const started = performance.now();
        const relative = await extractVideoSequence(document.querySelector('video.source-video'), segment.start_s, segment.end_s, { maxSeconds: 20 });
        const frames = relative.map((frame) => ({ ...frame, t: frame.t + segment.start_s * 1000 }));
        const first = frames.findIndex((frame) => frame.left || frame.right);
        let last = frames.length - 1;
        while (last > first && !frames[last].left && !frames[last].right) last--;
        const trimmed = first < 0 ? frames : frames.slice(first, last + 1);
        const stats = (input) => {
          let missing = 0, longest = 0, runs = 0, previousMissing = false;
          for (const frame of input) {
            const absent = !frame.left && !frame.right;
            if (absent) { missing++; longest = Math.max(longest, missing); if (!previousMissing) runs++; }
            else missing = 0;
            previousMissing = absent;
          }
          return { frames: input.length, anyHandCoverage: input.filter((f) => f.left || f.right).length / input.length,
            bothHandCoverage: input.filter((f) => f.left && f.right).length / input.length,
            leftCoverage: input.filter((f) => f.left).length / input.length,
            rightCoverage: input.filter((f) => f.right).length / input.length,
            poseCoverage: input.filter((f) => f.pose).length / input.length,
            missingRuns: runs, longestMissingFrames: longest, longestMissingMsApprox: longest * 80 };
        };
        const normalized = normalizeSequence(trimmed);
        return { template: { id: segment.id, label: segment.label, frames: trimmed,
          source: { kind: scope.kind, name: `${scope.sourceName} [${segment.start_s}-${segment.end_s}s]`, permission: scope.permission } },
          clip: { scope: scope.name, id: segment.id, label: segment.label, role: segment.role,
            start_s: segment.start_s, end_s: segment.end_s, raw: stats(frames), trimmed: stats(trimmed),
            normalized: Boolean(normalized), reference: normalized?.reference ?? null,
            firstRetainedSourceMs: trimmed[0]?.t, lastRetainedSourceMs: trimmed.at(-1)?.t,
            extractionMs: performance.now() - started } };
      }, { segment, scope: { name: scope.name, kind: scope.kind, sourceName: review.source_video, permission: review.permission_evidence } });
      extracted.clip.wallMs = performance.now() - nodeStart;
      datasets[scope.name][segment.role].push(extracted.template);
      report.clips.push(extracted.clip);
      for (const role of ['train', 'heldout', 'negative']) await writeFile(resolve(out, `${scope.name}-templates-${role}.json`), JSON.stringify({
        format: 'lingora-motion-templates', version: 1, templates: datasets[scope.name][role],
      }));
      await save();
      console.log('clip:', JSON.stringify(extracted.clip));
      if (segment.role === 'train' && !extracted.clip.normalized) {
        const issue = `Training reference has insufficient tracking: ${scope.name}/${segment.id}`;
        report.errors.push(issue); console.error(issue); await save();
      }
    }
    const invalid = report.clips.filter((clip) => clip.scope === scope.name && clip.role === 'train' && !clip.normalized);
    if (invalid.length) throw new Error(`${scope.name} has ${invalid.length} unusable reviewed training references; no model compiled`);
    const negatives = scope.name === 'speech'
      ? datasets.greeting?.negative ?? JSON.parse(await readFile(greetingNegatives, 'utf8')).templates
      : datasets[scope.name].negative;
    const result = await page.evaluate(async ({ training, heldout, negatives }) => {
      const { compileTemplateDataset } = await import('/src/ml/sequence.ts');
      const { createSequenceStore } = await import('/src/ml/sequenceStore.ts');
      const model = compileTemplateDataset(training);
      const rawStore = createSequenceStore(); rawStore.replace(training);
      const compiledStore = createSequenceStore(); compiledStore.importJson(JSON.stringify(model));
      const evaluate = (templates) => templates.map((template) => ({ id: template.id, expected: template.label,
        raw: rawStore.match(template.frames), compiled: compiledStore.match(template.frames) }));
      return { model, sourceConsistency: evaluate(training), heldout: evaluate(heldout), negatives: evaluate(negatives) };
    }, { training: datasets[scope.name].train, heldout: datasets[scope.name].heldout,
      negatives });
    const { model, ...evaluation } = result;
    report.evaluations[scope.name] = evaluation;
    await writeFile(resolve(out, `${scope.name}-model.json`), JSON.stringify(model));
    await save();
    for (const group of Object.values(evaluation)) for (const item of group) assert.deepEqual(item.raw, item.compiled, `${scope.name} raw/compiled mismatch for ${item.id}`);
    console.log('evaluation:', JSON.stringify({ scope: scope.name, ...evaluation }));
  }
  if (selectedScope !== 'speech') {
    assert.equal(datasets.greeting.train.length, 6); assert.equal(datasets.greeting.heldout.length, 5); assert.equal(datasets.greeting.negative.length, 3);
  }
  if (selectedScope !== 'greeting') assert.equal(datasets.speech.train.length, 6);
  report.finishedAt = new Date().toISOString();
  await save();
  console.log('complete:', JSON.stringify({ out, errors: report.errors, clips: report.clips.length }));
} catch (error) {
  report.errors.push(error.stack ?? String(error)); await save(); throw error;
} finally { await browser.close(); }
