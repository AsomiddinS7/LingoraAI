import test from 'node:test';
import assert from 'node:assert/strict';
import { skeletalDescriptor, parseSkeletalCandidate, inferSkeletalCandidate, activityVectors } from '../scripts/skeletal-inference.mjs';
import { hybridDecision } from '../scripts/hybrid-sign-inference.mjs';

const input = () => ({ reference: 'body', handCoverage: 1, vectors: Array.from({ length: 32 }, (_, t) => {
  const v = new Array(128).fill(0); v[0] = 1;
  for (let j = 0; j < 21; j++) { v[1+j*3] = .1 + .01*j + t*.005; v[2+j*3] = .2 + .015*j; v[3+j*3] = .003*j; }
  return v;
}) });
const model = () => ({ format: 'lingora-skeletal-ridge-v1', feature_version: 'two-hand-body-v2',
  descriptor: 'palm-local-shape-body-wrist-six-pools-v1', classes: ['help', 'drink'],
  mean: new Array(768).fill(0), scale: new Array(768).fill(1), weight: Array.from({ length: 768 }, () => [0,0]),
  bias: [1,0], minimum_score: .1, minimum_margin: .02 });

test('finger shape retains orientation and body location while tolerating palm size', () => {
  const original = input(), scaled = input();
  scaled.vectors.forEach(v => { for (let j = 1; j < 64; j++) v[j] *= 2; });
  const a = skeletalDescriptor(original), b = skeletalDescriptor(scaled);
  for (let j = 4; j < 64; j++) assert(Math.abs(a[j] - b[j]) < 1e-10);
  assert(Math.abs(a[1] * 2 - b[1]) < 1e-10);
  const reversed = input(); reversed.vectors.reverse();
  assert.notDeepEqual(skeletalDescriptor(reversed), a, 'direction must remain represented in temporal pools');
});

test('missing hands never become fabricated coordinates or a translation', () => {
  const empty = { ...input(), vectors: Array.from({ length: 32 }, () => new Array(128).fill(0)) };
  assert(skeletalDescriptor(empty).every(x => x === 0));
  const parsed = parseSkeletalCandidate(JSON.stringify(model()));
  assert.equal(inferSkeletalCandidate(empty, parsed).label, 'none');
  assert.equal(inferSkeletalCandidate({ ...input(), handCoverage: .3 }, parsed).label, 'none');
  assert.equal(inferSkeletalCandidate(input(), parsed).label, 'help');
});

test('model rejects malformed dimensions, unsafe scales, duplicate classes and nonfinite inputs', () => {
  for (const mutate of [m => m.weight.pop(), m => m.scale[0] = 0, m => m.classes[1] = m.classes[0]]) {
    const raw = model(); mutate(raw); assert.throws(() => parseSkeletalCandidate(JSON.stringify(raw)));
  }
  const invalid = input(); invalid.vectors[0][0] = .5;
  assert.throws(() => skeletalDescriptor(invalid));
  invalid.vectors[0][0] = 1; invalid.vectors[0][1] = NaN;
  assert.throws(() => skeletalDescriptor(invalid));
});

test('trained agreement resolves ambiguity only inside the unchanged DTW acceptance radius', () => {
  const neural = { accepted: true, label: 'help', distance: .1 };
  const baseline = { label: 'none', reason: 'ambiguous', alternatives: [], distance: .1 };
  assert.equal(hybridDecision(baseline, neural, 'help').label, 'help');
  assert.equal(hybridDecision(baseline, neural, 'drink').label, 'none');
  assert.equal(hybridDecision({ ...baseline, reason: 'too_distant' }, neural, 'help').label, 'none');
  assert.equal(hybridDecision({ ...baseline, reason: 'insufficient_tracking' }, neural, 'help').label, 'none');
  assert.equal(hybridDecision(baseline, { ...neural, accepted: false }, 'help').label, 'none');
  assert.equal(hybridDecision({ ...baseline, label: 'drink', reason: 'matched' }, neural, 'help').label, 'drink');
  assert.equal(hybridDecision({ ...baseline, label: 'drink', reason: 'matched' }, { ...neural, reason: 'insufficient_motion' }, 'drink').label, 'none');
});

test('train-calibrated inactivity rule rejects stationary hands while preserving a complete movement', () => {
  const raw = model(); raw.motion_gate = { profile: 'body-centroid-q10-q90-v1', minimum_span: .05 };
  const parsed = parseSkeletalCandidate(JSON.stringify(raw));
  const still = input(); still.vectors = still.vectors.map(() => still.vectors[0]);
  assert.equal(inferSkeletalCandidate(still, parsed).reason, 'insufficient_motion');
  assert.equal(inferSkeletalCandidate(input(), parsed).label, 'help');
});

test('activity features keep the full view, temporal direction, and real missingness',()=>{
  const original=input();
  for(let t=8;t<13;t++)original.vectors[t].fill(0,0,64);
  const focused=activityVectors(original);
  assert.equal(focused.length,32);
  for(const v of focused)for(const offset of [0,64])if(!v[offset])assert(v.slice(offset+1,offset+64).every(n=>n===0));
  const full=skeletalDescriptor(original),both=skeletalDescriptor(original,true);
  assert.equal(both.length,1536);assert.deepEqual(both.slice(0,768),full);
  const reverse={...original,vectors:original.vectors.slice().reverse()};
  assert.notDeepEqual(skeletalDescriptor(reverse,true),both);
});
