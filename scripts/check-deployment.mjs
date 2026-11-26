// Read-only public deployment checks. No cloud requests, model training, secret
// values, or deployment mutations. Uses Vite's actual production env precedence.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { loadMatcher } from './evaluate-motion.mjs';
import { build } from 'esbuild';

export const REQUIRED_ASSETS = [
  'model/motion-model.json', 'model/signed-speech-model.json',
  'model/hand_landmarker.task', 'model/pose_landmarker.task',
];
const REQUIRED_NOTICES = ['THIRD_PARTY_NOTICES.md', 'licenses/Apache-2.0.txt'];
const EXPECTED_LABELS = {
  'model/motion-model.json': ['goodbye', 'hello', 'no', 'please', 'thank_you'],
  'model/signed-speech-model.json': ['speech_01', 'speech_02', 'speech_03', 'speech_04', 'speech_05', 'speech_06'],
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
let matcherPromise;
let trainedParserPromise;
export async function inspectTrainedModel(text) {
  trainedParserPromise ??= build({ entryPoints: [fileURLToPath(new URL('../src/ml/trainedSignModel.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'esm' }).then(result =>
      import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')));
  const { parseTrainedSignModel } = await trainedParserPromise;
  const model = parseTrainedSignModel(text);
  const vocabulary = JSON.parse(await readFile(new URL('../src/data/trainedVocabulary.json', import.meta.url), 'utf8'));
  if (JSON.stringify(model.vocabulary) !== JSON.stringify(vocabulary) || vocabulary.length !== 49)
    throw new Error('trained_model_vocabulary_contract_mismatch');
  return { templates: model.gallery.templates.length + (model.number_extension?.templates.length ?? 0), positiveLabels: model.vocabulary.map(v => v.label),
    trackingProfile: model.tracking_profile };
}

export function inspectStaticConfig(env) {
  const issues = [];
  const stt = env.VITE_STT_PROVIDER ?? 'typed-input';
  const tts = env.VITE_TTS_PROVIDER ?? 'browser-synthesis';
  if (!['browser-speech', 'azure-speech', 'huggingface'].includes(stt)) issues.push('static_site_requires_browser_or_azure_stt');
  if (!['browser-synthesis', 'azure-speech', 'huggingface'].includes(tts)) issues.push('invalid_tts_provider');
  if(stt==='huggingface'||tts==='huggingface'){
    try{
      const url=new URL(env.VITE_SPEECH_SPACE_URL);
      if(url.protocol!=='https:'||!url.hostname.endsWith('.hf.space')||url.username||url.password||url.search||url.hash
        ||url.port||!['','/'].includes(url.pathname))throw Error();
    }catch{issues.push('huggingface_requires_public_https_space_url');}
  }
  if (env.VITE_RECOGNIZER !== 'motion') issues.push('selected_recognizer_is_not_motion');
  if (!['model/motion-model.json', './model/motion-model.json', 'model/trained-sign-model.json', './model/trained-sign-model.json'].includes(env.VITE_MOTION_MODEL_URL)) issues.push('greeting_model_must_use_checked_bundled_asset');
  if (!['model/signed-speech-model.json', './model/signed-speech-model.json'].includes(env.VITE_SIGNED_SPEECH_MODEL_URL)) issues.push('speech_model_must_use_checked_bundled_asset');
  if (Object.entries(env).some(([key, value]) => /^VITE_.*(?:KEY|SECRET|PASSWORD|TOKEN)$/.test(key) && value)) issues.push('frontend_credential_variable_present');
  if (stt === 'azure-speech' || tts === 'azure-speech' || env.VITE_SPEECH_TOKEN_URL) {
    try {
      const url = new URL(env.VITE_SPEECH_TOKEN_URL);
      if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/speech-token')) throw new Error();
    } catch { issues.push('azure_requires_public_https_token_broker'); }
  }
  return { issues, selected: { stt: ['browser-speech', 'azure-speech', 'local-stt', 'local-whisper', 'typed-input', 'huggingface'].includes(stt) ? stt : 'invalid',
    tts: ['browser-synthesis', 'azure-speech', 'huggingface'].includes(tts) ? tts : 'invalid' } };
}

export function auditPublishedPaths(paths) {
  return paths.flatMap((input) => {
    const path = input.replaceAll('\\', '/'); const name = basename(path);
    const secret = (name === '.env' || name.startsWith('.env.')) && !name.endsWith('.example');
    const privateDirectory = /(?:^|\/)(?:private-video-work|tmp|output|node_modules|dist|__pycache__|\.venv[^/]*|\.pgdata[^/]*)(?:\/|$)/.test(path);
    // Only the explicitly generated, public introduction is permitted as audio.
    const preparedAudio = /^(?:public\/)?audio\/introduction\/[1-6]\.wav$/.test(path)
      || /^(?:public\/)?audio\/signs\/(?:hello|goodbye|please)\.wav$/.test(path);
    const recordingOrWeights = !preparedAudio && /\.(?:mp4|mov|mkv|webm|wav|mp3|m4a|ogg|zip|7z|tar|gz|onnx|nemo|safetensors|pt|pth|ckpt|pyc|log)$/i.test(name);
    const credentialFile = /\.(?:pem|pfx|key|crt)$/i.test(name);
    return secret || privateDirectory || recordingOrWeights || credentialFile
      ? [{ code: 'private_or_unexpected_distribution_file', file: path }] : [];
  });
}

export async function inspectCompiledModel(text, path) {
  const raw = JSON.parse(text);
  const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
  if (!only(raw, ['format', 'version', 'feature_version', 'input_frames', 'feature_dim', 'matching', 'templates']) ||
    (raw.matching !== undefined && (!only(raw.matching, ['profile', 'labels', 'templateIds', 'rejectionLabels']) ||
      !['visibility-aware-dtw-v1', 'strict-dtw-v1'].includes(raw.matching.profile) ||
      !Array.isArray(raw.matching.labels) || !Array.isArray(raw.matching.templateIds) ||
      (raw.matching.rejectionLabels !== undefined && !Array.isArray(raw.matching.rejectionLabels)))) ||
    !Array.isArray(raw.templates) || !raw.templates.length || raw.templates.some((template) =>
      !only(template, ['id', 'label', 'normalized']) || !only(template.normalized, ['vectors', 'reference', 'durationMs', 'handCoverage']) ||
      typeof template.id !== 'string' || /[\\/]|\.(?:mp4|wav|webm|mov)/i.test(template.id))) throw new Error('unexpected_model_metadata');
  const matcher = await (matcherPromise ??= loadMatcher());
  const model = matcher.parseMotionModel(text);
  const labels = [...new Set(model.templates.map((template) => template.label))].sort();
  const required = EXPECTED_LABELS[path];
  const rejectionLabels = model.matching?.rejectionLabels ?? [];
  const positiveLabels = labels.filter((label) => !rejectionLabels.includes(label));
  const allowed = path === 'model/motion-model.json' ? [...required, 'no'] : required;
  if (JSON.stringify(positiveLabels) !== JSON.stringify(required) || labels.some((label) => !allowed.includes(label)) ||
    rejectionLabels.some((label) => label !== 'no' || path !== 'model/motion-model.json'))
    throw new Error('model_label_contract_mismatch');
  return { templates: model.templates.length, labels, positiveLabels, rejectionLabels };
}

async function listFiles(root, base = root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path, base));
    else files.push(relative(base, path).replaceAll('\\', '/'));
  }
  return files;
}

export async function checkDeployment({ root = process.cwd(), env, built = false, trackedPaths, requireTracked = true } = {}) {
  env ??= loadEnv('production', root, 'VITE_');
  const config = inspectStaticConfig(env);
  const issues = config.issues.map((code) => ({ code }));
  const checks = [];
  let tracked = trackedPaths;
  if (!tracked && requireTracked) {
    try { tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 5_000_000 }).split('\0').filter(Boolean); }
    catch { issues.push({ code: 'cannot_check_git_distribution' }); tracked = []; }
  }
  if (tracked) issues.push(...auditPublishedPaths(tracked));
  const assetBytes = new Map();
  const requiredAssets = [...REQUIRED_ASSETS,
    ...(env.VITE_MOTION_MODEL_URL?.replace(/^\.\//, '') === 'model/trained-sign-model.json' ? ['model/trained-sign-model.json'] : [])];
  for (const asset of requiredAssets) {
    const file = `public/${asset}`;
    if (requireTracked && !tracked?.includes(file)) issues.push({ code: 'required_asset_not_tracked', file });
    try {
      const path = resolve(root, file);
      if ((await lstat(path)).isSymbolicLink()) throw new Error('symlink');
      const bytes = await readFile(path);
      if (bytes.length < (asset.endsWith('.task') ? 100_000 : 100)) throw new Error('truncated');
      const summary = asset === 'model/trained-sign-model.json' ? await inspectTrainedModel(bytes.toString('utf8'))
        : asset.endsWith('.json') ? await inspectCompiledModel(bytes.toString('utf8'), asset) : {};
      assetBytes.set(asset, bytes);
      checks.push({ file, bytes: bytes.length, sha256: digest(bytes), ...summary });
    } catch { issues.push({ code: 'missing_or_invalid_public_asset', file }); }
  }
  for (const asset of REQUIRED_NOTICES) {
    const file = `public/${asset}`;
    if (requireTracked && !tracked?.includes(file)) issues.push({ code: 'required_notice_not_tracked', file });
    try {
      const bytes = await readFile(resolve(root, file));
      if (bytes.length < 100) throw new Error();
      assetBytes.set(asset, bytes);
    } catch { issues.push({ code: 'missing_third_party_notice', file }); }
  }
  try {
    const files = (await listFiles(resolve(root, 'public'))).map((path) => `public/${path}`);
    issues.push(...auditPublishedPaths(files));
    for (const file of files) if ((await lstat(resolve(root, file))).isSymbolicLink()) issues.push({ code: 'public_symlink', file });
  }
  catch { issues.push({ code: 'cannot_inspect_public_directory' }); }
  if (built) {
    try {
      const files = await listFiles(resolve(root, 'dist'));
      issues.push(...auditPublishedPaths(files));
      for (const file of ['index.html', 'sw.js', 'model/README.md', ...REQUIRED_NOTICES,
        'mediapipe/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.wasm',
        'mediapipe/wasm/vision_wasm_nosimd_internal.js', 'mediapipe/wasm/vision_wasm_nosimd_internal.wasm'])
        if (!files.includes(file)) issues.push({ code: 'missing_built_runtime_asset', file });
      for (const [asset, bytes] of assetBytes) {
        try {
          if (digest(await readFile(resolve(root, 'dist', asset))) !== digest(bytes)) throw new Error();
        } catch { issues.push({ code: 'built_asset_does_not_match_selected_source', file: asset }); }
      }
      const index = await readFile(resolve(root, 'dist/index.html'), 'utf8');
      if (/(?:src|href)=["']\/assets\//.test(index)) issues.push({ code: 'absolute_asset_path_breaks_pages_subpath' });
      for (const path of files.filter((path) => /\.(?:html|js|json|txt|md)$/.test(path))) {
        const full = resolve(root, 'dist', path);
        if ((await lstat(full)).isSymbolicLink()) { issues.push({ code: 'built_symlink', file: path }); continue; }
        const text = await readFile(full, 'utf8');
        if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/.test(text))
          issues.push({ code: 'credential_signature_in_artifact', file: path });
      }
    } catch { issues.push({ code: 'missing_or_unreadable_build' }); }
  }
  return { ok: issues.length === 0, target: 'static GitHub Pages', selected: config.selected, builtChecked: built, assets: checks, issues,
    limits: ['Checks packaging/configuration, not sign-language accuracy, source reuse permission, physical-device performance, or audible Uzbek TTS.',
      'Browser STT may use its vendor service. Azure requires a separately hosted public HTTPS token broker.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkDeployment({ built: process.argv.includes('--built') }).then((report) => {
    console.log(JSON.stringify(report, null, 2)); process.exitCode = report.ok ? 0 : 1;
  }).catch(() => { console.error('Deployment check failed; no environment values were logged.'); process.exitCode = 1; });
}
