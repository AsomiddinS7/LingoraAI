"""Prepend a frozen frame to existing private clips for a timing regression.

Synthetic frames are not new signers or independent data. The first frame may
already contain sign movement; this is not a substitute for a real webcam test.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'private-video-work/training-expanded-v3/live-media'
DEST = ROOT / 'private-video-work/benchmark-v1/waited-media'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest = json.loads((SOURCE / 'manifest.json').read_text(encoding='utf-8'))
    cases = [r for r in manifest['cases'] if r['scenario'] == 'nominal'
             and r['expected'] in {'hello', 'goodbye', 'please', 'none'}]
    DEST.mkdir(parents=True, exist_ok=True)
    output = []
    for case in cases:
        original = SOURCE / case['file']
        if digest(original) != case['sha256']:
            raise ValueError(f'Source hash mismatch: {case["id"]}')
        video = cv2.VideoCapture(str(original))
        fps = video.get(cv2.CAP_PROP_FPS)
        width, height = int(video.get(cv2.CAP_PROP_FRAME_WIDTH)), int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
        ok, first = video.read()
        if not ok or fps <= 0:
            raise ValueError(f'Invalid video: {case["id"]}')
        destination = DEST / case['file']
        writer = cv2.VideoWriter(str(destination), cv2.CAP_MSMF, cv2.VideoWriter_fourcc(*'H264'), fps, (width, height))
        if not writer.isOpened():
            raise RuntimeError('H264 encoder unavailable')
        preframes = round(fps)
        for _ in range(preframes):
            writer.write(first)
        count = preframes
        while ok:
            writer.write(first); count += 1
            ok, first = video.read()
        writer.release(); video.release()
        output.append({**case, 'sha256': digest(destination), 'durationSeconds': count / fps,
                       'paddingSeconds': case['paddingSeconds'] + preframes / fps,
                       'syntheticFrozenPrefixSeconds': preframes / fps})
    (DEST / 'manifest.json').write_text(json.dumps({'format': 'lingora-synthetic-wait-v1', 'cases': output,
        'limitations': 'Frozen first-frame prefix; not a real pre-sign webcam recording or a new signer.'}, indent=2), encoding='utf-8')
    print(json.dumps({'cases': len(output), 'prefixSeconds': 1, 'synthetic': True}))


if __name__ == '__main__':
    main()
