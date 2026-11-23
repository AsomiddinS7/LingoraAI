// Frozen masked-DTW gallery stress checks. Never tune on inspected regressions.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadMatcher, evaluateDatasets } from '../../scripts/evaluate-motion.mjs';
import { createMaskedMatcher, MASKED_DTW_CONFIG } from './masked_dtw.mjs';

const out = resolve('private-video-work/masked-dtw-v1');
await mkdir(out, { recursive: true });
const production = await loadMatcher();
const candidate = createMaskedMatcher(production.normalizeSequence);
const load = async (path, negatives = false) => {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const dataset = production.parseTemplateDataset(JSON.stringify({ ...raw,
    templates: raw.templates.map((t) => ({ ...t, label: t.label === 'none' ? 'expected_negative' : t.label })) }));
  if (negatives) for (const item of dataset.templates) if (item.label === 'expected_negative') item.label = 'none';
  return dataset;
};
const base = 'private-video-work/tracking-v1/';
const train = await load(base + 'greeting-templates-train.json');
const known = await load(base + 'greeting-templates-heldout.json');
const negative = await load(base + 'greeting-templates-negative.json', true);
const addedTrain = await load('private-video-work/additional-vocabulary/templates-train.json');
const addedKnown = await load('private-video-work/additional-vocabulary/templates-heldout.json');
const expanded = { templates: [...train.templates, ...addedTrain.templates] };
const testing = { templates: [...known.templates, ...addedKnown.templates, ...negative.templates] };
const baselineExpanded = evaluateDatasets(expanded, testing, production.matchSequence);
const candidateExpanded = evaluateDatasets(expanded, testing, candidate);
assert.equal(baselineExpanded.excluded.length, 0);
assert.equal(candidateExpanded.excluded.length, 0);
const subsets = [];
for (const [name, gallery] of [['original', train], ['expanded', expanded]]) {
  const labels = [...new Set(gallery.templates.map((t) => t.label))].sort();
  for (let mask = 1; mask < (1 << labels.length); mask++) {
    const included = labels.filter((_label, index) => mask & (1 << index));
    const templates = gallery.templates.filter((t) => included.includes(t.label));
    const compiled = production.compileTemplateDataset(templates).templates;
    for (const query of negative.templates) {
      const baseline = production.matchSequence(query.frames, compiled);
      const experimental = candidate(query.frames, compiled);
      subsets.push({ gallery: name, included, negative: query.id, baseline, candidate: experimental });
    }
  }
}
const expandedParity = testing.templates.map((query) => ({ id: query.id,
  raw: candidate(query.frames, expanded.templates), compiled: candidate(query.frames, production.compileTemplateDataset(expanded.templates).templates) }));
for (const item of expandedParity) assert.deepEqual(item.raw, item.compiled);
const oldIds = new Set(known.templates.map((t) => t.id));
const summarize = (report, oldOnly = false) => {
  const rows = report.predictions.filter((p) => !oldOnly || oldIds.has(p.id) || !p.supported);
  return { correctKnown: rows.filter((p) => p.supported && p.predicted === p.expected).length,
    wrongKnown: rows.filter((p) => p.supported && p.predicted !== 'none' && p.predicted !== p.expected).length,
    rejectedKnown: rows.filter((p) => p.supported && p.predicted === 'none').length,
    rejectedUnknown: rows.filter((p) => !p.supported && p.predicted === 'none').length,
    acceptedUnknown: rows.filter((p) => !p.supported && p.predicted !== 'none').length };
};
const newAcceptances = subsets.filter((r) => r.baseline.label === 'none' && r.candidate.label !== 'none');
const report = { scope: 'Same-source expanded regression and gallery stress checks, not untouched testing. Neither old nor new regression labels fit any threshold.', config: MASKED_DTW_CONFIG,
  summary: { baselineExpanded: summarize(baselineExpanded), candidateExpanded: summarize(candidateExpanded),
    baselineOldRegressionsWithExpandedGallery: summarize(baselineExpanded, true),
    candidateOldRegressionsWithExpandedGallery: summarize(candidateExpanded, true),
    subsetChecks: subsets.length, newUnknownAcceptances: newAcceptances.length },
  baselineExpanded, candidateExpanded, subsetChecks: subsets, newUnknownAcceptances: newAcceptances, expandedRawCompiledParity: expandedParity,
  productionChanged: false, promotion: 'Parent review required; subset failures are deployment limits, not grounds for retuning on these negatives.' };
await writeFile(resolve(out, 'gallery-stress.json'), JSON.stringify(report, (_key, v) => v === Infinity ? null : v, 2));
console.log(JSON.stringify({ summary: report.summary,
  newUnknownAcceptances: newAcceptances.map((r) => ({ gallery: r.gallery, labels: r.included, negative: r.negative, accepted: r.candidate.label })),
  expandedKnown: candidateExpanded.predictions.filter((p) => p.supported).map((p) => ({ id: p.id, expected: p.expected, candidate: p.predicted, reason: p.reason })) }, null, 2));
