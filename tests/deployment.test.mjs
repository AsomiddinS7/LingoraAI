import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve, sep } from 'node:path';
import { inspectStaticConfig, auditPublishedPaths, inspectCompiledModel, inspectTrainedModel, checkDeployment, REQUIRED_ASSETS } from '../scripts/check-deployment.mjs';

test('expanded release selects the actual production parser and requires its tracked asset', async () => {
  const env = { ...publicEnv(), VITE_MOTION_MODEL_URL: 'model/trained-sign-model.json' };
  assert.deepEqual(inspectStaticConfig(env).issues, []);
  const text = await readFile(new URL('../public/model/trained-sign-model.json', import.meta.url), 'utf8');
  const result = await inspectTrainedModel(text);
  assert.equal(result.templates, 106); assert.equal(result.positiveLabels.length, 49);
  const raw = JSON.parse(text); raw.classifier.data_audit = { private: 'source.mp4' };
  await assert.rejects(inspectTrainedModel(JSON.stringify(raw)), /metadata/);
  const report = await checkDeployment({ env, trackedPaths: REQUIRED_ASSETS.map(p => `public/${p}`) });
  assert(report.issues.some(i => i.code === 'required_asset_not_tracked' && i.file === 'public/model/trained-sign-model.json'));
});

const publicEnv = () => ({ VITE_RECOGNIZER: 'motion', VITE_STT_PROVIDER: 'browser-speech', VITE_TTS_PROVIDER: 'browser-synthesis',
  VITE_MOTION_MODEL_URL: 'model/motion-model.json', VITE_SIGNED_SPEECH_MODEL_URL: 'model/signed-speech-model.json' });

test('Hugging Face hosting requires a public HTTPS app URL and no inline credentials',()=>{
  const env={...publicEnv(),VITE_STT_PROVIDER:'huggingface',VITE_TTS_PROVIDER:'huggingface'};
  for(const url of ['', 'http://localhost:7860','https://huggingface.co/spaces/user/demo','https://secret@user-demo.hf.space','https://user-demo.hf.space?token=private'])
    assert(inspectStaticConfig({...env,VITE_SPEECH_SPACE_URL:url}).issues.includes('huggingface_requires_public_https_space_url'));
  assert.deepEqual(inspectStaticConfig({...env,VITE_SPEECH_SPACE_URL:'https://asomiddinsaidov07-lingora-speech.hf.space'}).issues,[]);
});
const model = (labels) => ({ format: 'lingora-motion-model', version: 1, feature_version: 'two-hand-body-v2', input_frames: 32, feature_dim: 128,
  templates: labels.map((label, index) => ({ id: `reference-${index}`, label, normalized: { reference: 'hands', durationMs: 1000, handCoverage: 1,
    vectors: Array.from({ length: 32 }, () => Array.from({ length: 128 }, (_, i) => i === 0 || i === 64 ? 1 : 0)) } })) });

test('public hosting rejects local-only STT, missing speech model and frontend credentials without logging values', () => {
  const secret = 'PrivateFrontendCredentialNeverLog';
  const result = inspectStaticConfig({ ...publicEnv(), VITE_STT_PROVIDER: 'local-stt', VITE_SIGNED_SPEECH_MODEL_URL: '', VITE_AZURE_KEY: secret });
  assert(result.issues.includes('static_site_requires_browser_or_azure_stt'));
  assert(result.issues.includes('speech_model_must_use_checked_bundled_asset'));
  assert(result.issues.includes('frontend_credential_variable_present'));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(inspectStaticConfig(publicEnv()).issues, []);
});

test('Azure public hosting accepts only a public HTTPS broker without inline credentials', () => {
  for (const url of ['http://localhost:8787/api/speech-token', 'https://127.0.0.1/api/speech-token', 'http://broker.example/api/speech-token', 'https://name:private@broker.example/api/speech-token']) {
    assert(inspectStaticConfig({ ...publicEnv(), VITE_TTS_PROVIDER: 'azure-speech', VITE_SPEECH_TOKEN_URL: url }).issues.includes('azure_requires_public_https_token_broker'));
  }
  assert.deepEqual(inspectStaticConfig({ ...publicEnv(), VITE_TTS_PROVIDER: 'azure-speech', VITE_SPEECH_TOKEN_URL: 'https://broker.example/api/speech-token' }).issues, []);
});

test('distribution audit permits examples and compiled assets while rejecting recordings, credentials, weights and private artifacts', () => {
  const safe = ['.env.example', '.env.speech.example', 'backend/.env.example', 'public/model/motion-model.json', 'public/model/pose_landmarker.task', 'tools/speech/MODEL_NOTICES.md', 'public/audio/introduction/1.wav', 'audio/introduction/6.wav'];
  assert.deepEqual(auditPublishedPaths(safe), []);
  const unsafe = ['.env.local', 'backend/.env', 'private-video-work/train.json', 'output/demo.zip', 'tmp/results.json', 'public/clip.mp4', 'public/audio/introduction/7.wav', 'public/audio/recording.wav', 'checkpoints/model.onnx', 'tls/private.key'];
  assert.equal(auditPublishedPaths(unsafe).length, unsafe.length);
});

