// Actual MediaPipe pixel extraction and live frame-pump replay; never mock predictions.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('private-video-work/training-expanded-v1');
const mediaDirectory = process.env.LINGORA_SIMULATION_MEDIA ? resolve(process.env.LINGORA_SIMULATION_MEDIA) : resolve(root, 'simulation');
const directory = process.env.LINGORA_SIMULATION_OUTPUT ? resolve(process.env.LINGORA_SIMULATION_OUTPUT) : mediaDirectory;
await mkdir(directory,{recursive:true});
const trackingMode = process.argv.find(arg=>arg.startsWith('--tracking-mode='))?.split('=')[1];
if (trackingMode && !['legacy','stable','recovery'].includes(trackingMode)) throw new Error('Invalid tracking mode');
const base = process.env.LINGORA_TEST_URL ?? 'http://localhost:5173';
const pixelsOnly = process.argv.includes('--pixels-only'), liveOnly = process.argv.includes('--live-only');
const production = process.argv.includes('--production');
const allLiveCases = process.argv.includes('--all-live-cases');
const forcePhrase = process.argv.includes('--force-phrase');
const demoScope = process.argv.includes('--demo-scope');
const captureCountdown = process.argv.includes('--capture-countdown');
const startDuringCountdown = process.argv.includes('--start-during-countdown');
const countdownMs = Number(process.argv.find(arg => arg.startsWith('--countdown-ms='))?.split('=')[1] ?? 0);
if (!Number.isFinite(countdownMs) || countdownMs < 0 || countdownMs > 5000) throw new Error('Invalid countdown');
const requested = process.argv.find(arg => arg.startsWith('--labels='))?.slice('--labels='.length).split(',');
const requestedIds = process.argv.find(arg => arg.startsWith('--case-ids='))?.slice('--case-ids='.length).split(',');
const quiet=process.env.LINGORA_QUIET_SIMULATION==='1';
const reportFile = liveOnly ? 'live-results.json' : 'results.json';
const manifest = JSON.parse(await readFile(resolve(mediaDirectory, 'manifest.json'), 'utf8'));
const skeletal = process.argv.includes('--skeletal');
const classifierPath = process.env.LINGORA_CLASSIFIER_PATH ?? resolve(root, (skeletal ? 'skeletal' : 'temporal') + '/candidate-model.json');
const neuralText = production ? null : await readFile(classifierPath, 'utf8');
const galleryText = production ? null : await readFile(process.env.LINGORA_GALLERY_PATH ?? resolve(root, 'baseline-model.json'), 'utf8');
const productionText = production ? await readFile('public/model/trained-sign-model.json', 'utf8') : null;
const phraseText = await readFile('public/model/signed-speech-model.json', 'utf8');
const hash = data => createHash('sha256').update(data).digest('hex');
const files = new Map(manifest.cases.map(c => [c.file, c]));
const report = { format: 'lingora-camera-simulation-results-v1', startedAt: new Date().toISOString(),
  limitations: manifest.limitations, realLifeSignerTest: false, neuralSha256: neuralText ? hash(neuralText) : null, gallerySha256: galleryText ? hash(galleryText) : null,
  pixelScenarios: manifest.scenarios, pixelCases: [], liveCases: [], errors: [] };
