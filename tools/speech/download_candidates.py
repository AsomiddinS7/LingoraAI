"""Download pinned public Uzbek ASR checkpoints; never upload audio."""
import argparse
import hashlib
import json
from pathlib import Path

CANDIDATES = {
    "ovozify": ("OvozifyLabs/whisper-small-uz-v1", "863efed858ab6ed7eda7c72119fff5af4665e0a2"),
    "nvidia": ("nvidia/stt_uz_fastconformer_hybrid_large_pc", "cd32f63d620a7b0cb461ed00ecfc45c852eb0bef"),
    "nvidia-onnx": ("algorithco/stt_uz_fastconformer_hybrid_large_pc", "1786554e0cdfacb8bf9076b4d9739cb81d2fbb2d"),
}


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", choices=CANDIDATES, required=True)
    args = parser.parse_args()
    from huggingface_hub import snapshot_download
    repo, revision = CANDIDATES[args.candidate]
    patterns = ["*.onnx", "tokens.txt", "NOTICE", "README.md"] if args.candidate == "nvidia-onnx" else None
    folder = Path(snapshot_download(repo_id=repo, revision=revision, token=False, allow_patterns=patterns))
    files = [{"file": path.name, "bytes": path.stat().st_size, "sha256": file_hash(path)}
             for path in sorted(folder.iterdir()) if path.is_file()]
    report = {"candidate": args.candidate, "repo_id": repo, "revision": revision,
              "cache_path": str(folder), "audio_uploaded": False, "files": files}
    out = Path(__file__).resolve().parents[2] / "private-video-work/speech-evaluation/free-candidates"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"download-{args.candidate}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
