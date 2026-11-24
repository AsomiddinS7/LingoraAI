// Freeze a fresh experiment split before augmentation or gradient training.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { loadMatcher } from './evaluate-motion.mjs';
import { auditSplits } from './export-training-data.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const root = resolve('private-video-work/dataset-expansion/combined');
const out = resolve('private-video-work/training-expanded-v1');
const read = async name => JSON.parse(await readFile(resolve(root, name), 'utf8'));
const matcher = await loadMatcher();
const catalog = await read('catalog.json');
const metadata = new Map(catalog.samples.map(s => [s.id, s]));
const all = [];
for (const name of ['word-train.json', 'word-regression.json', 'word-negative.json']) {
  const raw = await read(name);
  for (const template of raw.templates) {
    const m = metadata.get(template.id);
    if (!m) throw new Error(`Missing corpus provenance: ${template.id}`);
    const dictionaryHoldout = template.id.startsWith('uzsl-') && template.id.endsWith('-take-2');
    const split = m.split === 'negative' ? 'unknown_regression'
      : m.split === 'regression' || dictionaryHoldout ? 'regression' : 'train';
    all.push({ template, metadata: m, split });
  }
}
const training = all.filter(s => s.split === 'train').map(s => s.template);
const matching = { profile: 'visibility-aware-dtw-v1', labels: [...new Set(training.map(t => t.label))].sort(),
  templateIds: training.map(t => t.id).sort() };
const examples = all.map(({ template, metadata: m, split }) => {
  const normalized = matcher.normalizeSequence(template.frames);
  if (!normalized) throw new Error(`Unusable normalization: ${template.id}`);
  return { id: template.id, label: template.label, label_uz: m.labelUz, split,
    source_key: m.recordingId, source_sha256: m.recordingSha256, session_key: m.sessionId,
    source_start_ms: template.frames[0].t, source_end_ms: template.frames.at(-1).t,
    geometry_sha256: hash(JSON.stringify(template.frames.map(({ t: _time, ...geometry }) => geometry))),
    ...normalized, baseline: matcher.matchSequence(template.frames, training, { matching }) };
});
const audit = auditSplits(examples);
if (audit.retained_window_overlaps.length || audit.cross_split_geometry_duplicates.length) throw new Error('Experiment split leaks source frames');
const result = { format: 'lingora-normalized-training-v1', feature_version: 'two-hand-body-v2', frames: 32, features: 128,
  labels: matching.labels, provenance: { corpus_plan_sha256: catalog.planSha256,
    feature_code_sha256: hash(await readFile('src/ml/sequence.ts')), split_before_augmentation: true,
    tracker_profile: 'hands-pose-video-v1', regression_previously_inspected: true,
    scope: 'Fresh 40-label training experiment. First dictionary take trains; second dictionary take is excluded from all training/calibration. Same-recording regression, never unseen-signer validation.',
    single_example_labels: matching.labels.filter(label => !examples.some(e => e.label === label && e.split === 'regression')),
    source_policy: 'Original private corpus is unchanged. This experiment repartitions dictionary repetitions by their actual disjoint source windows. Previously inspected regression is not untouched testing.',
  }, split_audit: audit, examples };
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'normalized-words.json'), JSON.stringify(result));
await writeFile(resolve(out, 'experiment-raw.json'), JSON.stringify({ format: 'lingora-experiment-raw-v1',
  samples: all.map(s => ({ ...s.template, split: s.split, metadata: s.metadata })) }));
await writeFile(resolve(out, 'baseline-model.json'), JSON.stringify(matcher.compileTemplateDataset(training, matching)));
console.log(JSON.stringify({ directory: out, classes: result.labels.length,
  splits: Object.fromEntries(['train', 'regression', 'unknown_regression'].map(split => [split, examples.filter(e => e.split === split).length])),
  naturalRegressionLabels: new Set(examples.filter(e => e.split === 'regression').map(e => e.label)).size,
  singleExampleLabels: result.provenance.single_example_labels, audit }, null, 2));
