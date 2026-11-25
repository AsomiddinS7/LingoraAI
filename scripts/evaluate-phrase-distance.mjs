// Exploratory source-replay and unrelated-movement check; never a new-signer benchmark.
import { readFile } from 'node:fs/promises';
import { loadMatcher } from './evaluate-motion.mjs';

const matcher = await loadMatcher();
const model = matcher.parseMotionModel(await readFile('public/model/signed-speech-model.json', 'utf8'));
const load = async path => JSON.parse(await readFile(path, 'utf8')).cases;
const positives = [
  ...await load('private-video-work/uzslr-inspect/phrase-replay-all/tracked-live.json'),
  ...await load('private-video-work/uzslr-inspect/phrase-calibrated/tracked-live.json'),
];
const negatives = (await load('private-video-work/training-expanded-v3/live/tracked-live.json')).filter(c => c.scope === 'word');
const thresholds = [0.22, 0.27, 0.30, 0.32];
for (const maxDistance of thresholds) {
  const predict = c => matcher.matchSequence(c.frames, model.templates, { matching: model.matching, maxDistance });
  const positivesByCase = positives.map(c => ({ id: c.id, expected: c.expected, result: predict(c) }));
  const acceptedNegatives = negatives.map(c => ({ id: c.id, result: predict(c) })).filter(c => c.result.label !== 'none');
  console.log(JSON.stringify({ maxDistance, positiveCorrect: positivesByCase.filter(c => c.result.label === c.expected).length,
    positiveCount: positivesByCase.length, negativeCount: negatives.length, negativeAccepted: acceptedNegatives.length,
    positivePredictions: positivesByCase.map(c => ({ id: c.id, label: c.result.label, reason: c.result.reason })),
    acceptedNegatives: acceptedNegatives.map(c => ({ id: c.id, label: c.result.label, distance: c.result.distance })) }));
}
