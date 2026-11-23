"""Offline candidate benchmark. The reference is used only AFTER transcription."""
import argparse
import importlib.metadata
import json
import platform
import time
from datetime import datetime, timezone
from pathlib import Path

from download_candidates import file_hash
from evaluate import CAVEAT, NORMALIZATION, REPO, read_pcm_wav, read_script, score, write_console


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", choices=["nvidia-onnx", "ovozify"], required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--audio", type=Path, default=REPO / "private-video-work/full-speech/candidate.wav")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--no-vad", action="store_true", help="NVIDIA diagnostic only: retain raw silence behavior")
    args = parser.parse_args()
    out = args.out or REPO / "private-video-work/speech-evaluation/free-candidates" / args.candidate
    out.mkdir(parents=True, exist_ok=True)
    import numpy as np
    audio = read_pcm_wav(args.audio)
    started = time.perf_counter()
    if args.candidate == "nvidia-onnx":
        from nvidia_ctc import NvidiaCtcModel
        model = NvidiaCtcModel(args.model_dir, vad_filter=not args.no_vad)
        infer = model.transcribe
        settings = {"decoder": "CTC greedy", "quantization": "MatMul int8; convolutions float32", "threads": 4,
                    "vad_filter": not args.no_vad, "vad_behavior": "Silero speech-presence gate; waveform unchanged"}
    else:
        from faster_whisper import WhisperModel
        model = WhisperModel(str(args.model_dir), device="cpu", compute_type="int8", local_files_only=True, cpu_threads=4)
        def infer(samples):
            segments, _ = model.transcribe(samples, language="uz", beam_size=5, vad_filter=True,
                                            condition_on_previous_text=False, vad_parameters={"min_silence_duration_ms": 500})
            return " ".join(segment.text.strip() for segment in segments if segment.text.strip())
        settings = {"decoder": "Whisper beam 5", "quantization": "int8", "threads": 4,
                    "vad_filter": True, "condition_on_previous_text": False}
    load_seconds = time.perf_counter() - started
    # No reference, cue, initial prompt, hotwords, or correction are supplied to either model.
    started = time.perf_counter()
    transcript = infer(audio)
    seconds = time.perf_counter() - started
    silence = infer(np.zeros(16000, dtype=np.float32))
    # The complete-clip test is supplemented by fixed 20 s turns, independent of cue boundaries.
    turns = []
    for start in range(0, len(audio), 20 * 16000):
        samples = audio[start:start + 20 * 16000]
        before = time.perf_counter()
        text = infer(samples)
        turns.append({"start": start / 16000, "end": (start + len(samples)) / 16000,
                      "raw_transcript": text, "inference_seconds": round(time.perf_counter() - before, 4)})
    cues, script_hash = read_script(REPO / "src/data/presentation.ts")
    reference = " ".join(cues)
    runtime = {"python": platform.python_version()}
    for name in ["sherpa-onnx", "faster-whisper", "ctranslate2", "numpy"]:
        try:
            runtime[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            pass
    report = {"schema_version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
              "candidate": args.candidate, "caveat": CAVEAT, "normalization": NORMALIZATION,
              "reference_verbatim_reviewed": False, "audio_uploaded": False, "physical_microphone_tested": False,
              "runtime": runtime, "settings": {"device": "cpu", "language": "uz", "initial_prompt": None, **settings},
              "model": {"directory": str(args.model_dir), "files": [
                  {"file": path.name, "bytes": path.stat().st_size, "sha256": file_hash(path)}
                  for path in sorted(args.model_dir.iterdir()) if path.is_file()]},
              "audio": {"file": str(args.audio), "sha256": file_hash(args.audio), "seconds": len(audio) / 16000},
              "reference": {"text": reference, "script_sha256": script_hash},
              "model_load_seconds": round(load_seconds, 4),
              "speech": {"raw_transcript": transcript, "inference_seconds": round(seconds, 4),
                         "real_time_factor": round(seconds / (len(audio) / 16000), 4), "metrics": score(reference, transcript)},
              "silence": {"raw_transcript": silence, "passed_no_hallucination": not silence},
              "fixed_20s_turns": {"turns": turns, "metrics": score(reference, " ".join(t["raw_transcript"] for t in turns))}}
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    metrics = report["speech"]["metrics"]
    summary = (f"{args.candidate}: WER {metrics['wer']['rate']:.2%}; CER {metrics['cer']['rate']:.2%}\n"
               f"Inference {seconds:.3f}s for {len(audio)/16000:.3f}s audio; load {load_seconds:.3f}s\n"
               f"Silence empty: {not silence}\nRaw transcript: {transcript}\n\n{CAVEAT}\n")
    (out / "summary.txt").write_text(summary, encoding="utf-8")
    write_console(summary)


if __name__ == "__main__":
    main()
