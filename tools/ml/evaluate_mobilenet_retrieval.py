"""Offline visual baseline: ImageNet MobileNet features, not a sign model."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

import numpy as np
import torch
import torch.nn.functional as F
from torchvision.models import mobilenet_v3_small

from evaluate_signrep_retrieval import LABELS, WORK, cases, central_frames


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=WORK / 'uzslr-inspect/mobilenet-person-crop.json')
    parser.add_argument('--adverse', action='store_true', help='Use synthetic dim/blur/reframed query versions')
    args = parser.parse_args()
    references = cases(WORK / 'tracking-v2/training-videos', gallery=True)
    queries = cases(WORK / 'training-expanded-v3/live-media', gallery=False)
    if args.adverse:
        directory = WORK / 'training-expanded-v1/simulation'
        manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf8'))
        selected = {q['sampleId'] for q in queries}
        queries = [dict(c, path=directory / c['file']) for c in manifest['cases']
                   if c['sampleId'] in selected and c['scenario'] == 'dim_blur_reframe_fast']
    if {x['expected'] for x in references} != LABELS:
        raise ValueError('Missing a required gallery class')
    for query in queries:
        for ref in references:
            if query['originalSha256'] == ref['originalSha256']:
                a, b = query['sourceWindowSeconds'], ref['sourceWindowSeconds']
                if max(a[0], b[0]) < min(a[1], b[1]):
                    raise ValueError('Overlapping source intervals')
    model = mobilenet_v3_small(weights=None)
    model.load_state_dict(torch.load(args.checkpoint, map_location='cpu', weights_only=True))
    model.eval()
    mean = torch.tensor([.485, .456, .406]).view(1, 3, 1, 1)
    std = torch.tensor([.229, .224, .225]).view(1, 3, 1, 1)
    started = time.perf_counter()
    vectors = []
    for item in references + queries:
        frames = central_frames(item['path'], .43)
        tensor = torch.from_numpy(frames.copy()).permute(0, 3, 1, 2).float().div(255)
        tensor = (F.interpolate(tensor, size=(224, 224), mode='bilinear', align_corners=False) - mean) / std
        with torch.inference_mode():
            features = model.avgpool(model.features(tensor)).flatten(1)
            vector = F.normalize(features.mean(0), dim=0).numpy()
        vectors.append(vector)
        print(f'embedded {item["id"]} ({time.perf_counter()-started:.1f}s)', flush=True)
    gallery = np.stack(vectors[:len(references)])
    results = []
    for query, vector in zip(queries, vectors[len(references):]):
        best = {}
        for ref, score in zip(references, gallery @ vector):
            label = ref['expected']
            best[label] = max(best.get(label, -1), float(score))
        ranking = sorted(best.items(), key=lambda x: x[1], reverse=True)
        results.append({'id': query['id'], 'expected': query['expected'] if query['expected'] in LABELS else 'none',
                        'original_label': query['expected'],
                        'ranked': [{'label': label, 'cosine': round(score, 4)} for label, score in ranking]})
    report = {'model': 'torchvision MobileNetV3 Small ImageNet features; no sign training',
              'method': 'mean of 16 central frame features, left 43% of frame, cosine, no rejection threshold',
              'adverse': args.adverse,
              'limitations': 'same-session clips; crop changes framing; no independent signer or live test',
              'gallery': [c['id'] for c in references], 'seconds': round(time.perf_counter() - started, 2),
              'results': results}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
