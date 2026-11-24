// Assemble reviewed private references. This never changes the deployed model.
// node scripts/build-sign-dataset.mjs --plan PRIVATE_PLAN.json --out PRIVATE_DIRECTORY
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMatcher } from './evaluate-motion.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const geometryHash = frames => hash(JSON.stringify(frames.map(({ t: _t, ...geometry }) => geometry)));
const dataset = templates => ({ format: 'lingora-motion-templates', version: 1, templates });
const roles = ['train', 'regression', 'negative'];

/** Slice real observations only; keep absolute source timestamps and missing hands. */
export function sliceReviewedReference(template, demonstrations) {
  return demonstrations.filter(d => d.reviewed === true && d.role === 'train').map((d, index) => {
    if (!Number.isFinite(d.start_s) || !Number.isFinite(d.end_s) || d.end_s <= d.start_s)
      throw new Error(`Invalid reviewed boundaries: ${template.id}`);
    const frames = template.frames.filter(f => f.t >= d.start_s * 1000 - .01 && f.t <= d.end_s * 1000 + .01);
    if (frames.length < 2) throw new Error(`Reviewed performance has no sampled movement: ${template.id}`);
    return { ...template, id: `${template.id}-take-${index + 1}`, frames,
      source: { ...template.source, name: `${template.source.name} [${d.start_s}-${d.end_s}s]` } };
  });
}

/** Input clips have already passed the production raw-template parser. */
export function assembleDataset(samples, normalizeSequence) {
  const accepted = [], quarantine = [], warnings = [];
  const reject = (sample, reason, relatedId) => quarantine.push({ id: sample.template.id, reason, relatedId });
  // References win over evaluation copies, regardless of input file order.
  for (const sample of [...samples].sort((a, b) => roles.indexOf(a.split) - roles.indexOf(b.split))) {
    const { template } = sample;
    if (!roles.includes(sample.split) || !['word', 'phrase'].includes(sample.kind)) { reject(sample, 'invalid_kind_or_split'); continue; }
    if (!sample.recordingId || !/^[a-f0-9]{64}$/i.test(sample.recordingSha256 ?? '')
      || !sample.sessionId || !sample.labelUz || !sample.labelEvidence || !template.source?.name) {
      reject(sample, 'missing_provenance_or_label_evidence'); continue;
    }
    if (!sample.expectedLabel || sample.expectedLabel !== template.label) { reject(sample, 'label_differs_from_review'); continue; }
    if (sample.evaluationPolicy === 'train-only' && sample.split !== 'train') { reject(sample, 'source_is_training_reference_only'); continue; }
    if ((sample.split === 'negative') !== (template.label === 'none')) { reject(sample, 'negative_label_split_mismatch'); continue; }
    const frames = template.frames;
    const normalized = normalizeSequence(frames);
    if (!normalized && sample.split !== 'negative') { reject(sample, 'insufficient_production_tracking'); continue; }
    const startMs = frames[0].t, endMs = frames.at(-1).t;
    if (sample.sourceWindowSeconds && (startMs < sample.sourceWindowSeconds[0] * 1000 - 1
      || endMs > sample.sourceWindowSeconds[1] * 1000 + 1)) { reject(sample, 'frames_outside_reviewed_source_interval'); continue; }
    const fingerprint = geometryHash(frames);
    const duplicate = accepted.find(other => other.geometrySha256 === fingerprint || other.template.id === template.id);
    if (duplicate) { reject(sample, 'duplicate_id_or_landmark_geometry', duplicate.template.id); continue; }
    // Canonical IDs also catch alternate encodes; hashes catch aliases/renames.
    const overlaps = accepted.filter(other => (other.recordingId === sample.recordingId
      || other.recordingSha256 === sample.recordingSha256)
      && startMs <= other.endMs && endMs >= other.startMs);
    const leakage = overlaps.find(other => other.split !== sample.split);
    if (leakage) { reject(sample, 'source_interval_crosses_splits', leakage.template.id); continue; }
    const wordOverlap = overlaps.find(other => other.kind === 'word' || sample.kind === 'word');
    if (wordOverlap) { reject(sample, 'overlapping_word_performance', wordOverlap.template.id); continue; }
    for (const other of overlaps) warnings.push({ id: template.id, relatedId: other.template.id,
      reason: 'same_split_phrase_boundaries_overlap', overlapMs: Math.min(endMs, other.endMs) - Math.max(startMs, other.startMs) });
    accepted.push({ ...sample, startMs, endMs, geometrySha256: fingerprint,
      frames: frames.length, anyHandCoverage: frames.filter(frame => frame.left || frame.right).length / frames.length,
      bothHandCoverage: frames.filter(frame => frame.left && frame.right).length / frames.length,
      reference: normalized?.reference ?? null });
  }
  const partitions = {};
  for (const kind of ['word', 'phrase']) for (const split of roles)
    partitions[`${kind}-${split}`] = dataset(accepted.filter(s => s.kind === kind && s.split === split).map(s => s.template));
  const labels = [...new Set(accepted.filter(s => s.split !== 'negative').map(s => s.template.label))].sort();
  const labelSummary = labels.map(label => {
    const rows = accepted.filter(s => s.template.label === label);
    const training = rows.filter(s => s.split === 'train');
    const regression = rows.filter(s => s.split === 'regression');
    return { label, labelUz: rows[0].labelUz, kind: rows[0].kind, train: training.length, regression: regression.length,
      recordings: new Set(rows.map(s => s.recordingId)).size,
      sessions: new Set(rows.map(s => s.sessionId)).size,
      regressionSharesTrainingSession: regression.some(s => training.some(t => t.sessionId === s.sessionId)),
      validation: regression.length ? 'same-session-regression-only' : 'reference-only-no-regression' };
  });
  return { partitions, catalog: { format: 'lingora-reviewed-corpus-v1',
    summary: { supplied: samples.length, accepted: accepted.length, quarantined: quarantine.length,
      wordLabels: labelSummary.filter(s => s.kind === 'word').length, phraseLabels: labelSummary.filter(s => s.kind === 'phrase').length,
      training: accepted.filter(s => s.split === 'train').length, regression: accepted.filter(s => s.split === 'regression').length,
      negative: accepted.filter(s => s.split === 'negative').length,
      newReferences: accepted.filter(s => s.newPerformance === true).length,
      independentSignerValidation: false, syntheticExamples: 0 },
    labels: labelSummary,
    samples: accepted.map(({ template, ...metadata }) => ({ ...metadata, id: template.id, label: template.label, source: template.source })),
    quarantine, warnings } };
}

