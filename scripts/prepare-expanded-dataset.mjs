// Local source adapters for the reviewed November 2026 corpus expansion.
// Requires the private lesson, dictionary and round-video extraction packages.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { buildFromPlan, sliceReviewedReference } from './build-sign-dataset.mjs';

const root = resolve('private-video-work');
const expansion = resolve(root, 'dataset-expansion');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const sources = (await read(resolve(root, 'sources.json'))).sources;
const sourceMap = new Map(sources.map(source => [source.id, source]));
const groups = [];
async function add(file, defaults, samples) {
  const bytes = await readFile(file);
  const raw = JSON.parse(bytes);
  const ids = new Set(samples.map(s => s.id));
  if (raw.templates.some(t => !ids.has(t.id))) throw new Error(`Missing reviewed metadata in ${file}`);
  groups.push({ file: relative(expansion, file).replaceAll('\\', '/'), sha256: hash(bytes), defaults, samples });
}
const role = value => value === 'heldout' ? 'regression' : value;
const instructor = 'munisa-kadirova-lesson-instructor';
function lessonRow(segment, newPerformance) {
  const source = sourceMap.get(segment.source_id ?? 'source_04');
  if (!source) throw new Error(`Unknown lesson source: ${segment.source_id}`);
  return { id: segment.id, expectedLabel: segment.label, split: role(segment.role), labelUz: segment.label_uz,
    labelEvidence: segment.label_evidence, recordingId: source.id === 'source_01' ? 'source_04' : source.id,
    recordingSha256: source.sha256, signerId: instructor,
    sessionId: source.id === 'source_04' ? 'tanishuv-lesson-instructor-session-1' : `${source.id}-instructor-session-1`,
    newPerformance, labelReview: 'caption-and-complete-movement-reviewed',
    sourceWindowSeconds: [segment.start_s, segment.end_s], reuseStatus: 'unverified-private-research' };
}
for (const spec of [
  { review: 'greeting-review.json', directory: 'tracking-v1', prefix: 'greeting-', splits: ['train', 'heldout', 'negative'] },
  { review: 'additional-vocabulary/review.json', directory: 'additional-vocabulary', prefix: '', splits: ['train', 'heldout'] },
]) {
  const review = await read(resolve(root, spec.review));
  for (const split of spec.splits) await add(resolve(root, spec.directory, `${spec.prefix}templates-${split}.json`),
    { kind: 'word', split: role(split), evidenceFile: spec.review },
    review.segments.filter(s => s.role === split).map(s => lessonRow(s, false)));
}
const lessonReview = await read(resolve(expansion, 'lessons/review.json'));
for (const split of ['train', 'heldout']) await add(resolve(expansion, `lessons/templates-${split}.json`),
  { kind: 'word', split: role(split), evidenceFile: 'dataset-expansion/lessons/review.json' },
  lessonReview.segments.filter(s => s.role === split).map(s => lessonRow(s, true)));

const round = await read(resolve(expansion, 'round/manifest.json'));
await add(resolve(expansion, 'round/templates-train.json'), { kind: 'phrase', split: 'train',
  recordingId: round.source_id, recordingSha256: round.source.sha256, sessionId: round.source_id,
  signerId: 'round-source-signer-01', evaluationPolicy: 'train-only', newPerformance: false,
  evidenceFile: 'dataset-expansion/round/manifest.json', labelReview: 'script-aligned-signed-meaning-unverified',
  reuseStatus: 'local-use-authorized' }, round.samples.map(sample => ({ id: sample.sample_id,
    expectedLabel: sample.label, labelUz: sample.text_uz, labelEvidence: 'Existing user script plus audio/visual phrase alignment; specialist sign meaning and exact boundaries unverified.' })));