test('models use actual production parser and exclude raw source metadata even if that parser would strip it', async () => {
  const current = model(['goodbye', 'hello', 'no', 'please', 'thank_you']);
  assert.equal((await inspectCompiledModel(JSON.stringify(current), 'model/motion-model.json')).templates, 5);
  current.templates[0].source = { name: 'private-source.mp4' };
  await assert.rejects(inspectCompiledModel(JSON.stringify(current), 'model/motion-model.json'), /unexpected_model_metadata/);
  delete current.templates[0].source;
  current.templates[0].normalized.vectors[0] = [1];
  await assert.rejects(inspectCompiledModel(JSON.stringify(current), 'model/motion-model.json'));
});

test('greeting contract requires five supported words including no', async () => {
  const fiveWordModel = model(['goodbye', 'hello', 'no', 'please', 'thank_you']);
  fiveWordModel.version = 2;
  fiveWordModel.matching = { profile: 'visibility-aware-dtw-v1', labels: ['goodbye', 'hello', 'no', 'please', 'thank_you'],
    templateIds: fiveWordModel.templates.map(template => template.id), rejectionLabels: [] };
  const summary = await inspectCompiledModel(JSON.stringify(fiveWordModel), 'model/motion-model.json');
  assert.equal(summary.templates, 5);
  assert.deepEqual(summary.positiveLabels, ['goodbye', 'hello', 'no', 'please', 'thank_you']);
  assert.deepEqual(summary.rejectionLabels, []);
  await assert.rejects(inspectCompiledModel(JSON.stringify(model(['hello', 'please', 'thank_you', 'no'])), 'model/motion-model.json'), /model_label_contract_mismatch/);
  await assert.rejects(inspectCompiledModel(JSON.stringify(model(['goodbye', 'hello', 'please', 'thank_you', 'unverified_class'])), 'model/motion-model.json'), /model_label_contract_mismatch/);
});

test('fresh-checkout and built-artifact checks catch untracked models, stale build bytes and leaked media', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'lingora-deployment-'));
  try {
    await mkdir(resolve(root, 'public/model'), { recursive: true });
    await mkdir(resolve(root, 'public/licenses'), { recursive: true });
    await writeFile(resolve(root, 'public/THIRD_PARTY_NOTICES.md'), 'Attribution fixture '.repeat(10));
    await writeFile(resolve(root, 'public/licenses/Apache-2.0.txt'), 'License fixture '.repeat(10));
    await writeFile(resolve(root, 'public/model/motion-model.json'), JSON.stringify(model(['goodbye', 'hello', 'no', 'please', 'thank_you'])));
    await writeFile(resolve(root, 'public/model/signed-speech-model.json'), JSON.stringify(model(['speech_01', 'speech_02', 'speech_03', 'speech_04', 'speech_05', 'speech_06'])));
    for (const name of ['hand_landmarker.task', 'pose_landmarker.task']) await writeFile(resolve(root, 'public/model', name), Buffer.alloc(100_001));
    const trackedPaths = [...REQUIRED_ASSETS, 'THIRD_PARTY_NOTICES.md', 'licenses/Apache-2.0.txt'].map((asset) => `public/${asset}`);
    assert.equal((await checkDeployment({ root, env: publicEnv(), trackedPaths })).ok, true);
    const untracked = await checkDeployment({ root, env: publicEnv(), trackedPaths: trackedPaths.slice(1) });
    assert(untracked.issues.some((issue) => issue.code === 'required_asset_not_tracked'));
    await cp(resolve(root, 'public'), resolve(root, 'dist'), { recursive: true });
    await mkdir(resolve(root, 'dist/mediapipe/wasm'), { recursive: true });
    for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'])
      await writeFile(resolve(root, 'dist/mediapipe/wasm', name), 'fixture');
    for (const name of ['index.html', 'sw.js', 'model/README.md']) await writeFile(resolve(root, 'dist', name), 'fixture');
    assert.equal((await checkDeployment({ root, env: publicEnv(), trackedPaths, built: true })).ok, true);
    await writeFile(resolve(root, 'dist/model/motion-model.json'), '{}');
    await writeFile(resolve(root, 'dist/private-recording.wav'), 'audio fixture');
    const badBuild = await checkDeployment({ root, env: publicEnv(), trackedPaths, built: true });
    assert(badBuild.issues.some((issue) => issue.code === 'built_asset_does_not_match_selected_source'));
    assert(badBuild.issues.some((issue) => issue.code === 'private_or_unexpected_distribution_file'));
  } finally {
    assert(root.startsWith(resolve(tmpdir()) + sep) && basename(root).startsWith('lingora-deployment-'));
    await rm(root, { recursive: true, force: true });
  }
});
