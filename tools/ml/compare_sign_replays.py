"""Pair two prior replay reports by immutable clip hash, with explicit caveats."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def compare(lingora: dict, external: dict) -> dict:
    reference = {row['id']: row for row in lingora['liveCases']}
    comparisons = []
    for row in external['cases']:
        other = reference.get(row['id'])
        if other is None or other['sha256'] != row['media_sha256']:
            raise ValueError(f'Missing or mismatched paired clip: {row["id"]}')
        if other['expected'] != row['expected_lingora']:
            raise ValueError(f'Mismatched annotation: {row["id"]}')
        comparisons.append({'id': row['id'], 'expected_lingora': other['expected'],
                            'lingora': {'label': other['predicted'], 'reason': other['result'].get('reason'),
                                        'captured_frames': other.get('capturedFrames')},
                            'uzslr': {'windows': len(row['predictions']),
                                      'top_labels': [p['top3'][0]['label'] for p in row['predictions']],
                                      'both_hands_fraction': row['coverage']['both']}})
    return {'protocol': 'paired-source-videos-not-paired-frames',
            'lingora_model_sha256': lingora.get('runtime', {}).get('productionBundleSha256'),
            'uzslr_checkpoint_sha256': external['checkpoint_sha256'],
            'limitations': ['Same source clips but different tracking, timing and frame selections.',
                            'Regression clips share signer/session with model development.',
                            'UzSLR has 50 different labels, requires both hands and emits a closed-set prediction.',
                            'Cross-model label equivalence and independent sign-language semantics are not established.'],
            'cases': comparisons}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--lingora', type=Path, default=ROOT / 'private-video-work/benchmark-v1/capture-timing-v2/live-results.json')
    parser.add_argument('--uzslr', type=Path, default=ROOT / 'private-video-work/benchmark-v1/uzslr-stream.json')
    parser.add_argument('--output', type=Path, default=ROOT / 'private-video-work/benchmark-v1/paired-replays.json')
    args = parser.parse_args()
    result = compare(json.loads(args.lingora.read_text(encoding='utf-8')), json.loads(args.uzslr.read_text(encoding='utf-8')))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'paired_clips': len(result['cases']), 'cases': result['cases']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
