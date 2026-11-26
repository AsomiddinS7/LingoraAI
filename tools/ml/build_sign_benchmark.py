"""Inventory existing sign windows without pretending repetitions are new signers.

Outputs stay private. Nothing in this inventory is an untouched promotion test:
the source material has already been used during development.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'private-video-work/training-expanded-v3/normalized-words.json'
MEDIA = ROOT / 'private-video-work/training-expanded-v3/live-media/manifest.json'
PHRASES = ROOT / 'private-video-work/full-speech/speech-review.json'
DEFAULT_OUTPUT = ROOT / 'private-video-work/benchmark-v1/inventory.json'


def session_group(source: str, session: str | None) -> str:
    # Distinct dictionary files have unverified people/sessions, so grouping
    # them separately could leak the same signer across a purported split.
    if source.startswith('uzsl-') or not session:
        return 'dictionary-or-signer-identity-unverified'
    return session


def audit_split(records: list[dict], assignments: dict[str, str], require_verified_signers: bool = True) -> list[str]:
    """Report leaks; the caller must never promote a split with any issue."""
    grouped: dict[tuple[str, str], set[str]] = defaultdict(set)
    issues = set()
    for row in records:
        split = assignments.get(row['id'])
        if split not in {'train', 'validation', 'test'}:
            issues.add(f'missing_or_invalid_split:{row["id"]}')
            continue
        if split == 'test' and row.get('evaluation_status') != 'untouched_final_test':
            issues.add(f'test_not_untouched:{row["id"]}')
        for field in ('session_group', 'source_sha256'):
            if row.get(field):
                grouped[(field, row[field])].add(split)
        signer = row.get('signer_identity')
        if not signer or signer == 'unverified':
            if require_verified_signers:
                issues.add('signer_identity_unverified')
        else:
            grouped[('signer_identity', signer)].add(split)
    for (field, value), splits in grouped.items():
        if len(splits) > 1:
            issues.add(f'cross_split_{field}:{value}')
    return sorted(issues)


def build_inventory(dataset: dict, media: dict, phrases: dict) -> dict:
    windows = {}
    for row in dataset['examples']:
        source = row['source_key']
        start, end = round(float(row['source_start_ms']) / 1000, 3), round(float(row['source_end_ms']) / 1000, 3)
        if not (0 <= start < end):
            raise ValueError('Invalid source interval')
        key = (source, start, end)
        entry = windows.setdefault(key, {
            'id': row['base_reference_id'], 'label': row['label'], 'label_uz': row.get('label_uz'),
            'source_id': source, 'source_sha256': row.get('source_sha256'),
            'start_s': start, 'end_s': end,
            'session_group': session_group(source, row.get('session_key')),
            'signer_identity': 'unverified', 'semantic_review': 'not_independently_verified',
            'prior_roles': [], 'views': [], 'media': [],
            'evaluation_status': 'development_only_previously_used',
        })
        if entry['label'] != row['label'] or entry['source_sha256'] != row.get('source_sha256'):
            raise ValueError(f'Conflicting annotations for {key}')
        if row['split'] not in entry['prior_roles']:
            entry['prior_roles'].append(row['split'])
        entry['views'].append({'id': row['id'], 'augmentation': row.get('augmentation_kind')})

    unmatched = []
    phrase_media = defaultdict(list)
    for case in media['cases']:
        if case['scope'] == 'phrase':
            phrase_media[case['expected']].append(case['file'])
            continue
        start, end = case['sourceWindowSeconds']
        key = (case['sourceRecordingId'], round(float(start), 3), round(float(end), 3))
        if key not in windows:
            unmatched.append(case['id'])
        else:
            windows[key]['media'].append({'id': case['id'], 'file': case['file'], 'scenario': case['scenario']})

    rows = list(windows.values())
    for item in phrases['segments']:
        rows.append({
            'id': item['id'], 'label': item['label'], 'source_id': 'round-video',
            'start_s': item['start_s'], 'end_s': item['end_s'],
            'session_group': 'round-video-session', 'signer_identity': 'unverified',
            'semantic_review': 'audio_aligned_only_not_signer_verified',
            'prior_roles': [item['role']], 'views': [],
            'media': [{'file': path, 'scenario': 'nominal'} for path in phrase_media[item['label']]],
            'evaluation_status': 'source_replay_only',
        })
    sessions = defaultdict(lambda: {'labels': set(), 'prior_roles': set()})
    for row in rows:
        group = sessions[row['session_group']]
        group['labels'].add(row['label']); group['prior_roles'].update(row['prior_roles'])
    session_report = {name: {'labels': sorted(data['labels']), 'prior_roles': sorted(data['prior_roles'])}
                      for name, data in sessions.items()}
    return {
        'format': 'lingora-benchmark-inventory-v1',
        'limitations': [
            'Previously used development recordings; no untouched final test.',
            'Signer identities and cross-session independence are not verified.',
            'Dictionary sources with unknown identities are grouped conservatively.',
            'Phrase labels align to audio, not independently verified sign semantics.',
            'Source reuse and public distribution rights are not established.',
        ],
        'records': rows, 'session_groups': session_report, 'unmatched_media_case_ids': unmatched,
        'split_status': 'not_assigned: previously used footage and unverified signer identities',
        'summary': {'physical_windows': len(windows), 'phrase_windows': len(phrases['segments']),
                    'labels': len({r['label'] for r in windows.values()}),
                    'source_videos': len({r['source_id'] for r in windows.values()}),
                    'session_groups': len(sessions), 'unmatched_media_cases': len(unmatched),
                    'legacy_roles': dict(Counter(role for r in rows for role in r['prior_roles']))},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    sources = [DATA, MEDIA, PHRASES]
    inventory = build_inventory(*(json.loads(p.read_text(encoding='utf-8')) for p in sources))
    inventory['input_sha256'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(inventory['summary'], ensure_ascii=False))


if __name__ == '__main__':
    main()
