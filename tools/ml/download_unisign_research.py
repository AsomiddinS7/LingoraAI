"""Download a pinned public Uni-Sign research checkpoint in bounded ranges.

Upstream declares CC BY-NC 4.0. This checkpoint is research-only and was
trained for ASL, not Uzbek. No authentication or user data is sent.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
from pathlib import Path
import math

import httpx

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'private-video-work/unisign-checkpoints'
REVISION = 'eab251b7fe7e8521afc0e67be98add670ea40a0d'
FILENAME = 'how2sign_pose_only_slt.pth'
EXPECTED = '1bfd5f3312f04e4736f0a52f4ef9535916e6de9676a2a0d00c708748683fb00d'
SIZE = 1186925007
CHUNK = 8 * 1024 * 1024
URL = f'https://huggingface.co/ZechengLi19/Uni-Sign/resolve/{REVISION}/{FILENAME}'


def digest(path):
    h = sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    target = DEST / FILENAME
    if target.exists():
        if digest(target) != EXPECTED:
            raise ValueError('Existing checkpoint does not match the expected hash')
        print('Existing checkpoint hash verified')
        return
    parts = DEST / 'range-parts'
    parts.mkdir(exist_ok=True)
    total = math.ceil(SIZE / CHUNK)
    with httpx.Client(follow_redirects=True, timeout=90, limits=httpx.Limits(max_connections=6)) as client:
        def fetch(index):
            start = index * CHUNK
            end = min(SIZE, start + CHUNK) - 1
            part = parts / f'{index:04}.part'
            if part.is_file() and part.stat().st_size == end - start + 1:
                return index
            for attempt in range(3):
                try:
                    response = client.get(URL, headers={'Range': f'bytes={start}-{end}'})
                    if response.status_code != 206 or response.headers.get('content-range') != f'bytes {start}-{end}/{SIZE}' or len(response.content) != end - start + 1:
                        raise ValueError('Unexpected byte-range response')
                    part.write_bytes(response.content)
                    return index
                except (httpx.HTTPError, ValueError):
                    if attempt == 2:
                        raise
        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = [pool.submit(fetch, index) for index in range(total)]
            for count, future in enumerate(as_completed(futures), start=1):
                future.result()
                if count % 12 == 0 or count == total:
                    print(f'Checkpoint ranges: {count}/{total}', flush=True)
    assembling = DEST / (FILENAME + '.assembling')
    with assembling.open('wb') as dest:
        for index in range(total):
            with (parts / f'{index:04}.part').open('rb') as source:
                for block in iter(lambda: source.read(8 * 1024 * 1024), b''):
                    dest.write(block)
    if assembling.stat().st_size != SIZE or digest(assembling) != EXPECTED:
        raise ValueError('Checkpoint hash verification failed')
    assembling.replace(target)
    print(f'Checkpoint verified: {FILENAME}', flush=True)


if __name__ == '__main__':
    main()
