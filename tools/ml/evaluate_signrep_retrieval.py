"""Research-only SignRep retrieval comparison on separate recorded repetitions.

Requires the SignRep research checkpoint and signlangtk in a local environment.
Outputs only scores and clip IDs, never frames or embeddings. No production code
or model is changed. Same-session source recordings are NOT new-signer tests.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time

import cv2
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / 'private-video-work'
LABELS = {'hello', 'goodbye', 'please', 'thank_you'}
OTHER_SIGNS = {'my', 'to_me', 'at_me', 'at_you', 'number_four', 'number_seven', 'number_eight', 'number_nine'}


def cases(directory, *, gallery):
    data = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    if gallery:
        return [dict(c, path=directory / c['file']) for c in data['cases']
                if c['scenario'] == 'nominal' and c['split'] == 'train' and c['expected'] in LABELS]
    return [dict(c, path=directory / c['file']) for c in data['cases']
            if c['scenario'] == 'nominal' and (c['expected'] in LABELS or c['expected'] in OTHER_SIGNS
                                                or c['split'] == 'unknown_regression')]


def central_frames(path, crop_fraction=None, mask_right=False):
    """One central 16-frame window: fast CPU experiment, not full video spotting."""
    cap = cv2.VideoCapture(str(path))
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if not cap.isOpened() or count < 16:
        raise ValueError(f'Cannot read 16 frames from {path.name}')
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, count // 2 - 8))
    result = []
    for _ in range(16):
        ok, frame = cap.read()
        if not ok:
            raise ValueError(f'Cannot decode {path.name}')
        if crop_fraction:
            boundary = int(frame.shape[1] * crop_fraction)
            if mask_right:
                frame[:, boundary:] = 0
            else:
                frame = frame[:, :boundary]
        result.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    cap.release()
    return np.stack(result)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=WORK / 'uzslr-inspect/signrep-retrieval.json')
    parser.add_argument('--crop-left-fraction', type=float, help='Keep left fraction of each frame to mask lesson titles')
    parser.add_argument('--mask-right', action='store_true', help='Mask instead of cropping the right-hand portion')
    args = parser.parse_args()
    if args.crop_left_fraction is not None and not 0 < args.crop_left_fraction <= 1:
        parser.error('--crop-left-fraction must be in (0, 1]')
    if args.mask_right and args.crop_left_fraction is None:
        parser.error('--mask-right requires --crop-left-fraction')
    os.environ['SLTK_SIGNREP_CHECKPOINT'] = str(args.checkpoint.resolve())
    os.environ['SLTK_STRICT_CHECKPOINT_LOADING'] = '1'
    os.environ['NO_ALBUMENTATIONS_UPDATE'] = '1'
    from sltk.embedding.pipeline import SignRepVideoEmbedder
    from sltk.embedding.signrep import SignRepConfig

    references = cases(WORK / 'tracking-v2/training-videos', gallery=True)
    queries = cases(WORK / 'training-expanded-v3/live-media', gallery=False)
    if {c['expected'] for c in references} != LABELS:
        raise ValueError('Missing a required gallery class')
    for query in queries:
        for ref in references:
            if query['originalSha256'] == ref['originalSha256']:
                a, b = query['sourceWindowSeconds'], ref['sourceWindowSeconds']
                if max(a[0], b[0]) < min(a[1], b[1]):
                    raise ValueError(f'Overlapping source intervals: {query["id"]}, {ref["id"]}')
    model = SignRepVideoEmbedder(SignRepConfig(checkpoint_path=args.checkpoint, device='cpu', amp=False, num_workers=0))
    vectors = []
    started = time.perf_counter()
    for item in references + queries:
        embedding = model.embed_frames(central_frames(item['path'], args.crop_left_fraction, args.mask_right))
        vectors.append(embedding)
        print(f'embedded {item["id"]} ({time.perf_counter()-started:.1f}s)', flush=True)
    reference_vectors = np.stack(vectors[:len(references)])
    results = []
    for query, vector in zip(queries, vectors[len(references):]):
        scores = reference_vectors @ vector
        best = {}
        for ref, score in zip(references, scores):
            label = ref['expected']
            best[label] = max(best.get(label, -1), float(score))
        ranking = sorted(best.items(), key=lambda x: x[1], reverse=True)
        results.append({'id': query['id'], 'expected': query['expected'] if query['expected'] in LABELS else 'none',
                        'original_label': query['expected'],
                        'ranked': [{'label': label, 'cosine': round(score, 4)} for label, score in ranking]})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({'model': 'SignRep v0.0.1', 'gallery': [c['id'] for c in references],
        'method': 'central 16 consecutive frames, cosine similarity, max per class, no rejection threshold',
        'crop_left_fraction': args.crop_left_fraction,
        'mask_right': args.mask_right,
        'limitations': 'same-source same-signer repetitions; tiny sample; unknown signs always receive a nearest match',
        'seconds': round(time.perf_counter()-started, 2), 'results': results}, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2), flush=True)


if __name__ == '__main__':
    main()
