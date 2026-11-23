// Production scoped-profile verification; never promotes a public model.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadMatcher, evaluateDatasets } from '../../scripts/evaluate-motion.mjs';

const production = await loadMatcher();
const root = resolve('private-video-work/tracking-v1');
const out = resolve('private-video-work/masked-dtw-v1');
await mkdir(out, { recursive: true });
const read = async (filename, negatives = false) => {
  const raw = JSON.parse(await readFile(resolve(root, filename), 'utf8'));
  const parsed = production.parseTemplateDataset(JSON.stringify({ ...raw, templates: raw.templates.map((t) => ({ ...t, label: t.label === 'none' ? 'negative_expected' : t.label })) }));
  if (negatives) for (const item of parsed.templates) if (item.label === 'negative_expected') item.label = 'none';
  return parsed;
};
const train = await read('greeting-templates-train.json');
const known = await read('greeting-templates-heldout.json');
const negative = await read('greeting-templates-negative.json', true);
const queries = { templates: [...known.templates, ...negative.templates] };
const matching = { profile: 'visibility-aware-dtw-v1', labels: [...new Set(train.templates.map((t) => t.label))].sort(), templateIds: train.templates.map((t) => t.id).sort() };
const model = production.compileTemplateDataset(train, matching);
assert.deepEqual(production.parseMotionModel(JSON.stringify(model)).matching, matching);
assert.deepEqual(production.compileTemplateDataset(model).matching, matching);
const aware = (frames, templates) => production.matchSequence(frames, templates, { matching });
const strictReport = evaluateDatasets(train, queries, production.matchSequence);
const scopedReport = evaluateDatasets(train, queries, aware);
assert.equal(strictReport.excluded.length, 0); assert.equal(scopedReport.excluded.length, 0);
const parity = queries.templates.map((query) => {
  const raw = aware(query.frames, train.templates), compiled = aware(query.frames, model.templates);
  assert.deepEqual(raw, compiled);
  return { id: query.id, raw, compiled };
});
const subsetChecks = [];
for (let mask = 1; mask < (1 << train.templates.length); mask++) {
  const subset = model.templates.filter((_t, index) => mask & (1 << index));
  for (const query of negative.templates) {
    const strict = production.matchSequence(query.frames, subset);
    const scoped = aware(query.frames, subset);
    if (subset.length !== model.templates.length) assert.deepEqual(scoped, strict, 'Partial reviewed dictionary must use exact strict behavior');
    assert.equal(scoped.label, 'none', 'No unsupported negative may be accepted in any original dictionary subset');
    subsetChecks.push({ ids: subset.map((t) => t.id), query: query.id, strict: strict.label, scoped: scoped.label });
  }
}
const incompatible = structuredClone(model.templates);
incompatible[0].normalized.reference = 'hands';
const incompatibleChecks = queries.templates.map((query) => {
  const strict = production.matchSequence(query.frames, incompatible), scoped = aware(query.frames, incompatible);
  assert.deepEqual(strict, scoped);
  return { query: query.id, strict: strict.label, scoped: scoped.label };
});
const summarize = (rows) => ({ correctKnown: rows.filter((r) => r.supported && r.predicted === r.expected).length,
  wrongKnown: rows.filter((r) => r.supported && r.predicted !== 'none' && r.predicted !== r.expected).length,
  rejectedKnown: rows.filter((r) => r.supported && r.predicted === 'none').length,
  rejectedUnknown: rows.filter((r) => !r.supported && r.predicted === 'none').length,
  acceptedUnknown: rows.filter((r) => !r.supported && r.predicted !== 'none').length });
const report = { scope: 'Production matcher with explicitly declared complete dictionary. Previously inspected one-signer/session regressions; not fresh held-out accuracy.',
  matching, sourceSha256: createHash('sha256').update(await readFile('src/ml/sequence.ts')).digest('hex'),
  summary: { strict: summarize(strictReport.predictions), scoped: summarize(scopedReport.predictions), rawCompiledParity: parity.length,
    templateSubsetNegativeChecks: subsetChecks.length, incompatibleReferenceFallbackChecks: incompatibleChecks.length },
  strictReport, scopedReport, rawCompiledParity: parity, subsetChecks, incompatibleChecks,
  publicModelsChanged: false, speechProfile: 'unchanged strict',
  recommendation: 'Eligible for parent review only on this exact bundled greeting dictionary. Keep new no class private; no opt-in on custom/raw dictionaries.' };
await writeFile(resolve(out, 'profiled-greeting-model.json'), JSON.stringify(model));
await writeFile(resolve(out, 'production-profile-evaluation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ summary: report.summary, matching, model: resolve(out, 'profiled-greeting-model.json') }, null, 2));
