"""Make private pixel-level camera simulations from actual reviewed source videos.

Replays and transformations are correlated tests, never new recordings/signers.
"""
from pathlib import Path
import json
import hashlib
import math
import argparse
import cv2
import numpy as np

ROOT = Path('private-video-work')
OUT = ROOT / 'training-expanded-v1' / 'simulation'
FPS = 25

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def prepare(split='evaluation',output=OUT):
    output.mkdir(parents=True, exist_ok=True)
    experiment = read(ROOT / 'training-expanded-v1' / 'experiment-raw.json')['samples']
    sources = {s['id']: s for s in read(ROOT / 'sources.json')['sources']}
    crops = {s['id']: s for s in read(ROOT / 'dataset-expansion/internet/crop-manifest.json')['clips']}
    round_source = read(ROOT / 'dataset-expansion/round/manifest.json')
    phrases = read(ROOT / 'dataset-expansion/combined/phrase-train.json')['templates']
    if split=='train':
        selected=[s for s in experiment if s['split']=='train']
    else:
        selected = [s for s in experiment if s['split'] != 'train']
        tested = {s['label'] for s in selected}
        selected += [s for s in experiment if s['split'] == 'train' and s['label'] not in tested]
        for s in phrases:
            selected.append({**s, 'split': 'training_source_replay', 'metadata': {
                'recordingId': round_source['source_id'], 'recordingSha256': round_source['source']['sha256'], 'labelUz': s['label']}})
    cases, verified, adverse_labels = [], set(), set()
    for sample in selected:
        m, label = sample['metadata'], sample['label']
        if m['recordingId'] in crops:
            crop = crops[m['recordingId']]
            source = ROOT / 'dataset-expansion/internet' / crop['cropped_path']
            expected_sha = crop['cropped_sha256']
        elif m['recordingId'] in sources:
            source = Path(sources[m['recordingId']]['video']); expected_sha = m['recordingSha256']
        else:
            source = Path(round_source['source']['path']); expected_sha = round_source['source']['sha256']
        if str(source) not in verified:
            assert sha(source) == expected_sha
            verified.add(str(source))
        cap = cv2.VideoCapture(str(source))
        source_fps = cap.get(cv2.CAP_PROP_FPS)
        start, end = sample['frames'][0]['t'] / 1000, sample['frames'][-1]['t'] / 1000
        first, last = math.floor(start * source_fps), math.ceil(end * source_fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, first)
        frames = []
        for _ in range(first, last + 1):
            ok, frame = cap.read()
            if not ok: break
            frames.append(frame)
        cap.release()
        assert frames, sample['id']
        scenarios = ['nominal']
        kind = 'phrase' if label.startswith('speech_') else 'word'
        if label != 'none' and kind == 'word' and (split=='train' or label not in adverse_labels):
            scenarios.append('dim_blur_reframe_fast'); adverse_labels.add(label)
        for scenario in scenarios:
            case_id = sample['id'] + '-' + scenario
            destination = output / (case_id + '.mp4')
            writer = cv2.VideoWriter(str(destination), cv2.CAP_MSMF, cv2.VideoWriter_fourcc(*'H264'), FPS, (640, 480))
            assert writer.isOpened(), 'Windows H264 encoder unavailable'
            speed = 1.25 if scenario != 'nominal' else 1.0
            padding = .2
            duration = (end - start) / speed + 2 * padding
            for i in range(math.ceil(duration * FPS)):
                t = min(end, max(start, start + (i / FPS - padding) * speed))
                frame = frames[min(len(frames) - 1, max(0, round(t * source_fps) - first))]
                height, width = frame.shape[:2]
                factor = min(640 / width, 480 / height) * (.9 if scenario != 'nominal' else 1)
                w, h = max(2, int(width * factor)), max(2, int(height * factor))
                image = cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA)
                canvas = np.full((480, 640, 3), 45, dtype=np.uint8)
                x = (640 - w) // 2 + (22 if scenario != 'nominal' else 0)
                y = (480 - h) // 2
                canvas[y:y+h, x:x+w] = image
                if scenario != 'nominal':
                    canvas = cv2.resize(cv2.resize(canvas, (320, 240)), (640, 480))
                    canvas = cv2.GaussianBlur(canvas, (5, 5), 1.)
                    canvas = np.clip(canvas.astype(np.float32) * .65, 0, 255).astype(np.uint8)
                writer.write(canvas)
            writer.release()
            cases.append({'id': case_id, 'sampleId': sample['id'], 'expected': label, 'labelUz': m['labelUz'],
                'scope': kind, 'split': sample['split'], 'scenario': scenario, 'file': destination.name,
                'sourceRecordingId': m['recordingId'], 'originalSha256': m['recordingSha256'],
                'decodedSourceSha256': expected_sha, 'sourceWindowSeconds': [start, end],
                'sha256': sha(destination), 'durationSeconds': math.ceil(duration * FPS) / FPS,
                'speed': speed, 'paddingSeconds': padding, 'resolution': [640, 480], 'fps': FPS,
                'independentTest': False, 'trainingSourceReplay': sample['split'] in ('train', 'training_source_replay')})
            print(json.dumps({'prepared': case_id, 'duration': duration}), flush=True)
    manifest = {'format': 'lingora-pixel-simulation-v1', 'cases': cases,
        'limitations': 'Source replays with simulated camera conditions. Same-signers/recordings. No real-life generalization claim. Training-source replays are explicitly separated.',
        'scenarios': {'nominal': '640x480 letterboxed source, 0.2s endpoint hold each side',
            'dim_blur_reframe_fast': '65% brightness, 320x240 downsample/640x480 upscale, Gaussian blur sigma1, 90% subject scale, 22px horizontal shift, 1.25x movement speed, 0.2s endpoint hold each side'},
        'sourceSplit':split,
        'counts': {'cases': len(cases), 'wordLabels': len(adverse_labels), 'phraseLabels': 0 if split=='train' else 6}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(manifest['counts']), flush=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--split',choices=('evaluation','train'),default='evaluation')
    parser.add_argument('--out',type=Path,default=OUT)
    args=parser.parse_args();prepare(args.split,args.out)
