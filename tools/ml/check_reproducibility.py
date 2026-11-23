"""Compare independent deterministic training runs, excluding wall-clock timings."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('first', type=Path)
parser.add_argument('second', type=Path)
parser.add_argument('--report', type=Path)
args = parser.parse_args()
checks = {}
for filename in ('candidate-model.json', 'pretrained-probe.json', 'pretrained-checkpoint.npz', 'finetuned-checkpoint.npz'):
    first = hashlib.sha256((args.first / filename).read_bytes()).hexdigest()
    second = hashlib.sha256((args.second / filename).read_bytes()).hexdigest()
    assert first == second, f'Independent runs differ: {filename}'
    checks[filename] = {'identical_bytes': True, 'sha256': first}
first = json.loads((args.first / 'training-report.json').read_text(encoding='utf-8'))
second = json.loads((args.second / 'training-report.json').read_text(encoding='utf-8'))
for key in ('histories', 'baseline', 'pretrained_probe', 'candidate', 'final_rejection'):
    assert first[key] == second[key], f'Determinism failed for {key}'
    checks[key] = {'identical_values': True}
report = {'passed': True, 'seed': first['seed'], 'checks': checks,
          'scope': 'Same input/seed/backend on this CPU; not cross-platform numerical equivalence.'}
if args.report:
    args.report.write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
