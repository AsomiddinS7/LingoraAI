// New caption-verified signs are UNKNOWN to the original four-class dictionary.
// None of these clips were used to fit or tune the frozen visibility profile.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadMatcher, evaluateDatasets } from '../../scripts/evaluate-motion.mjs';

const production = await loadMatcher();
const load = async (path) => production.parseTemplateDataset(await readFile(path, 'utf8'));
const training = await load('private-video-work/tracking-v1/greeting-templates-train.json');
const additional = { templates: [
  ...(await load('private-video-work/additional-vocabulary/templates-train.json')).templates,
  ...(await load('private-video-work/additional-vocabulary/templates-heldout.json')).templates,
] };
const profiled = production.parseMotionModel(await readFile('private-video-work/masked-dtw-v1/profiled-greeting-model.json', 'utf8'));
const strict = evaluateDatasets(training, additional, production.matchSequence);
const scoped = evaluateDatasets(training, additional, (frames, templates) => production.matchSequence(frames, templates, { matching: profiled.matching }));
assert.equal(strict.excluded.length, 0); assert.equal(scoped.excluded.length, 0);
assert(strict.predictions.every((row) => !row.supported));
assert(scoped.predictions.every((row) => !row.supported));
const comparisons = strict.predictions.map((first) => {
  const second = scoped.predictions.find((row) => row.id === first.id);
  const query = additional.templates.find((row) => row.id === first.id);
  assert.deepEqual(production.matchSequence(query.frames, profiled.templates, { matching: profiled.matching }),
    production.matchSequence(query.frames, training.templates, { matching: profiled.matching }));
  return { id: first.id, trueCaption: first.expected, expectedForOriginalVocabulary: 'none',
    strict: { label: first.predicted, distance: first.distance, reason: first.reason },
    scoped: { label: second.predicted, distance: second.distance, reason: second.reason },
    newFalseAcceptance: first.predicted === 'none' && second.predicted !== 'none' };
});
const summary = { unknownClips: comparisons.length,
  strictFalseAcceptances: comparisons.filter((row) => row.strict.label !== 'none').length,
  scopedFalseAcceptances: comparisons.filter((row) => row.scoped.label !== 'none').length,
  newFalseAcceptances: comparisons.filter((row) => row.newFalseAcceptance).length };
const report = { scope: 'Four new caption-backed No clips as unknowns to the ORIGINAL four-class gallery. Same instructor/session, separate source intervals; no threshold tuning.',
  summary, comparisons, strict, scoped,
  recommendation: summary.newFalseAcceptances ? 'Decline profile promotion: new unsupported false acceptance.' : 'No new false acceptance in this check; parent reviews the complete gate.',
  parametersChanged: false, publicModelsChanged: false };
const path = resolve('private-video-work/masked-dtw-v1/additional-unknown-evaluation.json');
await writeFile(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ path, summary, comparisons, recommendation: report.recommendation }, null, 2));
