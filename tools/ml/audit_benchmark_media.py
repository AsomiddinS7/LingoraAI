"""Verify available benchmark clips against their private manifest."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / 'private-video-work/training-expanded-v3/live-media'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'private-video-work/benchmark-v1/media-audit.json')
    args = parser.parse_args()
    manifest = json.loads((MEDIA / 'manifest.json').read_text(encoding='utf-8'))
    rows = []
    for case in manifest['cases']:
        path = MEDIA / case['file']
        row = {'id': case['id'], 'exists': path.is_file(), 'hash_matches': False, 'video_decodes': False}
        if row['exists']:
            row['hash_matches'] = hashlib.sha256(path.read_bytes()).hexdigest() == case['sha256']
            video = cv2.VideoCapture(str(path))
            if video.isOpened():
                ok, frame = video.read()
                fps = video.get(cv2.CAP_PROP_FPS)
                count = video.get(cv2.CAP_PROP_FRAME_COUNT)
                row['video_decodes'] = bool(ok and frame is not None)
                row['fps'] = round(fps, 3)
                row['decoded_duration_s'] = round(count / fps, 3) if fps else None
                row['duration_matches'] = row['decoded_duration_s'] is not None and abs(row['decoded_duration_s'] - case['durationSeconds']) <= .15
            video.release()
        rows.append(row)
    problems = [r for r in rows if not r['exists'] or not r['hash_matches'] or not r['video_decodes'] or not r.get('duration_matches')]
    result = {'format': 'lingora-benchmark-media-audit-v1', 'cases': len(rows), 'problems': problems,
              'limitations': ['Checks file integrity and decode metadata, not label correctness or sign boundaries.'], 'records': rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'cases': len(rows), 'problems': len(problems), 'problem_ids': [r['id'] for r in problems]}))
    if problems:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
