"""Adversarially change evaluation data and refit the actual skeletal model."""
from pathlib import Path
from types import SimpleNamespace
import copy
import argparse
import json
import hashlib
import numpy as np
from train_skeletal import main as fit

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,default=Path('private-video-work/training-expanded-v1'))
parser.add_argument('--seed',type=int,default=20261125)
args=parser.parse_args()
root = args.root
original = json.loads((root / 'normalized-words.json').read_text(encoding='utf-8'))
changed = copy.deepcopy(original)
altered = []
for example in changed['examples']:
    if example['split'] == 'train': continue
    vectors = np.asarray(example['vectors'])[::-1].copy()
    for hand in (0, 64): vectors[:, hand+1:hand+64] *= -2.5
    example['vectors'] = vectors.tolist()
    example['label'] = original['labels'][(original['labels'].index(example['label']) + 1) % len(original['labels'])] if example['label'] in original['labels'] else original['labels'][0]
    altered.append(example['id'])
assert [e for e in original['examples'] if e['split'] == 'train'] == [e for e in changed['examples'] if e['split'] == 'train']
folder = root / 'leakage-check'
folder.mkdir(exist_ok=True)
for name, data in [('original', original), ('modified', changed)]:
    path = folder / (name + '.json')
    path.write_text(json.dumps(data), encoding='utf-8')
    fit(SimpleNamespace(input=path, out=folder/name, seed=args.seed, augmentations=24, ridge=1., descriptor='body'))
models = [json.loads((folder/name/'candidate-model.json').read_text(encoding='utf-8')) for name in ('original','modified')]
checks = {}
for key in ('mean','scale','weight','bias','minimum_score','minimum_margin'):
    a,b = np.asarray(models[0][key]), np.asarray(models[1][key])
    error = float(np.max(np.abs(a-b)))
    assert error < 1e-12, (key,error)
    checks[key] = {'max_absolute_difference': error, 'passed': True}
assert models[0]['motion_gate'] == models[1]['motion_gate']
checks['motion_gate'] = {'identical': True, 'passed': True}
report = {'passed': True, 'altered_evaluation_examples': len(altered), 'altered_fields': ['vectors','label'],
    'training_examples_unchanged': len([e for e in original['examples'] if e['split']=='train']), 'parameters_and_calibration': checks,
    'scope': 'Actual fitting and calibration rerun after adversarial evaluation changes. Dataset hash metadata changes; fitted numerical state must not.'}
(folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
