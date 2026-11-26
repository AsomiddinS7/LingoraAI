// Counterfactual capture diagnostics on already-recorded landmarks.
// This is a regression experiment, not a new signer or physical-phone test.
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const source = resolve(process.env.LINGORA_CAPTURE_REPLAY ?? 'private-video-work/uzslr-inspect/production-replay-v2/tracked-live.json');
const output = resolve(process.env.LINGORA_CAPTURE_REPORT ?? 'private-video-work/benchmark-v1/capture-cuts.json');
const raw = await readFile(source, 'utf8');
const cases = JSON.parse(raw).cases;
const bundle = await build({ entryPoints: ['src/ml/sequenceStore.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { createSequenceStore } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const store = createSequenceStore();
store.importJson(await readFile('public/model/trained-sign-model.json', 'utf8'));
const allowed = new Set(['hello', 'goodbye', 'please']);
const scenarios = [
  { name: 'original', cutStartMs: 0, cutEndMs: 0 },
  { name: 'start_250ms_late', cutStartMs: 250, cutEndMs: 0 },
  { name: 'start_500ms_late', cutStartMs: 500, cutEndMs: 0 },
  { name: 'start_1000ms_late', cutStartMs: 1000, cutEndMs: 0 },
  { name: 'end_500ms_early', cutStartMs: 0, cutEndMs: 500 },
];
const records = [];
for (const item of cases) {
  const frames = item.frames;
  if (!frames?.length) continue;
  const first = frames[0].t, last = frames.at(-1).t;
  const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t);
  const quantile = (a, q) => a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * q)] : null;
  const predictions = scenarios.map(scenario => {
    const selected = frames.filter(f => f.t >= first + scenario.cutStartMs && f.t <= last - scenario.cutEndMs);
    const firstHand = selected.findIndex(f => f.left || f.right);
    let lastHand = selected.length - 1;
    while (lastHand > firstHand && !selected[lastHand].left && !selected[lastHand].right) lastHand--;
    const trimmed = firstHand < 0 ? selected : selected.slice(firstHand, lastHand + 1);
    const result = store.match(trimmed);
    const label = allowed.has(result.label) ? result.label : 'none';
    return { scenario: scenario.name, frames: selected.length, label, reason: result.reason };
  });
  records.push({ id: item.id, expected: item.expected, scope: item.scope, frames: frames.length,
    observedSpanMs: Math.round(last - first), sourceDurationMs: Math.round(item.durationSeconds * 1000),
    anyHandFraction: frames.filter(f => f.left || f.right).length / frames.length,
    bothHandsFraction: frames.filter(f => f.left && f.right).length / frames.length,
    medianFrameGapMs: quantile(gaps, .5), p95FrameGapMs: quantile(gaps, .95), maxFrameGapMs: gaps.length ? Math.max(...gaps) : null,
    predictions });
}
const summaries = scenarios.map(({ name }) => {
  const rows = records.map(row => ({ ...row, prediction: row.predictions.find(p => p.scenario === name) }));
  const known = rows.filter(row => allowed.has(row.expected));
  // Every label outside the active three-word app vocabulary is a negative,
  // including other real signs; it must not silently become one of those words.
  const unknown = rows.filter(row => !allowed.has(row.expected));
  return { scenario: name, known: known.length, correct: known.filter(row => row.prediction.label === row.expected).length,
    rejectedKnown: known.filter(row => row.prediction.label === 'none').length,
    wrongKnown: known.filter(row => row.prediction.label !== 'none' && row.prediction.label !== row.expected).length,
    unknown: unknown.length, falseAccepts: unknown.filter(row => row.prediction.label !== 'none').length };
});
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ format: 'lingora-capture-cuts-v1',
  limitations: ['Recorded browser replay; no physical phone.', 'These source windows have already been used in development.',
    'Cutting saved landmarks simulates missing endpoints; it does not reproduce video decoding or tracker restart.',
    'Observed frame span does not establish exact motion start or end coverage.'], summaries, records }, null, 2));
console.log(JSON.stringify(summaries, null, 2));
