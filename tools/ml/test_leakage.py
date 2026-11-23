"""Adversarial split test: changing regressions must not change fitted state."""
import argparse
import copy
import hashlib
import json
import time
from pathlib import Path

from train_temporal import calibration, digest, np, prototypes, train_model, write_json


def fit(data, seed, pretrain_epochs, finetune_epochs):
    # Consume the production training routines, including actual Adam updates.
    train = [example for example in data['examples'] if example['split'] == 'train']
    x = np.asarray([example['vectors'] for example in train], dtype=np.float32)
    labels = np.asarray([data['labels'].index(example['label']) for example in train])
    model, _, _, _ = train_model(x, labels, len(data['labels']), seed, pretrain_epochs, finetune_epochs, 12)
    centers = prototypes(model, x, labels, len(data['labels']))
    rejection = calibration(model, x, labels, centers, seed + 500)
    return model.params, centers, rejection


def main(args):
    assert 1 <= args.pretrain_epochs <= 100 and 1 <= args.finetune_epochs <= 100
    started = time.perf_counter()
    original = json.loads(args.input.read_text(encoding='utf-8'))
    changed = copy.deepcopy(original)
    altered_ids = []
    for example in changed['examples']:
        if example['split'] == 'train':
            continue
        values = np.asarray(example['vectors'], dtype=np.float64)[::-1].copy()
        for offset in (0, 64):
            # Finite but intentionally different geometry; presence stays binary.
            values[:, offset + 1:offset + 64] *= -2.5
        example['vectors'] = values.tolist()
        previous = original['labels'].index(example['label']) if example['label'] in original['labels'] else -1
        example['label'] = original['labels'][(previous + 1) % len(original['labels'])]
        altered_ids.append(example['id'])
    first_train = [example for example in original['examples'] if example['split'] == 'train']
    second_train = [example for example in changed['examples'] if example['split'] == 'train']
    assert first_train == second_train
    assert digest(original) != digest(changed)
    for first, second in zip(original['examples'], changed['examples']):
        if first['split'] != 'train':
            assert first['label'] != second['label'] and first['vectors'] != second['vectors']
    first_params, first_centers, first_rejection = fit(original, args.seed, args.pretrain_epochs, args.finetune_epochs)
    second_params, second_centers, second_rejection = fit(changed, args.seed, args.pretrain_epochs, args.finetune_epochs)
    comparisons = {}
    for name in first_params:
        assert np.array_equal(first_params[name], second_params[name]), f'Non-training data changed parameter: {name}'
        comparisons[name] = {'equal': True, 'max_absolute_difference': float(np.max(np.abs(first_params[name] - second_params[name]))),
            'sha256': hashlib.sha256(first_params[name].tobytes()).hexdigest()}
    assert np.array_equal(first_centers, second_centers)
    assert first_rejection == second_rejection
    report = {'passed': True, 'seed': args.seed, 'pretrain_epochs': args.pretrain_epochs,
        'finetune_epochs': args.finetune_epochs, 'modified_nontraining_ids': altered_ids,
        'modified_fields': ['vectors', 'label'], 'training_data_identical': True,
        'training_partition_sha256': digest(first_train), 'original_complete_data_sha256': digest(original),
        'changed_complete_data_sha256': digest(changed), 'parameter_comparisons': comparisons,
        'prototypes_identical': True, 'calibration_identical': True, 'calibration': first_rejection,
        'predictions_called_before_comparison': False,
        'scope': 'Actual two-stage final fitting and train-only calibration repeated after adversarial regression changes. LOTO refits not repeated; they consume only the unchanged training partition. This is a leakage regression test, not recognition accuracy.',
        'seconds': time.perf_counter() - started}
    if args.report:
        write_json(args.report, report)
    print(json.dumps(report))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('private-video-work/training-v2/normalized-greetings.json'))
    parser.add_argument('--report', type=Path, default=Path('private-video-work/training-v2/temporal-candidate/leakage-test.json'))
    parser.add_argument('--seed', type=int, default=20261123)
    parser.add_argument('--pretrain-epochs', type=int, default=40)
    parser.add_argument('--finetune-epochs', type=int, default=60)
    main(parser.parse_args())
