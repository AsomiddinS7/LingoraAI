import test from 'node:test';
import assert from 'node:assert/strict';
import { quantizeFeatures } from '../scripts/quantize-motion.mjs';

test('quantization preserves missing-hand masks, timing and coverage without mutating source features', () => {
  const vector = new Array(128).fill(0); vector[0] = 1; vector[1] = .123456789;
  const source = { templates: [{ id: 'a', label: 'hello', normalized: { vectors: [vector], durationMs: 1500, handCoverage: .8 } }] };
  const result = quantizeFeatures(source);
  assert.equal(result.templates[0].normalized.vectors[0][1], .1235);
  assert.deepEqual(result.templates[0].normalized.vectors[0].slice(64), vector.slice(64));
  assert.equal(result.templates[0].normalized.vectors[0][0], 1);
  assert.equal(result.templates[0].normalized.durationMs, 1500);
  assert.equal(result.templates[0].normalized.handCoverage, .8);
  assert.equal(source.templates[0].normalized.vectors[0][1], .123456789);
});
test('quantization limits are explicit and rounding is deterministic', () => {
  assert.throws(() => quantizeFeatures({ templates: [] }, 1));
  assert.throws(() => quantizeFeatures({ templates: [] }, NaN));
  const model = { templates: [{ normalized: { vectors: [[1, -.12345678, 0]] } }] };
  assert.deepEqual(quantizeFeatures(model), quantizeFeatures(model));
});

test('quantization retains the explicitly reviewed matching scope', () => {
  const matching = { profile: 'visibility-aware-dtw-v1', labels: ['hello'], templateIds: ['reference-1'] };
  const model = { matching, templates: [{ normalized: { vectors: [[1, .12345678, 0]] } }] };
  assert.deepEqual(quantizeFeatures(model).matching, matching);
});
