// One fixed experimental adjustment; no parameter search against regressions.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadMatcher, evaluateDatasets } from '../../scripts/evaluate-motion.mjs';
import { createMaskedMatcher, MASKED_DTW_CONFIG, observedFrameDistance } from './masked_dtw.mjs';

const root = resolve('private-video-work/tracking-v1');
const out = resolve('private-video-work/masked-dtw-v1');
await mkdir(out, { recursive: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const production = await loadMatcher();
const candidate = createMaskedMatcher(production.normalizeSequence);
const registration = {
  adjustment: 'Censored-observation handling only. Fully shared hands retain the exact existing body-coordinate RMSE.',
  config: MASKED_DTW_CONFIG, registeredAt: new Date().toISOString(),
  sourceHash: hash(await readFile(new URL('./masked_dtw.mjs', import.meta.url))),
  selection: 'Data-independent fixed engineering rule, committed before candidate regression evaluation; no grid search.',
  sources: [
    { url: 'https://www.cs.ucf.edu/~jjl/pubs/pn4460-tarnataA.pdf', title: 'Jackknife: A Reliable Recognizer with Few Samples and Many Modalities (CHI 2017)', finding: 'Supports a DTW/template approach for few-example dynamic gesture customization; not Uzbek sign-language validation.' },
    { url: 'https://arxiv.org/abs/2104.10166', title: 'Evaluating the Immediate Applicability of Pose Estimation for Sign Language Recognition (2021)', finding: 'Studies information loss and pose-estimation failure cases. Missing detections should not be interpreted as observed articulation.' },
    { url: 'https://arxiv.org/abs/2611.16621', title: 'Studies on Sign Language Retrieval in Low-Resource Dictionary Settings (2026 preprint)', finding: 'Evaluates learning-free angle-DTW against frozen pretrained pose encoders under low-resource/cross-signer protocols. Its reported retrieval results do not establish Uzbek translation accuracy.' },
    { url: 'https://github.com/AI4Bharat/OpenHands', title: 'OpenHands author repository', finding: 'Provides pretrained cross-language pose-model research, but the repository declares it is no longer actively maintained. No models or datasets were downloaded here.' },
  ],
  designDecisions: {
    geometry: 'Keep global body-normalized wrist location, finger configuration and orientation. Compute wrist-local shape diagnostics only; independent per-hand translation/rotation normalization can erase lexical location/orientation.',
    idle: 'Do not velocity-trim lexical holds. Existing templates already remove empty endpoints. Controlled extra boundary holds are tested without changing this policy.',
    multiTemplate: 'Keep minimum distance per label, preserving distinct demonstrated variants. Duplicates must not create extra votes or shrink ambiguity margins.',
    rejection: 'No-common frames cost 0.44 instead of zero. Require >=60% shared hand observations along the forced-endpoint DTW path. Radius/margin/ratio remain 0.22/0.025/0.85.',
  },
};
await writeFile(resolve(out, 'registration-and-research.json'), JSON.stringify(registration, null, 2));
const datasets = {};
for (const [key, filename] of [['train', 'greeting-templates-train.json'], ['regression', 'greeting-templates-heldout.json'], ['negative', 'greeting-templates-negative.json'], ['speech', 'speech-templates-train.json']]) {
  const bytes = await readFile(resolve(root, filename));
  const raw = JSON.parse(bytes);
  const copy = { ...raw, templates: raw.templates.map((t) => ({ ...t, label: t.label === 'none' ? 'expected_negative' : t.label })) };
  datasets[key] = production.parseTemplateDataset(JSON.stringify(copy));
  for (const template of datasets[key].templates) if (template.label === 'expected_negative') template.label = 'none';
  registration[`${key}Sha256`] = hash(bytes);
}
await writeFile(resolve(out, 'registration-and-research.json'), JSON.stringify(registration, null, 2));
const testing = { templates: [...datasets.regression.templates, ...datasets.negative.templates] };
const baseline = evaluateDatasets(datasets.train, testing, production.matchSequence);
const experimental = evaluateDatasets(datasets.train, testing, candidate);
assert.equal(baseline.excluded.length, 0); assert.equal(experimental.excluded.length, 0);
const loto = datasets.train.templates.map((template) => {
  const training = datasets.train.templates.filter((t) => t.id !== template.id);
  if (!training.some((t) => t.label === template.label)) return { id: template.id, expected: template.label, status: 'class_has_no_remaining_template' };
  return { id: template.id, expected: template.label, baseline: production.matchSequence(template.frames, training), candidate: candidate(template.frames, training) };
});
const perturbations = [];
for (const template of datasets.train.templates) {
  const variants = [];
  for (const [name, factor] of [['slower_1.4x', 1.4], ['faster_0.75x', .75]])
    variants.push({ name, frames: template.frames.map((f) => ({ ...f, t: template.frames[0].t + (f.t - template.frames[0].t) * factor })) });
  for (const mode of ['one_hand_dropout', 'both_hands_dropout']) {
    const frames = structuredClone(template.frames);
    const start = Math.floor(frames.length * .45);
    for (let i = start; i < Math.min(start + 3, frames.length); i++) {
      if (mode === 'one_hand_dropout') frames[i].right = null;
      else frames[i].left = frames[i].right = null;
    }
    variants.push({ name: `${mode}_3_source_frames`, frames });
  }
  const frames = structuredClone(template.frames);
  const first = frames[0], last = frames.at(-1);
  variants.push({ name: 'extra_boundary_holds_240ms', frames: [
    ...[3, 2, 1].map((i) => ({ ...structuredClone(first), t: first.t - i * 80 })), ...frames,
    ...[1, 2, 3].map((i) => ({ ...structuredClone(last), t: last.t + i * 80 })),
  ] });
  for (const variant of variants) perturbations.push({ sourceTemplate: template.id, expected: template.label,
    perturbation: variant.name, baseline: production.matchSequence(variant.frames, datasets.train.templates), candidate: candidate(variant.frames, datasets.train.templates) });
}
const parity = datasets.train.templates.map((template) => ({ id: template.id, expected: template.label,
  raw: candidate(template.frames, datasets.train.templates), compiled: candidate(template.frames, production.compileTemplateDataset(datasets.train.templates).templates) }));
for (const item of parity) assert.deepEqual(item.raw, item.compiled);
const speechConsistency = datasets.speech.templates.map((template) => ({ id: template.id, expected: template.label,
  baseline: production.matchSequence(template.frames, datasets.speech.templates), candidate: candidate(template.frames, datasets.speech.templates) }));
const speechUnknowns = datasets.negative.templates.map((template) => ({ id: template.id, baseline: production.matchSequence(template.frames, datasets.speech.templates), candidate: candidate(template.frames, datasets.speech.templates) }));
const geometryDiagnostics = [];
for (let i = 0; i < datasets.train.templates.length; i++) for (let j = i + 1; j < datasets.train.templates.length; j++) {
  const a = production.normalizeSequence(datasets.train.templates[i].frames), b = production.normalizeSequence(datasets.train.templates[j].frames);
  const frames = a.vectors.map((v, index) => observedFrameDistance(v, b.vectors[index])).filter((d) => d.common);
  geometryDiagnostics.push({ first: datasets.train.templates[i].id, second: datasets.train.templates[j].id,
    meanWristBodyDistance: frames.reduce((sum, d) => sum + d.wristDiagnostic, 0) / frames.length,
    meanWristLocalShapeDistance: frames.reduce((sum, d) => sum + d.localShapeDiagnostic, 0) / frames.length });
}
const summary = (predictions) => ({ correctKnown: predictions.filter((p) => p.supported && p.predicted === p.expected).length,
  wrongKnown: predictions.filter((p) => p.supported && p.predicted !== 'none' && p.predicted !== p.expected).length,
  rejectedKnown: predictions.filter((p) => p.supported && p.predicted === 'none').length,
  rejectedUnknown: predictions.filter((p) => !p.supported && p.predicted === 'none').length,
  acceptedUnknown: predictions.filter((p) => !p.supported && p.predicted !== 'none').length });
const stats = { baseline: summary(baseline.predictions), candidate: summary(experimental.predictions) };
const report = { scope: 'Previously inspected same-signer/session regressions, not a new untouched test. Synthetic train perturbations and source replay are robustness checks, not recognition accuracy.',
  registration, stats, baseline, candidate: experimental, trainOnlyLoto: loto,
  trainOnlySyntheticRobustness: perturbations, rawCompiledParity: parity,
  speechSourceConsistencyOnly: speechConsistency, speechUnsupportedNegatives: speechUnknowns, trainOnlyGeometryDiagnostics: geometryDiagnostics,
  recommendation: 'Pending parent review; no production changes or model promotion performed.' };
await writeFile(resolve(out, 'evaluation.json'), JSON.stringify(report, (_key, value) => value === Infinity ? null : value, 2));
console.log(JSON.stringify({ out, stats, loto: loto.map((r) => ({ id: r.id, expected: r.expected, baseline: r.baseline?.label, candidate: r.candidate?.label, status: r.status })),
  synthetic: ['baseline', 'candidate'].map((name) => ({ matcher: name, correct: perturbations.filter((p) => p[name].label === p.expected).length,
    wrong: perturbations.filter((p) => p[name].label !== 'none' && p[name].label !== p.expected).length,
    rejected: perturbations.filter((p) => p[name].label === 'none').length, total: perturbations.length })) }, null, 2));
