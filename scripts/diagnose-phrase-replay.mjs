// Inspect private browser replay landmarks against the shipped phrase references.
// Source replays are not independent accuracy tests. No raw landmarks are output.
import { readFile } from 'node:fs/promises';
import { loadMatcher } from './evaluate-motion.mjs';

const source = process.argv[2] ?? 'private-video-work/uzslr-inspect/phrase-replay-all/tracked-live.json';
const matcher = await loadMatcher();
const model = matcher.parseMotionModel(await readFile('public/model/signed-speech-model.json', 'utf8'));
const clips = JSON.parse(await readFile(source, 'utf8')).cases;
for (const clip of clips) {
  const target = model.templates.find(t => t.label === clip.expected);
  const frames = clip.frames;
  const count = hand => frames.filter(f => f[hand]).length / Math.max(1, frames.length);
  const one = target ? matcher.matchSequence(frames, [target]) : null;
  const full = matcher.matchSequence(frames, model.templates, { matching: model.matching });
  const normalized = matcher.normalizeSequence(frames);
  const rankings = normalized ? model.templates.map(t => ({ label: t.label,
    strict: matcher.sequenceDistance(normalized, t.normalized),
    visibility: matcher.visibilityAwareSequenceDistance(normalized, t.normalized) })) : [];
  const rank = key => rankings.filter(x => Number.isFinite(x[key])).sort((a, b) => a[key] - b[key])
    .slice(0, 2).map(x => ({ label: x.label, distance: Math.round(x[key] * 1000) / 1000 }));
  console.log(JSON.stringify({ id: clip.id, frameCount: frames.length,
    seconds: frames.length ? Math.round((frames.at(-1).t - frames[0].t) / 10) / 100 : 0,
    leftCoverage: count('left'), rightCoverage: count('right'),
    reference: normalized?.reference ?? null, referenceTemplate: target?.normalized.reference ?? null,
    expectedDistance: Number.isFinite(one?.distance) ? one.distance : null, expectedReason: one?.reason ?? null,
    predicted: full.label, reason: full.reason, strictTop: rank('strict'), visibilityTop: rank('visibility') }));
}
