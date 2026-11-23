import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDatasets } from '../scripts/evaluate-motion.mjs';

const clip = (id, name, start, x) => ({ id, label: 'hello', source: { name },
  frames: [{ t: start, left: [{ x, y: 0, z: 0 }], right: null }, { t: start + 1000, left: [{ x, y: 1, z: 0 }], right: null }] });
const predict = () => ({ label: 'hello', confidence: .9, distance: .02, reason: 'matched' });
test('overlapping per-clip source suffixes cannot bypass evaluation leakage checks', () => {
  const report = evaluateDatasets({ templates: [clip('a', 'lesson.mp4 [1-2s]', 1000, 0)] },
    { templates: [clip('b', 'lesson.mp4 [1.5-2.5s]', 1500, 1)] }, predict);
  assert.equal(report.evaluatedClips, 0);
  assert.equal(report.excluded[0].reason, 'source_time_interval_overlaps_training');
});
test('disjoint clips from one lesson count as one shared recording rather than new participants', () => {
  const report = evaluateDatasets({ templates: [clip('a', 'lesson.mp4 [1-2s]', 1000, 0)] },
    { templates: [clip('b', 'lesson.mp4 [3-4s]', 3000, 1), clip('c', 'lesson.mp4 [5-6s]', 5000, 2)] }, predict);
  assert.equal(report.evaluatedClips, 2);
  assert.equal(report.testSourceVideos, 1);
  assert.equal(report.clipsFromTrainingSession, 2);
});

test('accepted precision excludes correctly rejected unknown clips from its numerator', () => {
  const training = { templates: [clip('train', 'lesson.mp4', 1000, 0)] };
  const good = clip('known', 'lesson.mp4', 3000, 1);
  const rejected = { ...clip('unknown-rejected', 'lesson.mp4', 5000, 2), label: 'none' };
  const wronglyAccepted = { ...clip('unknown-accepted', 'lesson.mp4', 7000, 3), label: 'none' };
  const recognize = frames => frames[0].left[0].x === 2
    ? { label: 'none', confidence: 0, distance: 1, reason: 'too_distant' } : predict();
  const safe = evaluateDatasets(training, { templates: [good, rejected] }, recognize);
  assert.equal(safe.metrics.acceptedPrecision, 1);
  assert.equal(safe.metrics.unknownRejection, 1);
  const mixed = evaluateDatasets(training, { templates: [good, rejected, wronglyAccepted] }, recognize);
  assert.equal(mixed.metrics.acceptedPrecision, .5);
  assert.equal(mixed.metrics.unknownRejection, .5);
  const noAcceptance = evaluateDatasets(training, { templates: [rejected] }, recognize);
  assert.equal(noAcceptance.metrics.acceptedPrecision, null);
});
