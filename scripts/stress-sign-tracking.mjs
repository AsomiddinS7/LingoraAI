// Numerical tracking perturbations, distinct from real pixel-level simulation.
import { readFile, writeFile } from 'node:fs/promises';
import { loadMatcher } from './evaluate-motion.mjs';
import { parseSkeletalCandidate, inferSkeletalCandidate } from './skeletal-inference.mjs';
import { createHybridClassifier } from './hybrid-sign-inference.mjs';

const root = 'private-video-work/training-expanded-v1/';
const matcher = await loadMatcher();
const gallery = matcher.parseMotionModel(await readFile(root + 'baseline-model.json', 'utf8'));
const model = parseSkeletalCandidate(await readFile(root + 'skeletal/candidate-model.json', 'utf8'));
const classify = createHybridClassifier(matcher, gallery, model, inferSkeletalCandidate);
const pixel = JSON.parse(await readFile(root + 'simulation/tracked-pixels.json', 'utf8'));
const seen = new Set(), rows = [];
for (const test of pixel.cases.filter(c => c.scope === 'word' && c.expected !== 'none' && c.scenario === 'nominal')) {
  if (seen.has(test.expected)) continue;
  seen.add(test.expected);
  for (const scenario of ['half_frame_rate', 'slow_075', 'fast_135', 'brief_dropout', 'severe_dropout', 'no_hands']) {
    let frames = structuredClone(test.frames);
    if (scenario === 'half_frame_rate') frames = frames.filter((_, i) => i % 2 === 0);
    if (scenario === 'slow_075' || scenario === 'fast_135') {
      const factor = scenario === 'slow_075' ? .75 : 1.35;
      frames = frames.map(f => ({ ...f, t: f.t / factor }));
    }
    if (scenario.includes('dropout') || scenario === 'no_hands') {
      const fraction = scenario === 'brief_dropout' ? .12 : scenario === 'severe_dropout' ? .65 : 1;
      const start = Math.floor(frames.length * (1 - fraction) / 2), end = Math.ceil(start + fraction * frames.length);
      frames = frames.map((f, i) => i >= start && i < end ? { ...f, left: null, right: null } : f);
    }
    const result = classify(frames);
    const mustReject = ['severe_dropout', 'no_hands'].includes(scenario);
    rows.push({ id: test.id, expected: test.expected, trainingSourceReplay: test.trainingSourceReplay, scenario, mustReject,
      ...result, passed: mustReject ? result.result.label === 'none' : result.result.label === test.expected });
  }
}
const summary = Object.fromEntries([...new Set(rows.map(r => r.scenario))].map(scenario => {
  const selected = rows.filter(r => r.scenario === scenario);
  return [scenario, { examples: selected.length, passed: selected.filter(r => r.passed).length,
    wrongAccepted: selected.filter(r => r.result.label !== 'none' && r.result.label !== r.expected).length }];
}));
await writeFile(root + 'simulation/tracking-stress.json', JSON.stringify({
  scope: 'Synthetic censoring/frame-rate/timestamp changes to tracked real replays. Not fresh video or signer validation.',
  labelsCovered: seen.size, rows, summary }, null, 2));
console.log(JSON.stringify(summary, null, 2));