export async function buildFromPlan(planPath, outPath) {
  const matcher = await loadMatcher();
  const planBytes = await readFile(planPath);
  const plan = JSON.parse(planBytes);
  const samples = [], inputs = [];
  for (const group of plan.groups) {
    const file = resolve(dirname(planPath), group.file);
    const bytes = await readFile(file);
    if (group.sha256 && hash(bytes) !== group.sha256) throw new Error(`Input hash mismatch: ${group.file}`);
    const raw = JSON.parse(bytes);
    // The production importer reserves none; only the negative evaluation adapter may use it.
    const isNegative = group.defaults?.split === 'negative';
    if (isNegative) raw.templates.forEach(t => { if (t.label === 'none') t.label = 'corpus_expected_none'; });
    const parsed = matcher.parseTemplateDataset(JSON.stringify(raw));
    if (isNegative) parsed.templates.forEach(t => { if (t.label === 'corpus_expected_none') t.label = 'none'; });
    const review = new Map(group.samples.map(row => [row.id, row]));
    for (const template of parsed.templates) samples.push({ ...group.defaults, ...review.get(template.id), template });
    inputs.push({ file: group.file, sha256: hash(bytes), templates: parsed.templates.length });
  }
  const result = assembleDataset(samples, matcher.normalizeSequence);
  // Verify output partitions remain importable at the browser's real size/count limits.
  for (const [name, value] of Object.entries(result.partitions)) if (value.templates.length && !name.endsWith('-negative'))
    matcher.parseTemplateDataset(JSON.stringify(value));
  await mkdir(outPath, { recursive: true });
  const outputs = {};
  for (const [name, value] of Object.entries(result.partitions)) {
    const content = JSON.stringify(value);
    outputs[`${name}.json`] = { sha256: hash(content), templates: value.templates.length, bytes: Buffer.byteLength(content) };
    await writeFile(resolve(outPath, `${name}.json`), content);
  }
  result.catalog.inputs = inputs;
  result.catalog.planSha256 = hash(planBytes);
  result.catalog.outputs = outputs;
  await writeFile(resolve(outPath, 'catalog.json'), JSON.stringify(result.catalog, null, 2) + '\n');
  return result.catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , flag, plan, outFlag, out] = process.argv;
  if (flag !== '--plan' || outFlag !== '--out' || !plan || !out) throw new Error('Usage: --plan PRIVATE_PLAN.json --out PRIVATE_DIRECTORY');
  buildFromPlan(resolve(plan), resolve(out)).then(catalog => console.log(JSON.stringify(catalog.summary, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
