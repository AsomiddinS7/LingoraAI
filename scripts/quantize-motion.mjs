// Post-training feature quantization with explicit decision-preservation checks.
// It reduces JSON payload, not recognition error or in-memory Float64 precision.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadMatcher } from './evaluate-motion.mjs';

export function quantizeFeatures(model, decimals = 4) {
  if (!Number.isInteger(decimals) || decimals < 3 || decimals > 8) throw new Error('Choose 3–8 decimal places');
  const scale = 10 ** decimals;
  return { ...model, templates: model.templates.map(template => ({ ...template, normalized: {
    ...template.normalized, vectors: template.normalized.vectors.map(vector => vector.map((value, index) =>
      index === 0 || index === 64 ? value : Math.round(value * scale) / scale)),
  } })) };
}
function sameDecision(before, after) {
  return before.label === after.label && before.reason === after.reason;
}
export async function optimizeLocalModels() {
  const matcher = await loadMatcher();
  const root = 'private-video-work/tracking-v1/';
  const output = 'private-video-work/training-v2/optimized/';
  await mkdir(output, { recursive: true });
  const report = { method: 'Round normalized feature coordinates to four decimal places; masks/duration/coverage unchanged.',
    note: 'Decision parity on these recordings and synthetic training perturbations is not unseen-signer validation.', models: [] };
  const loadExamples = async path => JSON.parse(await readFile(path, 'utf8')).templates;
  const negatives = await loadExamples(root + 'greeting-templates-negative.json');
  for (const scope of ['greeting', 'speech']) {
    const sourceText = await readFile(root + `${scope}-model.json`, 'utf8');
    const source = matcher.parseMotionModel(sourceText);
    const rounded = matcher.parseMotionModel(JSON.stringify(quantizeFeatures(source)));
    const examples = await loadExamples(root + `${scope}-templates-train.json`);
    const checks = [...examples, ...negatives];
    if (scope === 'greeting') checks.push(...await loadExamples(root + 'greeting-templates-heldout.json'));
    // Deterministic train-only perturbations test serialization stability, not accuracy.
    for (const example of examples) for (const amount of [-.005, -.001, .001, .005]) {
      const shift = points => points?.map(point => ({ ...point, x: point.x + amount })) ?? null;
      checks.push({ id: `${example.id}-synthetic-shift-${amount}`, frames: example.frames.map(frame => ({ ...frame,
        left: shift(frame.left), right: shift(frame.right), pose: shift(frame.pose),
      })) });
    }
    const predictions = checks.map(example => {
      const before = matcher.matchSequence(example.frames, source.templates, { matching: source.matching });
      const after = matcher.matchSequence(example.frames, rounded.templates, { matching: rounded.matching });
      if (!sameDecision(before, after)) throw new Error(`Quantization changed decision: ${scope}/${example.id}`);
      return { id: example.id, label: after.label, reason: after.reason,
        distanceDrift: Number.isFinite(before.distance) && Number.isFinite(after.distance) ? Math.abs(before.distance - after.distance) : 0 };
    });
    const json = JSON.stringify(rounded);
    const stats = { scope, inputBytes: Buffer.byteLength(sourceText), outputBytes: Buffer.byteLength(json),
      inputGzipBytes: gzipSync(sourceText).length, outputGzipBytes: gzipSync(json).length,
      sourceSha256: createHash('sha256').update(sourceText).digest('hex'),
      outputSha256: createHash('sha256').update(json).digest('hex'),
      originalChecks: examples.length + negatives.length + (scope === 'greeting' ? 5 : 0),
      syntheticTrainingChecks: examples.length * 4, decisionParity: true,
      maximumDistanceDrift: Math.max(...predictions.map(item => item.distanceDrift)), predictions };
    if (stats.outputBytes >= stats.inputBytes) throw new Error('Quantization did not reduce payload');
    await writeFile(output + `${scope}-model.json`, json);
    report.models.push(stats);
  }
  await writeFile(output + 'quantization-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.models.map(({ predictions: _predictions, ...stats }) => stats)));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  optimizeLocalModels().catch(error => { console.error(error.message); process.exitCode = 1; });
