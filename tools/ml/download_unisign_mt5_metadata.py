"""Get pinned public mT5 configuration/tokenizer files for private research."""
import hashlib
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'private-video-work/unisign-assets/mt5'
REVISION = '2eb15465c5dd7f72a8f7984306ad05ebc3dd1e1f'
FILES = {
    'config.json': (702, 'c95011e03b3db1efed3065a7b90884f77f98fc10'),
    'special_tokens_map.json': (65, '6dc4d430ddbd24171268d73da061ce9f0b092911'),
    'spiece.model': (4309802, '26a2a78808e998e45d2e0c184265897e6695b914'),
    'tokenizer_config.json': (376, '712e82c8fde9e07d534178c2dfbdd063572d00c4'),
}


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=90) as client:
        for name, (size, expected) in FILES.items():
            target = DEST / name
            if target.exists():
                data = target.read_bytes()
            else:
                url = f'https://huggingface.co/google/mt5-base/resolve/{REVISION}/{name}'
                response = client.get(url, headers={'Range': f'bytes=0-{size - 1}'})
                response.raise_for_status()
                data = response.content
            if len(data) != size or git_blob_sha(data) != expected:
                raise ValueError(f'Unexpected tokenizer/config file: {name}')
            if not target.exists():
                target.write_bytes(data)
            print(f'{name}: verified', flush=True)


if __name__ == '__main__':
    main()
