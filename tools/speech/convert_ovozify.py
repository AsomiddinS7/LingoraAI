"""Convert the original, pinned Ovozify checkpoint for local faster-whisper CPU use.

Run in a Python environment with torch, transformers<5, safetensors and ctranslate2.
Conversion uses local files only, int8 quantization, and no training or remote code.
"""
import argparse
import json
from pathlib import Path

from download_candidates import file_hash


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runtime-site", type=Path, help="Optional existing CTranslate2 site-packages directory")
    args = parser.parse_args()
    if args.runtime_site:
        import sys
        sys.path.append(str(args.runtime_site.resolve()))
    import os
    os.environ["HF_HUB_OFFLINE"] = "1"
    from ctranslate2.converters import TransformersConverter
    from transformers import WhisperTokenizerFast
    source = args.source.resolve()
    if not (source / "model.safetensors").is_file():
        raise FileNotFoundError("Original Ovozify safetensors checkpoint is required.")
    if args.output.exists():
        raise FileExistsError("Choose a new output folder; existing converted models are never overwritten.")
    converter = TransformersConverter(str(source), copy_files=["preprocessor_config.json"],
                                      load_as_float16=False, trust_remote_code=False)
    converter.convert(str(args.output), quantization="int8")
    tokenizer = WhisperTokenizerFast.from_pretrained(str(source), local_files_only=True)
    tokenizer.backend_tokenizer.save(str(args.output / "tokenizer.json"))
    report = {"source": "OvozifyLabs/whisper-small-uz-v1", "revision": "863efed858ab6ed7eda7c72119fff5af4665e0a2",
              "source_weights_sha256": file_hash(source / "model.safetensors"), "quantization": "int8",
              "training_performed": False, "audio_uploaded": False,
              "files": [{"file": p.name, "bytes": p.stat().st_size, "sha256": file_hash(p)}
                        for p in sorted(args.output.iterdir()) if p.is_file()]}
    (args.output / "conversion.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