const internet = await read(resolve(expansion, 'internet/catalog.json'));
const crops = await read(resolve(expansion, 'internet/crop-manifest.json'));
const dictionaryTemplates = await read(resolve(expansion, 'internet/templates-train.json'));
const extraction = await read(resolve(expansion, 'internet/extraction-report.json'));
let boundaryBytes;
try { boundaryBytes = await readFile(resolve(expansion, 'dictionary-boundaries/review.json')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const boundaryReview = boundaryBytes ? JSON.parse(boundaryBytes) : null;
const dictionaryRows = [], preparedDictionary = [];
for (const template of dictionaryTemplates.templates) {
  const crop = crops.clips.find(c => c.id === template.id || c.label_id === template.label);
  const entry = internet.entries.find(e => e.id === crop?.id);
  if (!crop || !entry) throw new Error(`Missing dictionary provenance: ${template.id}`);
  const metadata = { id: template.id, expectedLabel: crop.label_id, recordingId: entry.id, recordingSha256: entry.sha256,
    sessionId: `${entry.id}-session-unverified`, signerId: 'unverified-do-not-count-as-new-signer',
    labelUz: entry.original_label, labelEvidence: 'Dictionary lexical heading and visible Uzbek video caption match; specialist semantic review pending.',
    labelReview: 'source-caption-reviewed-specialist-pending', sourceUrl: entry.source_url, mediaUrl: entry.media_url,
    crop: { xywh: crop.crop_xywh, sha256: crop.cropped_sha256, method: crops.method },
    sourceWindowSeconds: [crop.source_start_s, crop.source_end_s],
    limitation: 'One full dictionary clip, often two motions plus neutral pause. Not an isolated-performance or independent test clip.',
    trackingDelegate: extraction.clips.find(c => c.id === entry.id)?.trackingDelegate,
    rawExtractionSha256: hash(await readFile(resolve(expansion, 'internet/templates-train.json'))),
    reuseStatus: internet.source.reuse_status };
  const reviewed = boundaryReview?.entries.find(e => e.id === entry.id);
  if (reviewed) {
    if (reviewed.source_sha256 !== entry.sha256) throw new Error(`Reviewed boundary source changed: ${entry.id}`);
    const demonstrations = reviewed.demonstrations.filter(d => d.reviewed === true && d.role === 'train');
    const slices = sliceReviewedReference(template, demonstrations);
    if (!slices.length) throw new Error(`No approved complete demonstrations: ${entry.id}`);
    for (let i = 0; i < slices.length; i++) {
      preparedDictionary.push(slices[i]);
      dictionaryRows.push({ ...metadata, id: slices[i].id, sourceWindowSeconds: [demonstrations[i].start_s, demonstrations[i].end_s],
        boundaryReviewSha256: hash(boundaryBytes), boundaryEvidence: demonstrations[i],
        limitation: 'Single visually reviewed demonstration. Same-recording repetitions stay training only; specialist semantic validation pending.',
        countUnit: 'reviewed-dictionary-demonstration', extractionLineage: 'Real frames sliced from continuous production VIDEO extraction; timestamps and missing detections preserved.' });
    }
  } else { preparedDictionary.push(template); dictionaryRows.push(metadata); }
}
const preparedDictionaryFile = resolve(expansion, 'internet/templates-reviewed.json');
await writeFile(preparedDictionaryFile, JSON.stringify({ format: 'lingora-motion-templates', version: 1, templates: preparedDictionary }));
await add(preparedDictionaryFile, { kind: 'word', split: 'train',
  evaluationPolicy: 'train-only', newPerformance: true, countUnit: 'dictionary-recording-reference',
  evidenceFile: 'dataset-expansion/internet/crop-manifest.json' }, dictionaryRows);

// Verify the original source recordings as well as extraction files before assembly.
const verified = new Set();
for (const source of [sourceMap.get('source_03'), sourceMap.get('source_04'),
  { video: round.source.path, sha256: round.source.sha256 },
  ...internet.entries.filter(e => e.download_status === 'downloaded')
    .map(e => ({ video: resolve(expansion, 'internet', e.local_path), sha256: e.sha256 }))]) {
  if (verified.has(source.sha256)) continue;
  if (hash(await readFile(source.video)) !== source.sha256) throw new Error(`Source recording changed: ${source.video}`);
  verified.add(source.sha256);
}
for (const crop of crops.clips) {
  if (hash(await readFile(resolve(expansion, 'internet', crop.cropped_path))) !== crop.cropped_sha256)
    throw new Error(`Derived crop changed: ${crop.id}`);
}
const planPath = resolve(expansion, 'assembly-plan.json');
await writeFile(planPath, JSON.stringify({ format: 'lingora-corpus-plan-v1', groups }, null, 2) + '\n');
const catalog = await buildFromPlan(planPath, resolve(expansion, 'combined'));
const s = catalog.summary;
await writeFile(resolve(expansion, 'combined/README.md'), `# Reviewed private Uzbek sign corpus\n\n`
  + `${s.accepted} accepted samples: ${s.training} training, ${s.regression} same-session regression, ${s.negative} negative evaluation clips.\n\n`
  + `${s.wordLabels} lexical labels and ${s.phraseLabels} existing whole-script phrases. ${s.newReferences} newly reviewed references; zero synthetic examples.\n\n`
  + `Read catalog.json for original Uzbek glosses, recording/session identity, reviewed source windows, tracking coverage, hashes and boundary warnings.\n\n`
  + `word-train.json and phrase-train.json are separate recognition scopes. Dictionary repeats are training only. Neither the dictionary nor the round recording supplies independent validation.\n\n`
  + `Run node scripts/evaluate-expanded-dataset.mjs from the repository root to regenerate the private candidate and evaluation.json. New labels are not enabled in the website automatically.\n\n`
  + `Rebuild with npm run dataset:assemble. Source videos, crops and landmarks stay private; specialist semantic validation and source reuse permissions remain unresolved.\n`);
console.log(JSON.stringify(catalog.summary, null, 2));