const tracked = [];
const liveTracked = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.routeWebSocket(/^wss?:\/\//, socket => socket.close({ code: 1000, reason: 'Private reproducible simulation' }));
  await context.route('**/__sign_sim__/*', async route => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));
    const entry = files.get(name);
    if (!entry) return route.abort();
    const bytes = await readFile(resolve(mediaDirectory, name));
    assert.equal(hash(bytes), entry.sha256, `Simulation pixels changed: ${name}`);
    await route.fulfill({ status: 200, contentType: 'video/mp4', body: bytes });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base + '/#/console', { waitUntil: 'networkidle' });
  await page.bringToFront();
  report.runtime = await page.evaluate(async ({ neuralText, galleryText, phraseText, skeletal, trackingMode, productionText }) => {
    const matcher = await import('/src/ml/sequence.ts');
    const tracking = await import('/src/ml/videoSequence.ts');
    const { parseTemporalCandidate } = await import('/scripts/temporal-inference.mjs');
    const { parseSkeletalCandidate, inferSkeletalCandidate } = await import('/scripts/skeletal-inference.mjs');
    const { createHybridClassifier } = await import('/scripts/hybrid-sign-inference.mjs');
    if (trackingMode) tracking.setTrackingMode(trackingMode);
    await tracking.loadHandLandmarker();
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.width = 640; video.height = 480;
    video.style.cssText = 'position:fixed;top:0;left:0;width:640px;height:480px;z-index:99999;background:#222';
    document.body.append(video);
    const gallery = galleryText ? matcher.parseMotionModel(galleryText) : null;
    const { createSequenceStore } = await import('/src/ml/sequenceStore.ts');
    const productionStore = productionText ? createSequenceStore() : null;
    if (productionStore) productionStore.importJson(productionText);
    const { signedSpeechStore: phraseStore } = await import('/src/ml/signedSpeechStore.ts');
    phraseStore.importJson(phraseText);
    window.__simulation = { video, matcher, tracking, gallery,
      productionStore, phraseStore,
      phrase: matcher.parseMotionModel(phraseText), classify: gallery ? createHybridClassifier(matcher, gallery,
        skeletal ? parseSkeletalCandidate(neuralText) : parseTemporalCandidate(neuralText), skeletal ? inferSkeletalCandidate : undefined) : null };
    return { delegate: tracking.delegate, poseDelegate:tracking.poseDelegate, trackingProfile: tracking.TRACKING_PROFILE, browser: navigator.userAgent,
      pixelFramesPerSecond: 12.5, liveFramePump: 'production requestVideoFrameCallback; collection capped at20Hz',
      liveTiming: 'Scripted user-start/sign-finish windows. No automatic continuous-language segmentation or fresh signer test.' };
  }, { neuralText, galleryText, phraseText, skeletal, trackingMode, productionText });
  report.runtime.classifierPath = production ? 'production trained bundle and sequence store' : 'research hybrid classifier';
  report.runtime.captureExperiment = { countdownMs, captureCountdown, startDuringCountdown };
  if (productionText) report.runtime.productionBundleSha256 = hash(productionText);
  const limit = process.argv.includes('--probe') ? 6 : manifest.cases.length;
  for (const test of liveOnly ? [] : manifest.cases.filter(c => !requested || requested.includes(c.expected)).slice(0, limit)) {
    const result = await page.evaluate(async test => {
      const s = window.__simulation, video = s.video;
      const objectUrl = URL.createObjectURL(await (await fetch('/__sign_sim__/' + encodeURIComponent(test.file))).blob());
      if (video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve; video.onerror = () => reject(new Error('Simulation MP4 decode failed'));
        video.src = objectUrl; video.load();
      });
      const { extractVideoSequence } = await import('/src/ml/videoSequence.ts');
      const recoveryEvents=[];let recoveredSoFar=0;
      const frames = await extractVideoSequence(video, 0, video.duration - .001, { maxSeconds: 20,
        onProgress:()=>{const d=s.tracking.trackingDiagnostics();if(d.recoveredHands>recoveredSoFar)
          recoveryEvents.push({frameIndex:d.frames-1,recovered:d.recoveredHands-recoveredSoFar});recoveredSoFar=d.recoveredHands;} });
      const diagnostics=s.tracking.trackingDiagnostics();
      if(diagnostics.frames!==frames.length || (test.trackingMode&&diagnostics.mode!==test.trackingMode))
        throw new Error('Tracker instance mismatch: diagnostic frame count/mode must match actual extraction');
      const started = performance.now();
      const result = test.scope === 'phrase'
        ? { result: s.phraseStore.match(frames) }
        : s.productionStore ? { result: s.productionStore.match(frames) } : s.classify(frames);
      return { ...result, frames, inferenceMs: performance.now() - started,
        trackingDiagnostics:diagnostics,recoveryEvents,
        anyHandCoverage: frames.filter(f => f.left || f.right).length / frames.length,
        bothHandCoverage: frames.filter(f => f.left && f.right).length / frames.length };
    }, {...test,trackingMode});
    const { frames, ...metrics } = result;
    tracked.push({ ...test, frames });
    report.pixelCases.push({ ...test, ...metrics, predicted: metrics.result.label });
    report.runtime.sharedTrackerVerified=true;
    await writeFile(resolve(directory, reportFile), JSON.stringify(report, null, 2));
    if(!quiet)console.log(JSON.stringify({ mode: 'pixels', id: test.id, expected: test.expected, predicted: metrics.result.label,
      coverage: metrics.anyHandCoverage }));
  }
  if (!liveOnly) await writeFile(resolve(directory, 'tracked-pixels.json'), JSON.stringify({ cases: tracked }));
  // A real-time replay per label exercises the app's window runner and frame pump.
  const seen = new Set();
  const liveCases = manifest.cases.map(c => forcePhrase && c.scope !== 'phrase' ? { ...c, scope: 'phrase', expected: 'none' }
    : demoScope && c.scope === 'word' && !['hello', 'goodbye', 'please'].includes(c.expected)
      ? { ...c, expected: 'none' } : c);
  for (const test of pixelsOnly ? [] : liveCases.filter(c => c.scenario === 'nominal' && (!requested || requested.includes(c.expected)) && (!requestedIds || requestedIds.includes(c.id)))) {
    const key = test.scope + ':' + test.expected;
    if (!allLiveCases && seen.has(key)) continue;
    seen.add(key);
    const result = await page.evaluate(async test => {
      const s = window.__simulation, video = s.video;
      const objectUrl = URL.createObjectURL(await (await fetch('/__sign_sim__/' + encodeURIComponent(test.file))).blob());
      if (video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve; video.onerror = reject;
        video.src = objectUrl; video.load();
      });
      const { MotionRecognizer } = await import('/src/recognition/motionRecognizer.ts');
      const { DEMO_SIGN_LABELS } = await import('/src/recognition/demoVocabulary.ts');
      const { runtime } = await import('/src/runtime.ts');
      runtime.setConfig({ signWindow: { ...runtime.get().config.signWindow, countdownMs: test.countdownMs } });
      let diagnostics, capturedFrames = 0, observedFrames = [];
      const videoTimes = new Map();
      const stopTiming = s.tracking.handTracking.subscribe((_frame, capturedAt, videoTime) => {
        if (Number.isFinite(videoTime)) videoTimes.set(capturedAt, videoTime);
      });
      const references = test.scope === 'phrase' ? s.phraseStore : s.productionStore;
      const store = { all: () => references ? references.all() : s.gallery.templates, match: frames => {
        capturedFrames = frames.length;
        observedFrames = frames;
        diagnostics = test.scope === 'phrase'
          ? { result: s.phraseStore.match(frames) }
          : s.productionStore ? { result: s.productionStore.match(frames) } : s.classify(frames);
        return diagnostics.result;
      } };
      const recognizer = new MotionRecognizer({ store, maxRecordingMs: test.durationSeconds * 1000 + 2000, captureCountdown: test.captureCountdown,
        ...(s.productionStore && test.scope !== 'phrase' ? { allowedLabels: DEMO_SIGN_LABELS } : {}) });
      const started = performance.now();
      try {
        const outcome = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Live replay timeout')), test.durationSeconds * 2000 + 20000);
          let playing = false;
          recognizer.on('progress', event => {
            if ((event.phase === 'recording' || (test.startDuringCountdown && event.phase === 'countdown')) && !playing) { playing = true; video.play().catch(reject); }
          });
          recognizer.on('result', result => { clearTimeout(timeout); resolve(result); });
          recognizer.on('error', error => { clearTimeout(timeout); reject(new Error(error.message)); });
          video.onended = () => recognizer.finishWindow();
          recognizer.attach(video); recognizer.startWindow();
        });
        const liveDiagnostics=s.tracking.trackingDiagnostics();
        if(liveDiagnostics.frames<capturedFrames || (test.trackingMode&&liveDiagnostics.mode!==test.trackingMode))
          throw new Error('Live tracker instance mismatch');
        const times = observedFrames.map(frame => videoTimes.get(frame.t)).filter(Number.isFinite);
        const annotatedStart = test.paddingSeconds;
        const annotatedEnd = annotatedStart + (test.sourceWindowSeconds[1] - test.sourceWindowSeconds[0]) / test.speed;
        const captureWindow = times.length ? { firstVideoS: times[0], lastVideoS: times.at(-1),
          annotatedStartS: annotatedStart, annotatedEndS: annotatedEnd,
          missedStartMs: Math.round(Math.max(0, times[0] - annotatedStart) * 1000),
          missedEndMs: Math.round(Math.max(0, annotatedEnd - times.at(-1)) * 1000),
          alignedFrames: times.length } : null;
        return { ...diagnostics, result: outcome, frames:observedFrames, capturedFrames, captureWindow,
          trackingDiagnostics:liveDiagnostics,elapsedMs: performance.now() - started };
      } finally { stopTiming(); video.pause(); video.onended = null; recognizer.detach(); }
    }, {...test,trackingMode,countdownMs,captureCountdown,startDuringCountdown});
    const {frames:liveFrames,...liveResult}=result;
    liveTracked.push({...test,frames:liveFrames});
    report.runtime.sharedTrackerVerified=true;
    await writeFile(resolve(directory,'tracked-live.json'),JSON.stringify({cases:liveTracked}));
    report.liveCases.push({ ...test, ...liveResult, predicted: result.result.label });
    await writeFile(resolve(directory, reportFile), JSON.stringify(report, null, 2));
    if(!quiet)console.log(JSON.stringify({ mode: 'live', expected: test.expected, predicted: result.result.label, frames: result.capturedFrames }));
  }
  report.finishedAt = new Date().toISOString();
  const summarize = rows => ({ examples: rows.length, correct: rows.filter(r => r.predicted === r.expected).length,
    wrongAccepted: rows.filter(r => r.predicted !== 'none' && r.predicted !== r.expected).length,
    rejectedKnown: rows.filter(r => r.predicted === 'none' && r.expected !== 'none').length });
  report.summary = {
    nominalDisjoint: summarize(report.pixelCases.filter(c => c.scenario === 'nominal' && c.split === 'regression' && c.expected !== 'none')),
    adverseDisjoint: summarize(report.pixelCases.filter(c => c.scenario !== 'nominal' && c.split === 'regression' && c.expected !== 'none')),
    trainingSourceReplays: summarize(report.pixelCases.filter(c => c.trainingSourceReplay)),
    unknown: summarize(report.pixelCases.filter(c => c.expected === 'none')),
    liveDisjoint: summarize(report.liveCases.filter(c => c.split === 'regression' && c.expected !== 'none')),
    liveUnknown: summarize(report.liveCases.filter(c => c.expected === 'none')),
    liveTrainingSourceReplays: summarize(report.liveCases.filter(c => c.trainingSourceReplay)),
    lexicalLabelsCovered: new Set(report.pixelCases.filter(c => c.scope === 'word' && c.expected !== 'none').map(c => c.expected)).size,
    phraseLabelsCovered: new Set(report.pixelCases.filter(c => c.scope === 'phrase').map(c => c.expected)).size,
  };
  await writeFile(resolve(directory, reportFile), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  await writeFile(resolve(directory, reportFile), JSON.stringify(report, null, 2));
  throw error;
} finally { await browser.close(); }
