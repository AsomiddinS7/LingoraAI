// Final production/quantization gate for an explicitly scoped negative dictionary.
// No threshold fitting or public model copy occurs here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadMatcher, evaluateDatasets } from '../../scripts/evaluate-motion.mjs';
import { quantizeFeatures } from '../../scripts/quantize-motion.mjs';

const production = await loadMatcher();
const out = resolve('private-video-work/masked-dtw-v1');
await mkdir(out, { recursive: true });
const load = async (path, negatives = false) => {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  const parsed = production.parseTemplateDataset(JSON.stringify({ ...raw,
    templates: raw.templates.map((t) => ({ ...t, label: t.label === 'none' ? 'negative_expected' : t.label })) }));
  if (negatives) for (const t of parsed.templates) if (t.label === 'negative_expected') t.label = 'none';
  return parsed;
};
const original = await load('private-video-work/tracking-v1/greeting-templates-train.json');
const known = await load('private-video-work/tracking-v1/greeting-templates-heldout.json');
const unknown = await load('private-video-work/tracking-v1/greeting-templates-negative.json', true);
const backgrounds = await load('private-video-work/additional-vocabulary/templates-train.json');
const newUnknown = await load('private-video-work/additional-vocabulary/templates-heldout.json');
assert.equal(original.templates.length, 6); assert.equal(backgrounds.templates.length, 2);
const gallery = { templates: [...original.templates, ...backgrounds.templates] };
const matching = { profile: 'visibility-aware-dtw-v1', labels: [...new Set(gallery.templates.map((t) => t.label))].sort(),
  templateIds: gallery.templates.map((t) => t.id).sort(), rejectionLabels: ['no'] };
const model = production.compileTemplateDataset(gallery, matching);
const rounded = production.parseMotionModel(JSON.stringify(quantizeFeatures(model, 4)));
assert.deepEqual(rounded.matching, matching);
assert.deepEqual(production.compileTemplateDataset(rounded).matching, matching);
const queries = { templates: [...known.templates, ...unknown.templates, ...newUnknown.templates.map((t) => ({ ...t, label: 'none' }))] };
const strictBaseline = evaluateDatasets(original, queries, production.matchSequence);
const scoped = (frames, templates) => production.matchSequence(frames, templates, { matching });
const rawReport = evaluateDatasets(gallery, queries, scoped);
// Keep original frames for the independent provenance audit while inference
// reads only the compiled deployment coordinates.
const roundedReport = evaluateDatasets(gallery, queries, (frames) => scoped(frames, rounded.templates));
assert.equal(rawReport.excluded.length, 0); assert.equal(roundedReport.excluded.length, 0);
const checks = [...queries.templates, ...gallery.templates];
for (const template of original.templates) {
  for (const factor of [.75, 1.4]) checks.push({ ...template, id: `${template.id}-timing-${factor}`,
    frames: template.frames.map((frame) => ({ ...frame, t: template.frames[0].t + (frame.t - template.frames[0].t) * factor })) });
  const frames = structuredClone(template.frames), first = Math.floor(frames.length * .45);
  for (let i = first; i < Math.min(first + 3, frames.length); i++) frames[i].right = null;
  checks.push({ ...template, id: `${template.id}-single-hand-dropout`, frames });
}
const parity = checks.map((query) => {
  const raw = scoped(query.frames, gallery.templates), compiled = scoped(query.frames, model.templates), quantized = scoped(query.frames, rounded.templates);
  assert.deepEqual(raw, compiled);
  assert.equal(quantized.label, raw.label, `Quantization changes label: ${query.id}`);
  assert.equal(quantized.reason, raw.reason, `Quantization changes reason: ${query.id}`);
  for (const result of [raw, quantized]) {
    assert.notEqual(result.label, 'no'); assert(!result.alternatives.some((a) => a.label === 'no'));
  }
  return { id: query.id, label: quantized.label, reason: quantized.reason,
    distanceDrift: Number.isFinite(raw.distance) && Number.isFinite(quantized.distance) ? Math.abs(raw.distance - quantized.distance) : 0 };
});
const partialChecks = [];
for (const removed of model.templates) {
  const partial = rounded.templates.filter((t) => t.id !== removed.id);
  for (const query of [...queries.templates, ...backgrounds.templates]) {
    const fallback = scoped(query.frames, partial);
    const strictWithPolicy = production.matchSequence(query.frames, partial, { matching: { ...matching, profile: 'strict-dtw-v1' } });
    assert.deepEqual(fallback, strictWithPolicy);
    assert.notEqual(fallback.label, 'no'); assert(!fallback.alternatives.some((a) => a.label === 'no'));
    partialChecks.push({ removedId: removed.id, query: query.id, label: fallback.label, strictPolicyParity: true });
  }
}
const summarize = (report) => ({ knownCorrect: report.predictions.filter((p) => p.supported && p.predicted === p.expected).length,
  knownWrong: report.predictions.filter((p) => p.supported && p.predicted !== 'none' && p.predicted !== p.expected).length,
  knownRejected: report.predictions.filter((p) => p.supported && p.predicted === 'none').length,
  unknownRejected: report.predictions.filter((p) => !p.supported && p.predicted === 'none').length,
  unknownFalseAccepted: report.predictions.filter((p) => !p.supported && p.predicted !== 'none').length });
const stats = { strictBaseline: summarize(strictBaseline), productionProfile: summarize(rawReport), quantizedProfile: summarize(roundedReport) };
const backgroundSourceConsistency = backgrounds.templates.map((query) => ({ id: query.id, result: scoped(query.frames, rounded.templates) }));
assert(backgroundSourceConsistency.every((r) => r.result.label === 'none' && r.result.reason === 'background_reference'));
const pass = stats.quantizedProfile.knownCorrect > stats.strictBaseline.knownCorrect
  && stats.quantizedProfile.knownWrong === 0 && stats.quantizedProfile.unknownFalseAccepted === 0;
assert(pass, 'Frozen regression gate failed; do not promote');
const serialized = JSON.stringify(rounded), path = resolve(out, 'rejection-profile-greeting-model.quantized.json');
await writeFile(path, serialized);
const report = { scope: 'Already inspected same-signer/session regression. Four translatable classes plus two explicit No background references; not No recognition or general accuracy.',
  matching, stats, gatePassed: pass, strictBaseline, rawReport, roundedReport,
  backgroundSourceConsistencyOnly: backgroundSourceConsistency,
  rawCompiledQuantizedChecks: parity, partialDictionaryStrictPolicyChecks: partialChecks,
  quantization: { decimals: 4, inputBytes: Buffer.byteLength(JSON.stringify(model)), outputBytes: Buffer.byteLength(serialized),
    maximumDistanceDrift: Math.max(...parity.map((r) => r.distanceDrift)), sha256: createHash('sha256').update(serialized).digest('hex') },
  publicModelsChanged: false, artifact: path, recommendation: 'Parent reviews and copies only this negative-reference model; do not activate the older four-class masked artifact.' };
await writeFile(resolve(out, 'rejection-profile-production-evaluation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ path, stats, gatePassed: pass, quantization: report.quantization,
  parityChecks: parity.length, partialPolicyChecks: partialChecks.length, matching }, null, 2));
