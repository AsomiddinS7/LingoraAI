"""Keep research execution pinned to the inspected upstream source tree."""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
REPO = ROOT / 'private-video-work/unisign-research'
EXPECTED_REVISION = 'eed438bcb49e30405cd6ccdfcccca330c134e830'


def verify_upstream_repo():
    revision = subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True, timeout=30).strip()
    if revision != EXPECTED_REVISION:
        raise ValueError('Uni-Sign source is not at the inspected revision')
    result = subprocess.run(['git', '-C', str(REPO), 'diff', '--quiet', 'HEAD', '--'], timeout=30, check=False)
    if result.returncode != 0:
        raise ValueError('Uni-Sign tracked source files have changed')
