"""Private, offline comparison of a third-party Uzbek model on local videos.

This does not modify or deploy Lingora's model. The external checkout and all
video/landmark inputs remain under the ignored private research directory.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
import time

import cv2
import mediapipe as mp
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]
EXTERNAL = ROOT / 'private-video-work/uzslr-external'
MEDIA = ROOT / 'private-video-work/training-expanded-v3/live-media'
sys.path.insert(0, str(EXTERNAL))
from web_app.backend.config import DEFAULT_SIGNS  # noqa: E402
from web_app.backend.model import SignLanguageModel  # noqa: E402
from web_app.backend.preprocess import Preprocess  # noqa: E402


def sample_video(path: Path):
    capture = cv2.VideoCapture(str(path))
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if not capture.isOpened() or count < 32:
        raise ValueError(f'Video cannot provide 32 frames: {path.name}')
    targets = set(np.linspace(0, count - 1, 32, dtype=int).tolist())
    frames, seen = [], []
    with mp.solutions.holistic.Holistic(static_image_mode=False, model_complexity=1,
                                      min_detection_confidence=.5, min_tracking_confidence=.5) as detector:
        for index in range(count):
            ok, image = capture.read()
            if not ok:
                break
            if index not in targets:
                continue
            result = detector.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            def values(landmarks, size, visibility=False):
                if not landmarks:
                    return np.zeros(size * (4 if visibility else 3), dtype=np.float32)
                return np.array([[p.x, p.y, p.z, p.visibility] if visibility else [p.x, p.y, p.z]
                                 for p in landmarks.landmark], dtype=np.float32).ravel()
            frames.append(np.concatenate([values(result.face_landmarks, 468), values(result.pose_landmarks, 33, True),
                                          values(result.right_hand_landmarks, 21), values(result.left_hand_landmarks, 21)]))
            seen.append({'face': bool(result.face_landmarks), 'left': bool(result.left_hand_landmarks),
                         'right': bool(result.right_hand_landmarks)})
    capture.release()
    if len(frames) != 32 or any(len(f) != 1662 for f in frames):
        raise ValueError(f'Incomplete landmark sequence: {path.name}')
    return np.stack(frames), {key: sum(v[key] for v in seen) / len(seen) for key in ('face', 'left', 'right')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'private-video-work/uzslr-inspect/comparison.json')
    parser.add_argument('--video', type=Path, help='Evaluate one local video instead of the bundled replay manifest')
    parser.add_argument('--expected', default='unverified', help='Reference label for the local video; not used by the model')
    args = parser.parse_args()
    if args.video:
        cases = [{'id': args.video.stem, 'expected': args.expected, 'path': args.video}]
    else:
        manifest = json.loads((MEDIA / 'manifest.json').read_text(encoding='utf-8'))
        cases = [dict(c, path=MEDIA / c['file']) for c in manifest['cases']
                 if c['scenario'] == 'nominal' and c['split'] == 'regression'
                 and c['expected'] in {'hello', 'goodbye', 'please', 'thank_you'}]
    model = SignLanguageModel(max_len=32, channels=708, num_classes=50, dim=192)
    weights = torch.load(EXTERNAL / 'web_app/best_model.pth', map_location='cpu', weights_only=True)
    model.load_state_dict(weights)
    model.eval()
    preprocess = Preprocess(max_len=32)
    results = []
    for case in cases:
        started = time.perf_counter()
        frames, coverage = sample_video(case['path'])
        with torch.inference_mode():
            features = preprocess(torch.from_numpy(frames)).unsqueeze(0)
            probabilities = torch.softmax(model(features, torch.ones(1, 32, dtype=torch.bool)), dim=-1)[0]
            scores, indices = torch.topk(probabilities, 3)
        results.append({'id': case['id'], 'expected_lingora': case['expected'], 'coverage': coverage,
                        'top3': [{'label': DEFAULT_SIGNS[i], 'score': round(float(score), 4)}
                                 for i, score in zip(indices.tolist(), scores.tolist())],
                        'seconds': round(time.perf_counter() - started, 2)})
        print(json.dumps(results[-1]), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'model': 'akkomron/uzslr-isolated-dynamic',
                                       'split': 'user-supplied video' if args.video else 'previously inspected Lingora source replays',
                                       'limitations': '32 evenly sampled frames; upstream live inference uses consecutive frames. Different model vocabulary; labels and signer independence are unverified.',
                                       'results': results}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
