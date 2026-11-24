"""Download a pinned, small Uzbek TTS checkpoint and its verified local runtime."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

REPO = "Inomjonov/tiny-voca-uzbek-navoiy"
REVISION = "3d960bd05c728b21fff4ec5154cada7f6b082df1"
FILES = ["inference.pt", "config.json", "LICENSE", "NOTICE", "README.md", "UPSTREAM.json",
         "licenses/navoiy_LICENSE", "licenses/navoiy_NOTICE", "licenses/training_texts.md",
         "src/tiny_voca/__init__.py", "src/tiny_voca/config.py", "src/tiny_voca/model.py",
         "src/tiny_voca/text.py", "src/tiny_voca/infer.py", "uzbek_normalize.py"]
DEFAULT_DIRECTORY = Path(__file__).resolve().parents[2] / "private-video-work/speech-models/tiny-voca"

def sha(data):
    return hashlib.sha256(data).hexdigest()

def download(directory=DEFAULT_DIRECTORY):
    directory = Path(directory)
    base = f"https://huggingface.co/{REPO}/resolve/{REVISION}/"
    with urllib.request.urlopen(base + "SHA256SUMS", timeout=45) as response:
        manifest = response.read()
    expected = {line.split()[1]: line.split()[0] for line in manifest.decode().splitlines() if line.strip()}
    rows = []
    for name in FILES:
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and sha(target.read_bytes()) == expected[name]:
            data = target.read_bytes()
        else:
            with urllib.request.urlopen(base + name, timeout=90) as response:
                data = response.read(25_000_001)
            if len(data) > 25_000_000 or sha(data) != expected[name]:
                raise ValueError(f"Unexpected checkpoint bytes: {name}")
            target.write_bytes(data)
        rows.append({"file": name, "bytes": len(data), "sha256": sha(data)})
    (directory / "SHA256SUMS").write_bytes(manifest)
    report = {"repo_id": REPO, "revision": REVISION, "license": "Apache-2.0",
              "audio_uploaded": False, "files": rows}
    (directory / "download-manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"repo_id": REPO, "revision": REVISION, "files": len(rows),
                      "bytes": sum(r['bytes'] for r in rows)}), flush=True)
    return directory

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=DEFAULT_DIRECTORY)
    download(parser.parse_args().out)
