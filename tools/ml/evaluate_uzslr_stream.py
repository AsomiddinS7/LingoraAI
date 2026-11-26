"""Replay local clips through the upstream web app's 32-frame hand gate.

This offline experiment follows the web backend's buffering logic with Python
MediaPipe Holistic. It is not the JS client, an actual webcam, or independent
signer evaluation. The external checkpoint always emits a closed-set label.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import time

import cv2
import mediapipe as mp
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]
EXTERNAL = ROOT / 'private-video-work/uzslr-external'
MEDIA = ROOT / 'private-video-work/training-expanded-v3/live-media'
sys.path.insert(0, str(EXTERNAL))
from web_app.backend.config import DEFAULT_SIGNS, HAND_DISAPPEAR_TOLERANCE, BUFFER_SIZE
from web_app.backend.model import SignLanguageModel
from web_app.backend.preprocess import Preprocess
from uzslr_web_gate import UzslrWebGate


def landmarks(result):
    def flatten(value, count, visibility=False):
        if not value:
            return np.zeros(count * (4 if visibility else 3), dtype=np.float32)
        return np.array([[p.x, p.y, p.z, p.visibility] if visibility else [p.x, p.y, p.z]
                         for p in value.landmark], dtype=np.float32).ravel()
    return np.concatenate([flatten(result.face_landmarks, 468), flatten(result.pose_landmarks, 33, True),
                           flatten(result.right_hand_landmarks, 21), flatten(result.left_hand_landmarks, 21)])


def run_case(path, model, preprocess):
    video = cv2.VideoCapture(str(path))
    if not video.isOpened():
        raise ValueError('Video could not be opened')
    fps = video.get(cv2.CAP_PROP_FPS) or 25
    gate = UzslrWebGate(BUFFER_SIZE, HAND_DISAPPEAR_TOLERANCE)
    counts, windows, frame_index = Counter(), [], 0
    started = time.perf_counter()
    with mp.solutions.holistic.Holistic(static_image_mode=False, model_complexity=1,
                                      min_detection_confidence=.5, min_tracking_confidence=.5) as detector:
        while True:
            ok, image = video.read()
            if not ok:
                break
            result = detector.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            both = bool(result.left_hand_landmarks and result.right_hand_landmarks)
            counts['frames'] += 1
            for name, visible in [('left', result.left_hand_landmarks), ('right', result.right_hand_landmarks),
                                  ('face', result.face_landmarks), ('both', both)]:
                counts[name] += bool(visible)
            buffer = gate.push((frame_index, landmarks(result)), both)
            if buffer is not None:
                with torch.inference_mode():
                    features = preprocess(torch.from_numpy(np.stack([row[1] for row in buffer]))).unsqueeze(0)
                    values, indices = torch.topk(torch.softmax(model(features, torch.ones(1, 32, dtype=torch.bool)), -1)[0], 3)
                windows.append({'start_s': round(buffer[0][0] / fps, 3), 'end_s': round(buffer[-1][0] / fps, 3),
                                'top3': [{'label': DEFAULT_SIGNS[int(i)], 'score': round(float(v), 4)}
                                         for i, v in zip(indices, values)]})
            frame_index += 1
    video.release()
    frames = counts['frames']
    return {'frames': frames, 'fps': fps, 'elapsed_s': round(time.perf_counter() - started, 3),
            'coverage': {key: round(counts[key] / frames, 3) if frames else 0 for key in ('left', 'right', 'both', 'face')},
            'predictions': windows}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'private-video-work/benchmark-v1/uzslr-stream.json')
    args = parser.parse_args()
    manifest = json.loads((MEDIA / 'manifest.json').read_text(encoding='utf-8'))
    cases = [row for row in manifest['cases'] if row['scenario'] == 'nominal'
             and row['expected'] in {'hello', 'goodbye', 'please', 'none'}]
    checkpoint = EXTERNAL / 'web_app/best_model.pth'
    model = SignLanguageModel(max_len=32, channels=708, num_classes=50, dim=192)
    model.load_state_dict(torch.load(checkpoint, map_location='cpu', weights_only=True))
    model.eval(); torch.set_num_threads(4)
    preprocess = Preprocess(max_len=32)
    output = {'protocol': 'upstream-web-gate-offline-replay-v1',
              'checkpoint_sha256': hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
              'manifest_sha256': hashlib.sha256((MEDIA / 'manifest.json').read_bytes()).hexdigest(),
              'limitations': ['Python Holistic is not the upstream JS client; all source frames processed offline.',
                              'Clip windows share source sessions with development. Signer and semantic equivalence are unverified.',
                              'Closed-set scores are not calibrated; no threshold or rejection is added.'], 'cases': []}
    for case in cases:
        clip = MEDIA / case['file']
        media_sha = hashlib.sha256(clip.read_bytes()).hexdigest()
        if media_sha != case['sha256']:
            raise ValueError(f'Clip hash mismatch: {case["id"]}')
        row = {'id': case['id'], 'expected_lingora': case['expected'], 'media_sha256': media_sha,
               **run_case(clip, model, preprocess)}
        output['cases'].append(row)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({'id': row['id'], 'windows': len(row['predictions']),
                          'top': [v['top3'][0]['label'] for v in row['predictions']], 'coverage': row['coverage']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
