"""Run the pinned ASL Uni-Sign research checkpoint on private RTM pose files.

CPU adaptation of the upstream pose-only inference path. Its pretrained output
is English/ASL, not Uzbek. Results and biometric poses remain private. The
checkpoint is CC BY-NC 4.0 and is not cleared for commercial deployment.
"""
from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from types import SimpleNamespace
from unittest.mock import patch
from unisign_integrity import verify_upstream_repo

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT / 'private-video-work/unisign-research'
DEPS = ROOT / 'private-video-work/unisign-deps'
MT5 = ROOT / 'private-video-work/unisign-assets/mt5'
POSES = ROOT / 'private-video-work/benchmark-v1/unisign-pose'
MEDIA_MANIFEST = ROOT / 'private-video-work/training-expanded-v3/live-media/manifest.json'
CHECKPOINT = ROOT / 'private-video-work/unisign-checkpoints/how2sign_pose_only_slt.pth'
EXPECTED_SHA = '1bfd5f3312f04e4736f0a52f4ef9535916e6de9676a2a0d00c708748683fb00d'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
verify_upstream_repo()
sys.path.insert(0, str(DEPS))
sys.path.insert(0, str(REPO))

import numpy as np
import torch
from transformers import MT5Config, MT5ForConditionalGeneration
import models


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def upstream_pose_functions():
    """Load only the reviewed preprocessing functions, avoiding training imports."""
    path = REPO / 'datasets.py'
    tree = ast.parse(path.read_text(encoding='utf-8'), filename=str(path))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in {'load_part_kp', 'crop_scale'}]
    if {node.name for node in functions} != {'load_part_kp', 'crop_scale'}:
        raise ValueError('Unexpected upstream pose functions')
    scope = {'np': np, 'torch': torch, 'copy': copy}
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(path), 'exec'), scope)
    return scope['load_part_kp']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ids', default='hello-chin-2-nominal')
    parser.add_argument('--max-new-tokens', type=int, default=24)
    parser.add_argument('--num-beams', type=int, default=1)
    parser.add_argument('--output', type=Path, default=ROOT / 'private-video-work/benchmark-v1/unisign-cpu-results.json')
    args = parser.parse_args()
    if not 1 <= args.max_new_tokens <= 100 or not 1 <= args.num_beams <= 4:
        raise ValueError('Invalid generation limits')
    if digest(CHECKPOINT) != EXPECTED_SHA:
        raise ValueError('Checkpoint hash mismatch')
    torch.set_num_threads(4)
    started = time.perf_counter()
    model_state = torch.load(CHECKPOINT, map_location='cpu', weights_only=True)['model']
    # The checkpoint contains the mT5 weights. Construct the architecture from
    # the pinned config locally, and demand a strict load of every model tensor.
    config = MT5Config.from_pretrained(MT5, local_files_only=True)
    mt5 = MT5ForConditionalGeneration(config)
    models.mt5_path = str(MT5)
    options = SimpleNamespace(hidden_dim=256, dataset='How2Sign', rgb_support=False, label_smoothing=.2)
    with patch.object(MT5ForConditionalGeneration, 'from_pretrained', return_value=mt5):
        model = models.Uni_Sign(options)
    model.load_state_dict(model_state, strict=True)
    del model_state
    model.eval()
    print(f'Model loaded on CPU in {time.perf_counter() - started:.1f}s; strict checkpoint load passed', flush=True)
    preprocess = upstream_pose_functions()
    pose_manifest = {row['id']: row for row in json.loads((POSES / 'summary.json').read_text(encoding='utf-8'))['cases']}
    source_manifest = {row['id']: row for row in json.loads(MEDIA_MANIFEST.read_text(encoding='utf-8'))['cases']}
    rows = []
    for ident in args.ids.split(','):
        path = POSES / f'{ident}.npz'
        if ident not in pose_manifest or ident not in source_manifest:
            raise ValueError(f'Missing pose provenance: {ident}')
        pose_hash = digest(path)
        if pose_hash != pose_manifest[ident]['pose_file_sha256'] or pose_manifest[ident]['video_sha256'] != source_manifest[ident]['sha256']:
            raise ValueError(f'Pose provenance mismatch: {ident}')
        with np.load(path, allow_pickle=False) as data:
            points, scores = data['keypoints'], data['scores']
        if points.ndim != 4 or points.shape[1:] != (1, 133, 2) or scores.shape != points.shape[:3]:
            raise ValueError(f'Invalid pose file: {ident}')
        if len(points) > 256:
            raise ValueError('Clip exceeds the upstream maximum; choose a reproducible sampling policy')
        prepared = preprocess(list(points), list(scores), force_ok=True)
        src = {key: value.unsqueeze(0).float() for key, value in prepared.items()}
        src['attention_mask'] = torch.ones((1, len(points)), dtype=torch.long)
        src['src_length_batch'] = torch.tensor([len(points)], dtype=torch.long)
        src['name_batch'] = ['private']
        before = time.perf_counter()
        with torch.inference_mode():
            encoded = model(src, {'gt_sentence': ['']})
            generated = model.generate(encoded, max_new_tokens=args.max_new_tokens, num_beams=args.num_beams)
        text = model.mt5_tokenizer.batch_decode(generated, skip_special_tokens=True)[0]
        row = {'id': ident, 'expected_lingora': source_manifest[ident]['expected'], 'pose_sha256': pose_hash,
               'video_sha256': source_manifest[ident]['sha256'], 'frames': len(points), 'output': text,
               'inference_s': round(time.perf_counter() - before, 2)}
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'model': 'Uni-Sign How2Sign pose-only', 'checkpoint_sha256': EXPECTED_SHA,
        'device': 'CPU', 'max_new_tokens': args.max_new_tokens, 'num_beams': args.num_beams,
        'limitations': ['ASL-to-English checkpoint; not validated for Uzbek.',
                        'Existing videos used in Lingora development, not an independent-signer test.',
                        'Offline CPU replay; default 1 beam and 24 tokens differ from the official online example.'],
        'cases': rows}, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
