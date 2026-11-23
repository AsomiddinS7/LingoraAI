// Held-out complete-repetition evaluation. Does not count template replay as accuracy.
// Usage: node scripts/evaluate-motion.mjs --train TRAIN.json --test TEST.json [--negative NEGATIVE.json] --out REPORT.json
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import { recordingName } from './model-provenance.mjs';

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--train', '--test', '--negative', '--out'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: node scripts/evaluate-motion.mjs --train TRAIN.json --test TEST.json [--negative NEGATIVE.json] --out REPORT.json');
    result[argv[i].slice(2)] = argv[i + 1];
  }
  if (!result.train || !result.test) throw new Error('Both --train and --test independent datasets are required');
  return result;
}

export async function loadMatcher() {
  // sequence.ts has type-only imports. Transform the actual production matcher rather
  // than maintaining an evaluator with subtly different normalization or thresholds.
  const source = await readFile(new URL('../src/ml/sequence.ts', import.meta.url), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'es2020' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

export function evaluateDatasets(training, testing, matchSequence) {
  const sourceKey = (template) => recordingName(template.source?.name ?? '');
  const trainSources = new Set(training.templates.map(sourceKey).filter(Boolean));
  const trainingLabels = new Set(training.templates.map((t) => t.label));
  const excluded = [];
  const predictions = [];
  for (const clip of testing.templates) {
    if (!clip.source?.name) { excluded.push({ id: clip.id, reason: 'missing_recording_provenance' }); continue; }
    const start = clip.frames[0].t, end = clip.frames.at(-1).t;
    if (training.templates.some((t) => sourceKey(t) === sourceKey(clip)
      && start <= t.frames.at(-1).t && end >= t.frames[0].t)) {
      excluded.push({ id: clip.id, reason: 'source_time_interval_overlaps_training' }); continue;
    }
    // Ignore timestamps so shifted copies of the same landmark sequence cannot be evaluated.
    const geometry = (frames) => JSON.stringify(frames.map(({ t: _t, ...landmarks }) => landmarks));
    if (training.templates.some((t) => geometry(t.frames) === geometry(clip.frames))) {
      excluded.push({ id: clip.id, reason: 'identical_training_frames' }); continue;
    }
    const result = matchSequence(clip.frames, training.templates);
    predictions.push({ id: clip.id, source: clip.source.name, t0Ms: start, t1Ms: end, expected: clip.label,
      sameTrainingRecording: trainSources.has(sourceKey(clip)),
      supported: trainingLabels.has(clip.label), predicted: result.label, similarity: result.confidence,
      distance: Number.isFinite(result.distance) ? result.distance : null, reason: result.reason });
  }
  const supported = predictions.filter((p) => p.supported);
  const accepted = predictions.filter((p) => p.predicted !== 'none');
  const correct = predictions.filter((p) => p.predicted === p.expected);
  const unknown = predictions.filter((p) => !p.supported);
  const confusion = Object.create(null);
  for (const p of predictions) {
    confusion[p.expected] ??= Object.create(null);
    confusion[p.expected][p.predicted] = (confusion[p.expected][p.predicted] ?? 0) + 1;
  }
  const recall = Object.create(null);
  for (const label of new Set(supported.map((p) => p.expected))) {
    const clips = supported.filter((p) => p.expected === label);
    recall[label] = clips.filter((p) => p.predicted === label).length / clips.length;
  }
  return {
    evaluation: 'same-signer, same-session held-out repetitions',
    note: 'Disjoint complete repetitions from the instructor session. This is not independent-signer evaluation or evidence of generalization. Similarity is not probability. Source times must remain absolute for the overlap audit.',
    trainingTemplates: training.templates.length,
    suppliedTestClips: testing.templates.length,
    evaluatedClips: predictions.length,
    testSourceVideos: new Set(predictions.map((p) => recordingName(p.source))).size,
    clipsFromTrainingSession: predictions.filter((p) => p.sameTrainingRecording).length,
    metrics: {
      supportedAccuracy: supported.length ? correct.filter((p) => p.supported).length / supported.length : null,
      acceptedPrecision: accepted.length ? accepted.filter((p) => p.predicted === p.expected).length / accepted.length : null,
      coverage: predictions.length ? accepted.length / predictions.length : null,
      unknownRejection: unknown.length ? unknown.filter((p) => p.predicted === 'none').length / unknown.length : null,
      perLabelRecall: recall,
    },
    acceptanceRule: 'Production matchSequence defaults: maxDistance 0.22, ambiguity margin 0.025, maxRatio 0.85. No calibrated probability threshold.',
    confusion, predictions, excluded,
    status: predictions.length ? 'evaluated' : 'no_nonoverlapping_test_repetitions',
  };
}

async function main() {
  const options = args(process.argv.slice(2));
  const matcher = await loadMatcher();
  const readDataset = async (path, negative = false) => {
    try {
      const raw = JSON.parse(await readFile(resolve(path), 'utf8'));
      if (negative && Array.isArray(raw.templates)) raw.templates = raw.templates.map(template => ({ ...template,
        label: template.label === 'none' ? 'expected_none' : template.label }));
      const parsed = matcher.parseTemplateDataset(JSON.stringify(raw));
      if (negative) parsed.templates.forEach(template => { if (template.label === 'expected_none') template.label = 'none'; });
      return parsed;
    }
    catch (error) { throw new Error(`${path}: ${error.message}`); }
  };
  const train = await readDataset(options.train);
  const test = await readDataset(options.test);
  if (options.negative) {
    const negative = await readDataset(options.negative, true);
    if (negative.templates.some((n) => train.templates.some((t) => t.label === n.label))) throw new Error('Negative labels must not be training classes');
    test.templates.push(...negative.templates);
  }
  if (!train.templates.length) throw new Error('Training templates are empty; no evaluation can be performed');
  if (train.templates.some((t) => !t.source?.name)) throw new Error('Every training template needs source.name so independent recordings can be enforced');
  const report = evaluateDatasets(train, test, matcher.matchSequence);
  const json = JSON.stringify(report, null, 2) + '\n';
  if (options.out) await writeFile(resolve(options.out), json);
  console.log(json);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
