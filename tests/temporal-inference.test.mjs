import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTemporalCandidate, inferTemporalCandidate, promotionGate } from '../scripts/temporal-inference.mjs';

test('promotion rejects a candidate that just rejects everything', () => {
  const baseline = { known_examples: 5, correct_accepted: 3, wrong_accepted: 0, unknown_examples: 3, unknown_wrong_accepted: 0 };
  const candidate = { ...baseline, correct_accepted: 0 };
  assert.equal(promotionGate(baseline, candidate).regressionGatePassed, false);
  assert.equal(promotionGate(baseline, candidate).productionPromotion, false);
});
test('promotion rejects higher apparent recall with worse unknown rejection', () => {
  const baseline = { known_examples: 5, correct_accepted: 3, wrong_accepted: 0, unknown_examples: 3, unknown_wrong_accepted: 0 };
  assert.equal(promotionGate(baseline, { ...baseline, correct_accepted: 5, unknown_wrong_accepted: 1 }).regressionGatePassed, false);
});
test('candidate parser rejects malformed architecture and dimensions before inference', () => {
  assert.throws(() => parseTemporalCandidate('{}'));
  assert.throws(() => parseTemporalCandidate(' '.repeat(2_000_001)));
});
test('missing or nonnumeric evaluation metrics cannot bypass the promotion gate', () => {
  assert.equal(promotionGate({}, {}).regressionGatePassed, false);
  const metrics = { known_examples: 5, correct_accepted: 3, wrong_accepted: 0, unknown_examples: 3, unknown_wrong_accepted: 0 };
  assert.equal(promotionGate(metrics, { ...metrics, correct_accepted: NaN }).regressionGatePassed, false);
});
test('trained private candidate never predicts on completely missing hands', async context => {
  let text;
  try { text = await readFile('private-video-work/training-v2/temporal-candidate/candidate-model.json', 'utf8'); }
  catch { context.skip('Private training artifact is absent'); return; }
  const model = parseTemporalCandidate(text);
  const result = inferTemporalCandidate({ reference: 'body', handCoverage: 1, vectors: Array.from({ length: 32 }, () => new Array(128).fill(0)) }, model);
  assert.equal(result.label, 'none');
  assert.equal(result.reason, 'insufficient_tracking');
  const raw = JSON.parse(text); raw.weights.conv_weight[0].pop();
  assert.throws(() => parseTemporalCandidate(JSON.stringify(raw)));
  const invalidOperation = JSON.parse(text); invalidOperation.architecture.temporal_conv.operation = 'convolution';
  assert.throws(() => parseTemporalCandidate(JSON.stringify(invalidOperation)));
});
