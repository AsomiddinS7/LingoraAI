"""Check the external Uzbek checkpoint on its own published demo videos.

These are positive controls, not independent accuracy evidence. Upstream video
use/distribution rights are unverified; inputs and reports stay private.
"""
import hashlib
import json
from pathlib import Path
import time

import torch

from evaluate_external_uzslr import sample_video
from evaluate_uzslr_stream import EXTERNAL, ROOT, DEFAULT_SIGNS, Preprocess, SignLanguageModel, run_case

OUTPUT = ROOT / 'private-video-work/benchmark-v1/uzslr-own-demos.json'
VIDEOS = EXTERNAL / 'web_app/sign_videos'
NAMES = ['iltimos', 'assalomu_alaykum', 'yordam_berish']


def main():
    checkpoint = EXTERNAL / 'web_app/best_model.pth'
    model = SignLanguageModel(max_len=32, channels=708, num_classes=50, dim=192)
    model.load_state_dict(torch.load(checkpoint, map_location='cpu', weights_only=True))
    model.eval(); torch.set_num_threads(4)
    preprocess = Preprocess(max_len=32)
    cases = []
    for name in NAMES:
        source = VIDEOS / f'{name}.mp4'
        started = time.perf_counter()
        gated = run_case(source, model, preprocess)
        vectors, coverage = sample_video(source)
        with torch.inference_mode():
            x = preprocess(torch.from_numpy(vectors)).unsqueeze(0)
            values, indices = torch.topk(torch.softmax(model(x, torch.ones(1, 32, dtype=torch.bool)), -1)[0], 3)
        row = {'expected_upstream_label': name, 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
               'gated': gated, 'presegmented_top3': [{'label': DEFAULT_SIGNS[int(i)], 'score': round(float(v), 4)}
                                                       for i, v in zip(indices, values)],
               'presegmented_coverage': coverage, 'elapsed_s': round(time.perf_counter() - started, 2)}
        cases.append(row)
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps({'limitations': ['Own published examples; may overlap model training.',
                           'Python offline replay is not the upstream browser/phone.'], 'cases': cases}, indent=2), encoding='utf-8')
        print(json.dumps({'expected': name, 'gated_top': [r['top3'][0]['label'] for r in gated['predictions']],
                          'presegmented_top': row['presegmented_top3'][0]['label']}), flush=True)


if __name__ == '__main__':
    main()
