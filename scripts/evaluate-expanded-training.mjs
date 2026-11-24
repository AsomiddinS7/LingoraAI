import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadMatcher } from './evaluate-motion.mjs';
import { parseTemporalCandidate, inferTemporalCandidate, promotionGate } from './temporal-inference.mjs';
import { createHybridClassifier } from './hybrid-sign-inference.mjs';
import { parseSkeletalCandidate, inferSkeletalCandidate, skeletalDescriptor } from './skeletal-inference.mjs';

const rootIndex = process.argv.indexOf('--root');
const root = (rootIndex >= 0 ? process.argv[rootIndex+1].replace(/\/$/,'') : 'private-video-work/training-expanded-v1') + '/';
const dataBytes = await readFile(root + 'normalized-words.json');
const data = JSON.parse(dataBytes);
const skeletal = process.argv.includes('--skeletal');
const familyIndex=process.argv.indexOf('--family');
const family = familyIndex>=0 ? process.argv[familyIndex+1] : skeletal ? 'skeletal' : 'temporal';
if(!['skeletal','temporal','ensemble'].includes(family))throw new Error('Invalid classifier family');
const training = JSON.parse(await readFile(root + family + '/training-report.json', 'utf8'));
const raw = JSON.parse(await readFile(root + 'experiment-raw.json', 'utf8'));
const modelText = await readFile(root + family + '/candidate-model.json', 'utf8');
const model = skeletal ? parseSkeletalCandidate(modelText) : parseTemporalCandidate(modelText);
const infer = skeletal ? inferSkeletalCandidate : inferTemporalCandidate;
const matcher = await loadMatcher();
const gallery = matcher.parseMotionModel(await readFile(root + 'baseline-model.json', 'utf8'));
assert.equal(JSON.parse(modelText).data_audit.input_sha256, createHash('sha256').update(dataBytes).digest('hex'));
const classify = createHybridClassifier(matcher, gallery, model, infer);
if (skeletal) for (const parity of training.parity_descriptors) {
  const actual = skeletalDescriptor(data.examples.find(e => e.id === parity.id),model.descriptor.endsWith('activity-v2'));
  assert(actual.every((value, i) => Math.abs(value - parity.values[i]) < 3e-6), 'Skeletal descriptor parity failed');
}
const rows = [];
for (const expected of skeletal ? training.predictions : training.candidate.predictions) {
  const input = data.examples.find(e => e.id === expected.id);
  const actual = infer(input, model);
  assert.equal(actual.label, expected.label);
  if(expected.reason==='insufficient_tracking'){
    assert.equal(actual.reason,'insufficient_tracking');
  }else{
  assert(Math.abs((skeletal ? actual.score - expected.score : actual.distance - expected.distance)) < 3e-5);
  assert(Math.abs(actual.margin - expected.margin) < 3e-5);
  }
  const source = raw.samples.find(s => s.id === input.id);
  const started = performance.now();
  rows.push({ id: input.id, expected: input.label, split: input.split, ...classify(source.frames), milliseconds: performance.now() - started });
}
const summary = key => {
  const known = rows.filter(r => r.split === 'regression'), unknown = rows.filter(r => r.split === 'unknown_regression');
  return { known_examples: known.length, correct_accepted: known.filter(r => r[key].label === r.expected).length,
    wrong_accepted: known.filter(r => !['none', r.expected].includes(r[key].label)).length,
    known_rejected: known.filter(r => r[key].label === 'none').length,
    unknown_examples: unknown.length, unknown_rejected: unknown.filter(r => r[key].label === 'none').length,
    unknown_wrong_accepted: unknown.filter(r => r[key].label !== 'none').length };
};
const result = { numericalParity: true, baseline: summary('baseline'), neural: summary('neural'), hybrid: summary('result'), rows,
  scope: data.provenance.scope, limitation: 'Development regression has been inspected. Hybrid rule development is exploratory, not an untouched benchmark or unseen-signer accuracy.' };
result.gate = promotionGate(result.baseline, result.hybrid);
await writeFile(root + (family==='ensemble'?'evaluation-ensemble.json':skeletal ? 'evaluation-skeletal.json' : 'evaluation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ numericalParity: true, baseline: result.baseline, neural: result.neural, hybrid: result.hybrid, gate: result.gate }, null, 2));
