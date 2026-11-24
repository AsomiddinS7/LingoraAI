import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleDataset, sliceReviewedReference } from '../scripts/build-sign-dataset.mjs';

const sample = (id, split = 'train', start = 0, extra = {}) => ({
  kind: 'word', split, expectedLabel: 'my', recordingId: 'lesson', recordingSha256: 'a'.repeat(64), sessionId: 'instructor-session',
  labelUz: 'Mening', labelEvidence: 'Reviewed caption and complete movement',
  template: { id, label: 'my', source: { name: `lesson.mp4 [${start / 1000}-${(start + 1000) / 1000}s]` },
    frames: [{ t: start, left: [{ x: start, y: 0, z: 0 }], right: null },
      { t: start + 1000, left: [{ x: start, y: 1, z: 0 }], right: null }] }, ...extra,
});
const normalize = () => ({ reference: 'body' });

test('renamed and time-shifted landmark copies cannot increase sample or regression counts', () => {
  const train = sample('a');
  const duplicate = sample('b', 'regression', 5000);
  duplicate.template.frames = train.template.frames.map(f => ({ ...f, t: f.t + 5000 }));
  const { catalog } = assembleDataset([duplicate, train], normalize);
  assert.equal(catalog.summary.accepted, 1);
  assert.equal(catalog.summary.regression, 0);
  assert.equal(catalog.quarantine[0].reason, 'duplicate_id_or_landmark_geometry');
});

test('canonical recording identity catches overlapping alternate encodes across splits', () => {
  const { catalog } = assembleDataset([sample('a'), sample('b', 'regression', 500, { recordingSha256: 'b'.repeat(64) })], normalize);
  assert.equal(catalog.quarantine[0].reason, 'source_interval_crosses_splits');
});

test('SHA identity catches renamed recordings and disjoint repetitions remain regression only', () => {
  const { catalog } = assembleDataset([sample('a'), sample('bad', 'regression', 500, { recordingId: 'renamed' }), sample('good', 'regression', 3000)], normalize);
  assert.equal(catalog.summary.regression, 1);
  assert.equal(catalog.summary.independentSignerValidation, false);
  assert.equal(catalog.labels[0].regressionSharesTrainingSession, true);
  assert.equal(catalog.quarantine[0].id, 'bad');
});

test('dictionary references cannot silently acquire a test split from a second repetition', () => {
  const { catalog } = assembleDataset([sample('dictionary', 'regression', 0, { evaluationPolicy: 'train-only' })], normalize);
  assert.equal(catalog.quarantine[0].reason, 'source_is_training_reference_only');
});

test('round phrase boundary overlap stays visible in one training group', () => {
  const a = sample('a', 'train', 0, { kind: 'phrase' });
  const b = sample('b', 'train', 500, { kind: 'phrase' });
  b.template.label = 'speech_02';
  b.expectedLabel = 'speech_02';
  const { catalog, partitions } = assembleDataset([a, b], normalize);
  assert.equal(partitions['phrase-train'].templates.length, 2);
  assert.equal(catalog.warnings[0].overlapMs, 500);
});

test('missing semantic evidence and failed positive tracking are quarantined; idle negatives remain evaluation only', () => {
  const badEvidence = sample('missing', 'train', 0, { labelEvidence: '' });
  const badTracking = sample('tracking', 'train', 3000);
  const idle = sample('idle', 'negative', 6000);
  idle.template.label = 'none';
  idle.expectedLabel = 'none';
  const { catalog, partitions } = assembleDataset([badEvidence, badTracking, idle], () => null);
  assert.equal(catalog.summary.training, 0);
  assert.equal(catalog.summary.negative, 1);
  assert.equal(partitions['word-negative'].templates[0].label, 'none');
  assert.deepEqual(catalog.quarantine.map(s => s.reason), ['missing_provenance_or_label_evidence', 'insufficient_production_tracking']);
});

test('reviewed lexical labels and absolute source windows cannot drift during assembly', () => {
  const relabeled = sample('wrong');
  relabeled.template.label = 'help';
  const rebased = sample('rebased', 'train', 0, { sourceWindowSeconds: [20, 21] });
  const { catalog } = assembleDataset([relabeled, rebased], normalize);
  assert.equal(catalog.summary.accepted, 0);
  assert.deepEqual(catalog.quarantine.map(s => s.reason), ['label_differs_from_review', 'frames_outside_reviewed_source_interval']);
});

test('reviewed slicing preserves real missing observations and absolute source times without augmentation', () => {
  const full = sample('dictionary').template;
  full.frames = [0, 1000, 2000, 3000, 4000].map(t => ({ t, left: null, right: null }));
  const slices = sliceReviewedReference(full, [
    { start_s: 1, end_s: 3, reviewed: true, role: 'train' },
    { start_s: 3, end_s: 4, reviewed: false, role: 'train' },
  ]);
  assert.equal(slices.length, 1);
  assert.deepEqual(slices[0].frames.map(f => f.t), [1000, 2000, 3000]);
  assert.equal(slices[0].frames[0].left, null);
  assert.equal(full.frames.length, 5);
});
