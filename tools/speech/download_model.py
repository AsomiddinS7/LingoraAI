"""Explicit model download; evaluation itself stays offline and never downloads."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=['small', 'large-v3-turbo'], default='large-v3-turbo')
    args = parser.parse_args()
    from faster_whisper.utils import download_model
    location = Path(download_model(args.model))
    weights = location / 'model.bin'
    digest = hashlib.sha256()
    with weights.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    report = {'model': args.model, 'cache_path': str(location), 'model_bytes': weights.stat().st_size,
              'model_sha256': digest.hexdigest(), 'audio_uploaded': False}
    output = Path('private-video-work/speech-evaluation')
    output.mkdir(parents=True, exist_ok=True)
    (output / f'download-{args.model}.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
