// Private frozen negative-reference experiment. No runtime/schema/model edits.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadMatcher, evaluateDatasets } from '../../scripts/evaluate-motion.mjs';

const production = await loadMatcher();
const load = async (path, negative = false) => {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const parsed = production.parseTemplateDataset(JSON.stringify({ ...raw,
    templates: raw.templates.map((t) => ({ ...t, label: t.label === 'none' ? 'negative_expected' : t.label })) }));
  if (negative) for (const template of parsed.templates) if (template.label === 'negative_expected') template.label = 'none';
  return parsed;
};
const train = await load('private-video-work/tracking-v1/greeting-templates-train.json');
const known = await load('private-video-work/tracking-v1/greeting-templates-heldout.json');
const oldUnknowns = await load('private-video-work/tracking-v1/greeting-templates-negative.json', true);
const backgroundTrain = await load('private-video-work/additional-vocabulary/templates-train.json');
const backgroundRegressions = await load('private-video-work/additional-vocabulary/templates-heldout.json');
assert.equal(backgroundTrain.templates.length, 2);
assert(backgroundTrain.templates.every((t) => t.label === 'no'));
const gallery = { templates: [...train.templates, ...backgroundTrain.templates] };
const matching = { profile: 'visibility-aware-dtw-v1', labels: [...new Set(gallery.templates.map((t) => t.label))].sort(),
  templateIds: gallery.templates.map((t) => t.id).sort() };
const rejectionLabels = ['no'];
const backgroundMatcher = (frames, templates) => {
  const result = production.matchSequence(frames, templates, { matching });
  const alternatives = result.alternatives.filter((item) => !rejectionLabels.includes(item.label));
  return rejectionLabels.includes(result.label)
    ? { ...result, label: 'none', confidence: 0, alternatives, reason: 'background_reference' }
    : { ...result, alternatives };
};
const unknownQueries = [...oldUnknowns.templates, ...backgroundRegressions.templates.map((t) => ({ ...t, label: 'none' }))];
const testing = { templates: [...known.templates, ...unknownQueries] };
const strict = evaluateDatasets(train, testing, production.matchSequence);
const candidate = evaluateDatasets(gallery, testing, backgroundMatcher);
assert.equal(candidate.excluded.length, 0); assert.equal(strict.excluded.length, 0);
const compiled = production.compileTemplateDataset(gallery, matching);
const parity = testing.templates.map((query) => {
  const raw = backgroundMatcher(query.frames, gallery.templates), derived = backgroundMatcher(query.frames, compiled.templates);
  assert.deepEqual(raw, derived);
  assert(!derived.alternatives.some((item) => rejectionLabels.includes(item.label)));
  assert(!rejectionLabels.includes(derived.label));
  return { id: query.id, expected: query.label, raw, compiled: derived };
});
const trainingConsistency = backgroundTrain.templates.map((query) => ({ id: query.id,
  result: backgroundMatcher(query.frames, compiled.templates), scope: 'Enrolled background reference replay only; not unknown recognition accuracy.' }));
const summary = (report) => ({ knownCorrect: report.predictions.filter((p) => p.supported && p.expected === p.predicted).length,
  knownWrong: report.predictions.filter((p) => p.supported && p.predicted !== 'none' && p.expected !== p.predicted).length,
  knownRejected: report.predictions.filter((p) => p.supported && p.predicted === 'none').length,
  unknownRejected: report.predictions.filter((p) => !p.supported && p.predicted === 'none').length,
  unknownFalseAccepted: report.predictions.filter((p) => !p.supported && p.predicted !== 'none').length });
const stats = { strictOriginalGallery: summary(strict), rejectionPrototypeCandidate: summary(candidate) };
const newFalseAcceptances = candidate.predictions.filter((p) => !p.supported && p.predicted !== 'none'
  && strict.predictions.find((prior) => prior.id === p.id)?.predicted === 'none');
const pass = stats.rejectionPrototypeCandidate.knownCorrect > stats.strictOriginalGallery.knownCorrect
  && stats.rejectionPrototypeCandidate.knownWrong === 0 && stats.rejectionPrototypeCandidate.unknownFalseAccepted === 0
  && newFalseAcceptances.length === 0 && trainingConsistency.every((row) => row.result.label === 'none');
const report = { scope: 'Already inspected one-signer/session regressions only. No held-out tuning; no general Uzbek accuracy or unseen-signer claim.',
  registration: { matching: { ...matching, rejectionLabels }, metricThresholds: { distance: .22, margin: .025, maxRatio: .85 },
    backgroundSelection: 'Only the two caption-verified No TRAIN repetitions; neither No regression repetition enters gallery.',
    algorithm: 'Rank all eight references with unchanged scoped visibility DTW; preserve background competition for ambiguity; map best No to none and omit No alternatives.',
    runtimeSchemaChanged: false, profileStatus: 'Private wrapper only. Existing runtime schema does not yet support rejectionLabels; no deployable model exported.' },
  stats, strict, candidate, newFalseAcceptances, rawCompiledParity: parity,
  backgroundTrainConsistencyOnly: trainingConsistency, gatePassed: pass,
  recommendation: pass ? 'Candidate merits parent review for explicit rejectionLabels schema; no public activation yet.' : 'Do not integrate/promote; failed frozen regression gate.' };
const path = resolve('private-video-work/masked-dtw-v1/rejection-prototype-experiment.json');
await writeFile(path, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ path, stats, gatePassed: pass,
  unknowns: candidate.predictions.filter((p) => !p.supported).map((p) => ({ id: p.id, predicted: p.predicted, reason: p.reason })),
  backgroundTrainConsistencyOnly: trainingConsistency.map((r) => ({ id: r.id, label: r.result.label, reason: r.result.reason })) }, null, 2));
