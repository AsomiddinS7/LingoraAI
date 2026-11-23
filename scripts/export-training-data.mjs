// Export production features and split provenance for offline candidate training.
// Regression samples are already inspected; no new-signer accuracy is implied.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadMatcher } from './evaluate-motion.mjs';
import { recordingName } from './model-provenance.mjs';
export { recordingName } from './model-provenance.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export function auditSplits(examples) {
  const overlaps = [], duplicates = [];
  for (let i = 0; i < examples.length; i++) for (let j = i + 1; j < examples.length; j++) {
    const a = examples[i], b = examples[j];
    if (a.id === b.id) throw new Error(`Duplicate example ID: ${a.id}`);
    if (a.split !== b.split && a.geometry_sha256 === b.geometry_sha256) duplicates.push([a.id, b.id]);
    if (a.split !== b.split && a.source_key === b.source_key
      && a.source_start_ms <= b.source_end_ms && a.source_end_ms >= b.source_start_ms) overlaps.push([a.id, b.id]);
  }
  return { retained_window_overlaps: overlaps, cross_split_geometry_duplicates: duplicates };
}

export async function exportTrainingData(output = 'private-video-work/training-v2/normalized-greetings.json') {
  const matcher = await loadMatcher();
  const runtime = JSON.parse(await readFile('private-video-work/tracking-v1/runtime.json', 'utf8'));
  const reviewed = JSON.parse(await readFile('private-video-work/greeting-review.json', 'utf8'));
  const source = resolve('../lingora-video-tools-v0.1/video_2026-11-17_18-25-35.mp4');
  const sourceHash = hash(await readFile(source));
  const datasets = {};
  for (const [split, role] of [['train', 'train'], ['regression', 'heldout'], ['unknown_regression', 'negative']]) {
    const raw = JSON.parse(await readFile(`private-video-work/tracking-v1/greeting-templates-${role}.json`, 'utf8'));
    datasets[split] = matcher.parseTemplateDataset(JSON.stringify({ ...raw,
      templates: raw.templates.map(template => ({ ...template, label: template.label === 'none' ? 'expected_none' : template.label })),
    })).templates;
  }
  const examples = [];
  for (const [split, templates] of Object.entries(datasets)) for (const template of templates) {
    if (recordingName(template.source?.name ?? '') !== basename(source)) throw new Error('Unresolved recording identity');
    const normalized = matcher.normalizeSequence(template.frames);
    if (!normalized) throw new Error(`Insufficient tracking: ${template.id}`);
    const window = reviewed.segments.find(segment => segment.id === template.id);
    if (!window?.reviewed || !window.label_evidence) throw new Error(`Missing reviewed label evidence: ${template.id}`);
    examples.push({ id: template.id, label: split === 'unknown_regression' ? 'none' : template.label, split,
      source_key: sourceHash, session_key: 'greeting-lesson-single-instructor-session',
      source_start_ms: template.frames[0].t, source_end_ms: template.frames.at(-1).t,
      tracking_context_start_ms: Math.max(0, window.start_s * 1000 - 500),
      raw_template_sha256: hash(JSON.stringify(template)),
      geometry_sha256: hash(JSON.stringify(template.frames.map(({ t: _time, ...geometry }) => geometry))),
      ...normalized, baseline: matcher.matchSequence(template.frames, datasets.train),
    });
  }
  const audit = auditSplits(examples);
  if (audit.retained_window_overlaps.length || audit.cross_split_geometry_duplicates.length) throw new Error('Cross-split leakage detected');
  const result = { format: 'lingora-normalized-training-v1', feature_version: 'two-hand-body-v2',
    frames: 32, features: 128, labels: [...new Set(datasets.train.map(template => template.label))].sort(),
    provenance: { source_sha256: sourceHash, tracker_profile: runtime.trackingProfile,
      feature_code_sha256: hash(await readFile('src/ml/sequence.ts')),
      split_before_augmentation: true, regression_previously_inspected: true,
      scope: 'One signer/session; regression is not an untouched test or new-signer evaluation.',
      context_note: 'Only retained feature windows are audited for overlap. Fixed pretrained VIDEO tracking uses 0.5s preceding context; a boundary frame can be shared.',
    }, split_audit: audit, examples };
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, JSON.stringify(result));
  console.log(JSON.stringify({ output, splits: Object.fromEntries(Object.entries(datasets).map(([split, templates]) => [split, templates.length])), audit }));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  exportTrainingData(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
