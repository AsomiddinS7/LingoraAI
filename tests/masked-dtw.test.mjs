// Mathematical robustness tests, not sign-language accuracy or invented labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMatcher } from '../scripts/evaluate-motion.mjs';
import { createMaskedMatcher, maskedSequenceDistance, observedFrameDistance } from '../tools/ml/masked_dtw.mjs';

const production = await loadMatcher();
function vector(position, left = true, right = true) {
  const values = new Array(128).fill(0);
  for (const [offset, present] of [[0, left], [64, right]]) if (present) {
    values[offset] = 1;
    for (let i = 0; i < 21; i++) {
      values[offset + 1 + i * 3] = position + (offset ? .4 : 0) + i * .005;
      values[offset + 2 + i * 3] = .3 + (i % 4) * .01;
      values[offset + 3 + i * 3] = i * -.002;
    }
  }
  return values;
}
const sequence = (left = true, right = true) => ({ vectors: Array.from({ length: 32 }, (_, i) => vector(i / 31, left, right)), reference: 'body', durationMs: 1000, handCoverage: 1 });

test('fully observed geometry keeps exact production DTW distance', () => {
  const a = sequence(), b = sequence();
  b.vectors = b.vectors.map((v) => v.map((value, index) => [0, 64].includes(index) ? value : value + .04));
  assert.equal(maskedSequenceDistance(a, b).distance, production.sequenceDistance(a, b));
});

test('unobserved frames never become zero-cost evidence', () => {
  const empty = new Array(128).fill(0);
  assert.equal(observedFrameDistance(empty, empty).distance, .44);
  const a = sequence(false, false), result = maskedSequenceDistance(a, a);
  assert.equal(result.distance, Infinity);
  assert.equal(result.sharedFraction, 0);
});

test('opposite missing hand slots reject rather than fabricate a comparison', () => {
  const result = maskedSequenceDistance(sequence(true, false), sequence(false, true));
  assert.equal(result.distance, Infinity);
  assert.equal(result.reason, 'insufficient_shared_observations');
});

test('a short single-hand dropout has less penalty without inventing coordinates', () => {
  const reference = sequence(), query = structuredClone(reference);
  for (let i = 10; i < 13; i++) query.vectors[i].fill(0, 64);
  const result = maskedSequenceDistance(query, reference);
  assert(result.sharedFraction >= .6);
  assert(result.distance < production.sequenceDistance(query, reference));
  assert(query.vectors.slice(10, 13).every((v) => v.slice(64).every((x) => x === 0)));
});

test('forced endpoints retain movement direction', () => {
  const a = sequence(), reversed = { ...a, vectors: [...a.vectors].reverse() };
  assert.equal(maskedSequenceDistance(a, a).distance, 0);
  assert(maskedSequenceDistance(a, reversed).distance > .22);
});

test('timing elasticity retains the unchanged duration penalty', () => {
  const a = sequence(), slow = { ...a, durationMs: 1400 };
  assert(Math.abs(maskedSequenceDistance(a, slow).distance - Math.log(1.4) * .04) < 1e-12);
});

test('minimum distance per label makes duplicate references vote-neutral', () => {
  const match = createMaskedMatcher((value) => value);
  const a = sequence(), b = { ...a, vectors: a.vectors.map((v) => v.map((x, i) => [0, 64].includes(i) ? x : x + 1)) };
  const templates = [{ id: 'example-a', label: 'synthetic_a', normalized: a }, { id: 'example-b', label: 'synthetic_b', normalized: b }];
  assert.deepEqual(match(a, templates), match(a, [...templates, { id: 'copy-a', label: 'synthetic_a', normalized: a }]));
});

test('shape diagnostics separate wrist translation without removing lexical location', () => {
  const a = vector(0), b = vector(.3);
  const result = observedFrameDistance(a, b);
  assert(result.localShapeDiagnostic < 1e-12);
  assert(result.wristDiagnostic > .1);
  assert(result.distance > .1);
});

test('DTW already tolerates modest boundary holds without velocity trimming', () => {
  const a = sequence();
  const padded = { ...a, vectors: [...Array(4).fill(a.vectors[0]), ...a.vectors, ...Array(4).fill(a.vectors.at(-1))] };
  assert.equal(maskedSequenceDistance(a, padded).distance, 0);
});
