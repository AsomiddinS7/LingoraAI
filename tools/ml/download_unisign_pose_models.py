"""Fetch the official RTM lightweight ONNX assets for private CPU research.

Only a single ONNX member is extracted from each archive; archive paths are not
used as destination paths. This tool never uploads recordings or reads tokens.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import math
from pathlib import Path
import shutil
import zipfile

import httpx

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'private-video-work/unisign-pose-models'
ASSETS = {
    'detector': ('https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_tiny_8xb8-300e_humanart-6f3252f9.zip', 18887737),
    'wholebody': ('https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/rtmw-dw-l-m_simcc-cocktail14_270e-256x192_20231122.zip', 120002068),
}


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    report = {}
    with httpx.Client(follow_redirects=True, timeout=120) as client:
        for name, (url, expected_size) in ASSETS.items():
            archive, model = DEST / f'{name}.zip', DEST / f'{name}.onnx'
            if not archive.exists():
                partial = DEST / f'{name}.download'
                parts = DEST / f'{name}-ranges'
                parts.mkdir(exist_ok=True)
                chunk = 4 * 1024 * 1024
                count = math.ceil(expected_size / chunk)
                def fetch(index):
                    start, end = index * chunk, min(expected_size, (index + 1) * chunk) - 1
                    target = parts / f'{index:04}.part'
                    if target.is_file() and target.stat().st_size == end - start + 1:
                        return
                    response = client.get(url, headers={'Range': f'bytes={start}-{end}'})
                    if response.status_code != 206 or response.headers.get('content-range') != f'bytes {start}-{end}/{expected_size}' or len(response.content) != end - start + 1:
                        raise ValueError('Unexpected pose-model byte-range response')
                    target.write_bytes(response.content)
                with ThreadPoolExecutor(max_workers=4) as pool:
                    for future in as_completed([pool.submit(fetch, index) for index in range(count)]):
                        future.result()
                with partial.open('wb') as file:
                    for index in range(count):
                        with (parts / f'{index:04}.part').open('rb') as source:
                            shutil.copyfileobj(source, file)
                with zipfile.ZipFile(partial) as zf:
                    if zf.testzip() is not None:
                        raise ValueError('Downloaded archive failed its integrity check')
                partial.replace(archive)
            with zipfile.ZipFile(archive) as zf:
                members = [item for item in zf.infolist() if not item.is_dir() and item.filename.lower().endswith('.onnx')]
                if len(members) != 1 or members[0].file_size > 500_000_000:
                    raise ValueError(f'Unexpected ONNX contents for {name}')
                with zf.open(members[0]) as source, model.open('wb') as destination:
                    shutil.copyfileobj(source, destination)
            report[name] = {'source': url, 'archive_sha256': digest(archive), 'onnx_sha256': digest(model),
                            'onnx_bytes': model.stat().st_size}
            print(f'{name}: extracted {model.stat().st_size} bytes', flush=True)
    (DEST / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
