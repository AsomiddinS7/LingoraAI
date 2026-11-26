"""Extract Uni-Sign's 133-point input on CPU from private replay videos.

This uses the upstream RTM whole-body implementation and separately downloaded
ONNX models. Outputs are biometric landmark data and must remain private.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

import cv2
import numpy as np
from unisign_integrity import verify_upstream_repo

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT / 'private-video-work/unisign-research'
MODELS = ROOT / 'private-video-work/unisign-pose-models'
MEDIA = ROOT / 'private-video-work/training-expanded-v3/live-media'
OUTPUT = ROOT / 'private-video-work/benchmark-v1/unisign-pose'
verify_upstream_repo()
sys.path.insert(0, str(REPO / 'demo/rtmlib-main'))
from rtmlib import Wholebody


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ids', default='hello-chin-2-nominal', help='Comma-separated existing replay IDs')
    args = parser.parse_args()
    ids = set(args.ids.split(','))
    source = json.loads((MEDIA / 'manifest.json').read_text(encoding='utf-8'))
    cases = [case for case in source['cases'] if case['id'] in ids]
    if len(cases) != len(ids):
        raise ValueError('An input ID was not found in the local manifest')
    provenance = json.loads((MODELS / 'manifest.json').read_text(encoding='utf-8'))
    for name in ('detector', 'wholebody'):
        if digest(MODELS / f'{name}.onnx') != provenance[name]['onnx_sha256']:
            raise ValueError(f'Pose model hash mismatch: {name}')
    detector = Wholebody(det=str(MODELS / 'detector.onnx'), det_input_size=(416, 416),
                         pose=str(MODELS / 'wholebody.onnx'), pose_input_size=(192, 256),
                         to_openpose=False, backend='onnxruntime', device='cpu')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    summary = []
    for case in cases:
        path = MEDIA / case['file']
        if digest(path) != case['sha256']:
            raise ValueError(f'Clip hash mismatch: {case["id"]}')
        video = cv2.VideoCapture(str(path))
        if not video.isOpened():
            raise ValueError(f'Cannot open: {case["id"]}')
        started = time.perf_counter()
        points, scores, no_person = [], [], 0
        while True:
            ok, frame = video.read()
            if not ok:
                break
            keypoints, confidence = detector(frame)
            if len(keypoints) == 0:
                no_person += 1
                points.append(np.zeros((1, 133, 2), dtype=np.float32))
                scores.append(np.zeros((1, 133), dtype=np.float32))
            else:
                height, width = frame.shape[:2]
                points.append((keypoints[:1] / np.array([width, height])).astype(np.float32))
                scores.append(confidence[:1].astype(np.float32))
            if len(points) % 20 == 0:
                print(f'{case["id"]}: {len(points)} frames', flush=True)
        video.release()
        if not points:
            raise ValueError(f'No frames: {case["id"]}')
        points_array, scores_array = np.stack(points), np.stack(scores)
        if points_array.shape[1:] != (1, 133, 2) or scores_array.shape[1:] != (1, 133):
            raise ValueError(f'Unexpected RTM pose dimensions: {case["id"]}')
        destination = OUTPUT / f'{case["id"]}.npz'
        np.savez_compressed(destination, keypoints=points_array, scores=scores_array)
        row = {'id': case['id'], 'video_sha256': case['sha256'], 'frames': len(points), 'no_person_frames': no_person,
               'elapsed_s': round(time.perf_counter() - started, 2), 'pose_file_sha256': digest(destination)}
        summary.append(row)
        print(json.dumps(row), flush=True)
    (OUTPUT / 'summary.json').write_text(json.dumps({'cases': summary,
        'limitations': 'CPU offline RTM pose extraction; no sign recognition or physical phone test.'}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
