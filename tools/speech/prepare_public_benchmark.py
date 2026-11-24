"""Collect a bounded, licensed Uzbek speech benchmark; no recordings are uploaded.

Sentence groups are assigned before inference and never cross dev/holdout roles.
The holdout protects Lingora's adaptation experiments, not pretraining overlap.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.request
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[2]
def sha(data):
    return hashlib.sha256(data).hexdigest()

def prepare(out, per_split=16):
    out = Path(out); (out / "audio").mkdir(parents=True, exist_ok=True)
    query = urlencode({"dataset": "google/fleurs", "config": "uz_uz", "split": "validation", "offset": 0, "length": 100})
    with urllib.request.urlopen("https://datasets-server.huggingface.co/rows?" + query, timeout=60) as response:
        source = response.read(4_000_000)
    data = json.loads(source)
    (out / "source-rows.json").write_bytes(source)
    selected, counts, sentences = [], {"dev": 0, "holdout": 0}, set()
    for entry in data['rows']:
        row = entry['row']; text = row['transcription'].strip()
        seconds = row['num_samples'] / 16000
        # Reference validity/duration checks are independent of model predictions.
        if not text or not 1 <= seconds <= 27:
            continue
        group = sha(text.lower().encode('utf-8'))
        role = "dev" if int(group[:8], 16) % 2 == 0 else "holdout"
        if counts[role] >= per_split or group in sentences:
            continue
        name = f"fleurs-uz-validation-{entry['row_idx']:04d}.wav"
        path = out / "audio" / name
        if path.exists():
            payload = path.read_bytes()
        else:
            with urllib.request.urlopen(row['audio'][0]['src'], timeout=45) as response:
                payload = response.read(4_000_001)
            if len(payload) > 4_000_000 or not payload.startswith(b"RIFF"):
                raise ValueError('Invalid or oversized speech recording')
            path.write_bytes(payload)
        selected.append({"id": name[:-4], "row_index": entry['row_idx'], "corpus_id": row['id'],
                         "audio": 'audio/' + name, "sha256": sha(payload), "sentence_group": group,
                         "reference": text, "gender": row.get('gender'), "duration_seconds": seconds,
                         "role": role, "source_split": "validation", "source_dataset": "google/fleurs",
                         "language": "uz_uz", "license": "CC-BY-4.0"})
        sentences.add(group); counts[role] += 1
        print(json.dumps({"downloaded": name, "role": role, "seconds": seconds}), flush=True)
        if all(v == per_split for v in counts.values()):
            break
    if any(v != per_split for v in counts.values()):
        raise ValueError('Not enough valid recordings for the declared benchmark')
    manifest = {"format": "lingora-public-speech-benchmark-v1", "created_at": datetime.now(timezone.utc).isoformat(),
                "source": "https://huggingface.co/datasets/google/fleurs", "source_rows_sha256": sha(source),
                "attribution": "Google FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech (CC BY 4.0)",
                "selection": "First eligible rows; sentence SHA-256 parity assigns role before inference; no prediction-based selection.",
                "scope": "Lingora development/holdout split of FLEURS validation. Upstream pretraining overlap and fresh microphone performance are not established.",
                "counts": counts, "audio_uploaded": False, "examples": selected}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(counts), flush=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, default=ROOT/'private-video-work/speech-evaluation/public-v1')
    p.add_argument('--per-split', type=int, default=16)
    a = p.parse_args()
    if not 1 <= a.per_split <= 24:
        p.error('per-split must be 1..24')
    prepare(a.out, a.per_split)
