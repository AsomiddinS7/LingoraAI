import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSplits, recordingName } from '../scripts/export-training-data.mjs';

test('source identity strips interval suffixes rather than pretending clips are different recordings', () => {
  assert.equal(recordingName('C:\\video\\lesson.mp4 [1.25-3s]'), 'lesson.mp4');
  const clips = [
    { id: 'train', split: 'train', source_key: 'same-sha', source_start_ms: 1000, source_end_ms: 3000, geometry_sha256: 'a' },
    { id: 'test', split: 'regression', source_key: 'same-sha', source_start_ms: 2500, source_end_ms: 4000, geometry_sha256: 'b' },
  ];
  assert.deepEqual(auditSplits(clips).retained_window_overlaps, [['train', 'test']]);
});
test('shifted duplicate geometry is rejected across train/regression even with different source names', () => {
  const clips = [
    { id: 'a', split: 'train', source_key: 'first', source_start_ms: 0, source_end_ms: 1000, geometry_sha256: 'same' },
    { id: 'b', split: 'regression', source_key: 'second', source_start_ms: 5000, source_end_ms: 6000, geometry_sha256: 'same' },
  ];
  assert.deepEqual(auditSplits(clips).cross_split_geometry_duplicates, [['a', 'b']]);
  assert.deepEqual(auditSplits(clips).retained_window_overlaps, []);
});
