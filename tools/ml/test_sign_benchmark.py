import unittest

from build_sign_benchmark import audit_split, build_inventory, session_group
from compare_sign_replays import compare
from compare_three_sign_models import compare_three
from uzslr_web_gate import UzslrWebGate


class InventoryTests(unittest.TestCase):
    def test_augmented_views_share_one_physical_window_and_unknown_identity_is_grouped(self):
        common = {'source_key': 'uzsl-1', 'source_sha256': 'same', 'session_key': 'a-session-unverified',
                  'source_start_ms': 500, 'source_end_ms': 1500, 'base_reference_id': 'word-1',
                  'label': 'hello', 'label_uz': 'Salom', 'split': 'train'}
        dataset = {'examples': [dict(common, id='original', augmentation_kind='nominal'),
                                dict(common, id='variant', augmentation_kind='dim')]}
        media = {'cases': [{'id': 'replay', 'scope': 'word', 'sourceRecordingId': 'uzsl-1',
                            'sourceWindowSeconds': [.5, 1.5], 'file': 'x.mp4', 'scenario': 'nominal'}]}
        result = build_inventory(dataset, media, {'segments': []})
        self.assertEqual(result['summary']['physical_windows'], 1)
        self.assertEqual(len(result['records'][0]['views']), 2)
        self.assertEqual(result['summary']['unmatched_media_cases'], 0)
        self.assertEqual(result['records'][0]['session_group'], session_group('uzsl-another', 'different-unverified'))
        self.assertEqual(result['records'][0]['evaluation_status'], 'development_only_previously_used')

    def test_conflicting_label_for_same_window_fails(self):
        row = {'source_key': 'source', 'source_sha256': 'hash', 'session_key': 'session',
               'source_start_ms': 0, 'source_end_ms': 1000, 'base_reference_id': 'x',
               'label': 'hello', 'split': 'train', 'id': 'x'}
        with self.assertRaises(ValueError):
            build_inventory({'examples': [row, dict(row, label='goodbye')]}, {'cases': []}, {'segments': []})

    def test_split_audit_detects_session_and_source_leaks_and_unknown_signers(self):
        rows = [{'id': 'a', 'session_group': 's', 'source_sha256': 'same', 'signer_identity': 'unverified'},
                {'id': 'b', 'session_group': 's', 'source_sha256': 'same', 'signer_identity': 'unverified'}]
        issues = audit_split(rows, {'a': 'train', 'b': 'test'})
        self.assertIn('signer_identity_unverified', issues)
        self.assertIn('cross_split_session_group:s', issues)
        self.assertIn('cross_split_source_sha256:same', issues)
        self.assertIn('test_not_untouched:b', issues)
        self.assertEqual(audit_split(rows, {'a': 'train', 'b': 'train'}, require_verified_signers=False), [])

    def test_replay_pairing_rejects_different_video_and_reports_raw_predictions(self):
        lingora = {'liveCases': [{'id': 'a', 'sha256': 'one', 'expected': 'none', 'predicted': 'none',
                                  'result': {'reason': 'insufficient_motion'}}]}
        other = {'checkpoint_sha256': 'weights', 'cases': [{'id': 'a', 'media_sha256': 'two',
                 'expected_lingora': 'none', 'predictions': [], 'coverage': {'both': 1}}]}
        with self.assertRaises(ValueError):
            compare(lingora, other)
        other['cases'][0]['media_sha256'] = 'one'
        other['cases'][0]['predictions'] = [{'top3': [{'label': 'bahor'}]}]
        paired = compare(lingora, other)
        self.assertEqual(paired['cases'][0]['uzslr']['top_labels'], ['bahor'])
        self.assertEqual(paired['cases'][0]['lingora']['label'], 'none')

    def test_upstream_gate_requires_both_hands_then_exactly_32_frames(self):
        gate = UzslrWebGate()
        for i in range(5):
            self.assertIsNone(gate.push(i, False))
        for i in range(31):
            self.assertIsNone(gate.push(i, True))
        self.assertEqual(gate.push(31, True), list(range(32)))
        self.assertIsNone(gate.push(32, True))

    def test_upstream_gate_clears_after_six_missing_frames(self):
        gate = UzslrWebGate(buffer_size=10, missing_tolerance=5)
        gate.push('start', True)
        for i in range(5):
            self.assertIsNone(gate.push(i, False))
        self.assertEqual(len(gate.frames), 6)
        self.assertIsNone(gate.push('sixth', False))
        self.assertFalse(gate.active)
        self.assertEqual(gate.frames, [])

    def test_three_model_comparison_requires_identical_video_and_counts_negative_outputs(self):
        lingora = {'liveCases': [{'id': 'a', 'sha256': 'one', 'expected': 'none', 'predicted': 'none', 'result': {}}]}
        uzslr = {'checkpoint_sha256': 'u', 'cases': [{'id': 'a', 'media_sha256': 'one', 'expected_lingora': 'none',
                 'predictions': [], 'coverage': {'both': 1}}]}
        unisign = {'checkpoint_sha256': 'v', 'limitations': [], 'cases': [{'id': 'a', 'video_sha256': 'bad',
                   'expected_lingora': 'none', 'output': 'A sentence', 'inference_s': 1}]}
        with self.assertRaises(ValueError):
            compare_three(lingora, uzslr, unisign)
        unisign['cases'][0]['video_sha256'] = 'one'
        result = compare_three(lingora, uzslr, unisign)
        self.assertEqual(result['unisign_negative_clips'], 1)
        self.assertEqual(result['unisign_nonempty_negative_outputs'], 1)


if __name__ == '__main__':
    unittest.main()
