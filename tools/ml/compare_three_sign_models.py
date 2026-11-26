"""Pair existing private replays of Lingora, UzSLR and ASL Uni-Sign by clip hash."""
import json
from pathlib import Path

from compare_sign_replays import compare

ROOT = Path(__file__).resolve().parents[2]
BENCHMARK = ROOT / 'private-video-work/benchmark-v1'


def compare_three(lingora, uzslr, unisign):
    paired = compare(lingora, uzslr)
    baseline = {row['id']: row for row in lingora['liveCases']}
    model_rows = {row['id']: row for row in unisign['cases']}
    if len(model_rows) != len(unisign['cases']) or set(model_rows) != {row['id'] for row in paired['cases']}:
        raise ValueError('Uni-Sign and paired replay case IDs differ')
    for row in paired['cases']:
        other = model_rows[row['id']]
        original = baseline[row['id']]
        if other['video_sha256'] != original['sha256'] or other['expected_lingora'] != original['expected']:
            raise ValueError(f'Uni-Sign source or annotation mismatch: {row["id"]}')
        row['unisign_asl'] = {'text': other['output'], 'inference_s': other['inference_s']}
    unknown = [row for row in paired['cases'] if row['expected_lingora'] == 'none']
    return {'protocol': 'same-video-three-models-different-preprocessing-and-task',
            'lingora_model_sha256': paired['lingora_model_sha256'],
            'uzslr_checkpoint_sha256': paired['uzslr_checkpoint_sha256'],
            'unisign_checkpoint_sha256': unisign['checkpoint_sha256'],
            'unisign_negative_clips': len(unknown),
            'unisign_nonempty_negative_outputs': sum(bool(row['unisign_asl']['text'].strip()) for row in unknown),
            'limitations': paired['limitations'] + unisign['limitations'] + [
                'Uni-Sign generates English sentences from an ASL-trained model; automatic word-level comparison is inappropriate.',
                'The source annotations are not independent sign-language expert ground truth.'],
            'cases': paired['cases']}


def main():
    read = lambda path: json.loads(path.read_text(encoding='utf-8'))
    result = compare_three(read(BENCHMARK / 'capture-timing-v2/live-results.json'),
                           read(BENCHMARK / 'uzslr-stream.json'), read(BENCHMARK / 'unisign-cpu-results.json'))
    output = BENCHMARK / 'three-model-replays.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'paired_clips': len(result['cases']), 'unisign_negative_clips': result['unisign_negative_clips'],
                      'unisign_nonempty_negative_outputs': result['unisign_nonempty_negative_outputs']}))


if __name__ == '__main__':
    main()
