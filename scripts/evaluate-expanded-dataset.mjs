// Compare the private enlarged word gallery with the current working model.
// Neither the gallery nor its source landmarks are copied into public/.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateDatasets, loadMatcher } from './evaluate-motion.mjs';

const directory = resolve('private-video-work/dataset-expansion/combined');
const read = async name => JSON.parse(await readFile(resolve(directory, name), 'utf8'));
const matcher = await loadMatcher();
const training = matcher.parseTemplateDataset(JSON.stringify(await read('word-train.json')));
const regression = matcher.parseTemplateDataset(JSON.stringify(await read('word-regression.json')));
const negative = await read('word-negative.json');
const modelBytes = await readFile(resolve('public/model/motion-model.json'));
const baseline = matcher.parseMotionModel(modelBytes.toString('utf8'));
const ids = new Set(baseline.templates.map(t => t.id));
const baselineTraining = { ...training, templates: training.templates.filter(t => ids.has(t.id)) };
if (baselineTraining.templates.length !== ids.size) throw new Error('Current model references are missing from the corpus; cannot audit baseline provenance');
const matching = { profile: 'visibility-aware-dtw-v1', labels: [...new Set(training.templates.map(t => t.label))].sort(),
  templateIds: training.templates.map(t => t.id).sort() };
const candidate = matcher.compileTemplateDataset(training, matching);
const classify = model => frames => matcher.matchSequence(frames, model.templates, { matching: model.matching });
const evaluate = (model, train, templates) => evaluateDatasets(train, { ...regression, templates }, classify(model));
const oldRegression = regression.templates.filter(t => baseline.templates.some(b => b.label === t.label));
const newRegression = regression.templates.filter(t => !oldRegression.includes(t));
const report = {
  scope: 'Fixed-threshold, same-instructor/session complete-repetition regression. No unseen-signer accuracy estimate.',
  baselineModelSha256: createHash('sha256').update(modelBytes).digest('hex'),
  baseline: { labels: [...new Set(baseline.templates.map(t => t.label))],
    existing: evaluate(baseline, baselineTraining, oldRegression), negatives: evaluate(baseline, baselineTraining, negative.templates) },
  expanded: { labels: matching.labels,
    existing: evaluate(candidate, training, oldRegression), additions: evaluate(candidate, training, newRegression),
    negatives: evaluate(candidate, training, negative.templates) },
  dictionary: { independentRegressionExamples: 0, limitation: 'One whole source clip per lexical entry; no test split fabricated from its repeated motions.' },
  publication: 'Private research candidate only; dataset growth does not enable new website vocabulary automatically.',
};
report.existingVocabularyRegression = {
  passed: report.expanded.existing.metrics.supportedAccuracy >= report.baseline.existing.metrics.supportedAccuracy
    && report.expanded.negatives.metrics.unknownRejection >= report.baseline.negatives.metrics.unknownRejection,
  rule: 'Enlargement must preserve existing supported accuracy and unknown rejection at unchanged thresholds. Passing this check alone does not authorize promotion or establish new-label generalization.',
};
await writeFile(resolve(directory, 'candidate-word-model.json'), JSON.stringify(candidate));
await writeFile(resolve(directory, 'evaluation.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ baseline: { existing: report.baseline.existing.metrics, negatives: report.baseline.negatives.metrics },
  expanded: { existing: report.expanded.existing.metrics, additions: report.expanded.additions.metrics, negatives: report.expanded.negatives.metrics } }, null, 2));
