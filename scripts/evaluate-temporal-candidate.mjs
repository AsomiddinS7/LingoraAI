import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseTemporalCandidate, inferTemporalCandidate, promotionGate } from './temporal-inference.mjs';

const root = 'private-video-work/training-v2/';
const dataText = await readFile(root + 'normalized-greetings.json', 'utf8');
const data = JSON.parse(dataText);
const report = JSON.parse(await readFile(root + 'temporal-candidate/training-report.json', 'utf8'));
const raw = JSON.parse(await readFile(root + 'temporal-candidate/candidate-model.json', 'utf8'));
assert.equal(raw.data_audit.input_sha256, createHash('sha256').update(dataText).digest('hex'));
const model = parseTemporalCandidate(JSON.stringify(raw));
assert.deepEqual(model.classes, data.labels);
const results = [];
for (const expected of report.candidate.predictions) {
  const input = data.examples.find(example => example.id === expected.id);
  assert(input && input.split !== 'train');
  const start = performance.now();
  const actual = inferTemporalCandidate(input, model);
  assert.equal(actual.label, expected.label);
  assert.equal(actual.nearest_label, expected.nearest_label);
  assert(Math.abs(actual.distance - expected.distance) < 2e-5, `Embedding distance drift: ${input.id}`);
  assert(Math.abs(actual.margin - expected.margin) < 2e-5, `Embedding margin drift: ${input.id}`);
  results.push({ id: input.id, ...actual, milliseconds: performance.now() - start });
}
const result = { numericalParity: true, comparedExamples: results.length,
  gate: promotionGate(report.baseline.summary, report.candidate.summary), results };
await writeFile(root + 'temporal-candidate/portable-evaluation.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ numericalParity: true, examples: results.length, gate: result.gate }));
