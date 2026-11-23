"""Reproducible offline Whisper evaluation; never supplies expected text to STT.

Run from the repository root:
  .venv-stt/Scripts/python.exe tools/speech/evaluate.py
  .venv-stt/Scripts/python.exe tools/speech/evaluate.py --models small large-v3-turbo

Models are loaded with local_files_only=True: this tool never downloads models.
The default reference is the user's intended script, NOT verified verbatim ground truth.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.metadata
import json
import platform
import re
import sys
import time
import unicodedata
import wave
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
NORMALIZATION = (
    "Unicode NFKC and casefold; Uzbek apostrophe variants map to ASCII apostrophe; "
    "apostrophes are preserved only inside alphanumeric words (o'g'li stays o'g'li); "
    "other punctuation, including hyphens, becomes spaces; whitespace collapses. "
    "WER uses whitespace-delimited tokens; CER excludes spaces but retains internal apostrophes. "
    "No transliteration, spelling correction, script hints, or expected-text prompts."
)
APOSTROPHES = "'’‘ʻʼʽʹ`´＇"
CAVEAT = (
    "Reference text is the user's intended presentation script, not a manually verified "
    "verbatim transcript of the recording. Spoken deviations and segmentation differences "
    "can contribute to errors. These provisional script-comparison scores are not "
    "validated Uzbek language accuracy, signer recognition accuracy, or physical-microphone testing."
)


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def write_console(text: str, stream=None):
    """Preserve Unicode reports on Windows terminals; avoid failing after files save."""
    target = stream if stream is not None else sys.stdout
    if hasattr(target, "reconfigure"):
        try:
            target.reconfigure(encoding="utf-8", errors="backslashreplace")
        except (OSError, ValueError):
            pass
    try:
        print(text, file=target)
    except UnicodeEncodeError:
        # Some embedded/captured streams cannot be reconfigured. Only console
        # display is escaped; the saved JSON/TXT and raw transcripts stay UTF-8.
        encoding = getattr(target, "encoding", None) or "utf-8"
        print(text.encode(encoding, errors="backslashreplace").decode(encoding), file=target)


def normalize(text: str) -> str:
    text = text.translate(str.maketrans({character: "'" for character in APOSTROPHES}))
    text = unicodedata.normalize("NFKC", text).casefold()
    result = []
    for index, character in enumerate(text):
        if character.isalnum():
            result.append(character)
        elif character == "'" and 0 < index < len(text) - 1 and text[index - 1].isalnum() and text[index + 1].isalnum():
            result.append(character)
        else:
            result.append(" ")
    return " ".join("".join(result).split())


def edit_counts(reference, hypothesis):
    """Levenshtein S/D/I counts; ties prefer substitution, then deletion, then insertion."""
    previous = [(j, 0, 0, j) for j in range(len(hypothesis) + 1)]
    for i, expected in enumerate(reference, 1):
        current = [(i, 0, i, 0)]
        for j, actual in enumerate(hypothesis, 1):
            if expected == actual:
                current.append(previous[j - 1])
                continue
            cost, substitutions, deletions, insertions = previous[j - 1]
            substitution = (cost + 1, substitutions + 1, deletions, insertions)
            cost, substitutions, deletions, insertions = previous[j]
            deletion = (cost + 1, substitutions, deletions + 1, insertions)
            cost, substitutions, deletions, insertions = current[j - 1]
            insertion = (cost + 1, substitutions, deletions, insertions + 1)
            current.append(min((substitution, deletion, insertion), key=lambda value: value[0]))
        previous = current
    errors, substitutions, deletions, insertions = previous[-1]
    return {
        "reference_units": len(reference), "hypothesis_units": len(hypothesis),
        "substitutions": substitutions, "deletions": deletions, "insertions": insertions,
        "errors": errors,
        # Error rate with an empty reference is undefined if insertions occur.
        "rate": errors / len(reference) if reference else (0.0 if not hypothesis else None),
    }


def score(reference: str, hypothesis: str):
    expected, actual = normalize(reference), normalize(hypothesis)
    return {
        "reference_normalized": expected, "hypothesis_normalized": actual,
        "wer": edit_counts(expected.split(), actual.split()),
        "cer": edit_counts(expected.replace(" ", ""), actual.replace(" ", "")),
        "exact_normalized_match": expected == actual,
    }


def read_script(path: Path):
    """Read a UTF-8 JSON string/list or the checked-in single-quoted cue array."""
    payload = path.read_bytes()
    text = payload.decode("utf-8-sig")
    if path.suffix.lower() == ".json":
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("cues", data.get("text"))
        cues = [data] if isinstance(data, str) else data
    else:
        array = re.search(r"PRESENTATION_CUES\s*=\s*\[(.*?)\]\s*as const", text, re.S)
        if not array:
            raise ValueError("Cannot locate PRESENTATION_CUES; provide --script as a JSON string or list.")
        cues = [ast.literal_eval(value) for value in re.findall(r"^\s*('(?:\\.|[^'\\])*')\s*,?\s*$", array.group(1), re.M)]
    if not isinstance(cues, list) or not cues or not all(isinstance(cue, str) and cue.strip() for cue in cues):
        raise ValueError("Expected a nonempty JSON list of text cues or presentation script.")
    return cues, sha256(payload)


def read_pcm_wav(path: Path):
    """Known local PCM WAV → float32, avoiding incompatible PyAV filename decoding."""
    import numpy as np
    with wave.open(str(path), "rb") as recording:
        if recording.getnchannels() != 1 or recording.getsampwidth() != 2 or recording.getframerate() != 16000:
            raise ValueError("Evaluation input must be mono PCM16 WAV at 16000 Hz.")
        if recording.getnframes() > 16000 * 600:
            raise ValueError("Evaluation input is limited to ten minutes.")
        pcm = recording.readframes(recording.getnframes())
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def cached_models():
    cache = Path.home() / ".cache" / "huggingface" / "hub"
    return sorted(path.name for path in cache.glob("models--*faster-whisper*"))


def versions():
    result = {"python": platform.python_version(), "platform": platform.platform()}
    for package in ("faster-whisper", "ctranslate2", "numpy", "av", "onnxruntime"):
        try:
            result[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            result[package] = None
    return result


def transcribe(model, audio):
    started = time.perf_counter()
    segments, info = model.transcribe(
        audio, language="uz", beam_size=5, vad_filter=True,
        condition_on_previous_text=False, vad_parameters={"min_silence_duration_ms": 500},
    )
    rows = [{"start": segment.start, "end": segment.end, "text": segment.text} for segment in segments]
    seconds = time.perf_counter() - started
    return {
        "raw_transcript": " ".join(row["text"].strip() for row in rows), "segments": rows,
        "inference_seconds": round(seconds, 4), "audio_seconds": info.duration,
        "real_time_factor": round(seconds / info.duration, 4) if info.duration else None,
    }


def reused_transcription(path: Path, audio_seconds: float):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("language") != "uz" or "initial_prompt" not in data or data["initial_prompt"] is not None:
        raise ValueError("Reused result must explicitly use Uzbek with no initial prompt.")
    if abs(data.get("duration_seconds", 0) - audio_seconds) > 0.05:
        raise ValueError("Reused transcription duration does not match audio.")
    rows = data["segments"]
    return {
        "raw_transcript": " ".join(row["text"].strip() for row in rows), "segments": rows,
        "inference_seconds": None,
        "prior_recorded_wall_seconds": data.get("wall_seconds"),
        "audio_seconds": audio_seconds, "real_time_factor": None,
        "provenance": "Reused prior actual transcription; not rerun. Original record lacks input hash, so source identity relies on matching local filename/duration and operator provenance.",
        "prior_output_sha256": sha256(path.read_bytes()), "model": data.get("model"),
    }


def build_summary(report):
    lines = ["Lingora local STT evaluation", "", CAVEAT, "", f"Normalization: {NORMALIZATION}", ""]
    for result in report["results"]:
        name = result["model"]
        if result["status"] != "ok":
            lines.append(f"{name}: unavailable locally; no model downloaded.")
            continue
        speech = result["speech"]
        metrics = speech["metrics"]
        lines.extend([
            f"{name}: WER {metrics['wer']['rate']:.2%}; CER {metrics['cer']['rate']:.2%} (provisional script comparison)",
            f"Speech duration {speech['audio_seconds']:.3f}s; inference {speech['inference_seconds']}s; model load {result['model_load_seconds']}s.",
            f"Silence empty: {result['silence']['raw_transcript'] == ''}; physical microphone tested: false.",
            f"Raw transcript: {speech['raw_transcript']}", "",
        ])
    return "\n".join(lines)


def browser_hypotheses(data):
    """Extract saved diagnostic outputs verbatim; never trim using expected text."""
    if not isinstance(data, dict):
        raise ValueError("Browser report must be a JSON object.")
    rows = data.get("results", [data])
    if not isinstance(rows, list) or not rows or not all(isinstance(row, dict) for row in rows):
        raise ValueError("Browser report results must contain JSON objects.")
    results = []
    for row in rows:
        if "transcript" in row:
            text = row["transcript"]
            if not isinstance(text, str):
                raise ValueError("Browser transcript must be a string.")
            source_field = "transcript"
        elif "finalMessages" in row:
            messages = row["finalMessages"]
            if not isinstance(messages, list) or not all(isinstance(message, str) for message in messages):
                raise ValueError("Browser finalMessages must be a list of strings.")
            text = " ".join(messages)
            source_field = "finalMessages joined with one space"
        else:
            text = None
            source_field = None
        metadata = {key: value for key, value in row.items() if key not in {"transcript", "finalMessages", "events"}}
        results.append({"raw_transcript": text, "source_field": source_field, "diagnostic_metadata": metadata})
    return results


def score_browser_report(path: Path, script_path: Path, audio_path: Path, out: Path):
    cues, script_hash = read_script(script_path)
    expected = " ".join(cues)
    payload = path.read_bytes()
    diagnostic = json.loads(payload.decode("utf-8-sig"))
    rows = browser_hypotheses(diagnostic)
    for row in rows:
        text = row["raw_transcript"]
        row["status"] = "missing_transcript" if text is None else ("empty_transcript" if not text.strip() else "scored")
        row["metrics"] = score(expected, text) if text is not None else None
    report = {
        "schema_version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
        "evaluation": "saved actual browser output compared to intended user script",
        "provenance": "Scores saved diagnostic output only; browser recognition was not rerun by this scoring command. No transcript tail, repetition, or words were removed using the reference.",
        "caveat": CAVEAT, "normalization": NORMALIZATION,
        "reference_verbatim_reviewed": False, "physical_microphone_tested": False,
        "reference": {"script_file": str(script_path), "file_sha256": script_hash, "cues": cues, "text": expected},
        "hypothesis_report": {"file": str(path), "sha256": sha256(payload), "note": diagnostic.get("note")},
        "declared_audio": {"file": str(audio_path), "sha256": sha256(audio_path.read_bytes()) if audio_path.exists() else None,
                           "association_caveat": "Declared by operator; saved browser reports may not contain an audio hash. Check source filename, complete clip coverage, no-loop setting, and test timing before comparing providers."},
        "results": rows,
    }
    out.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w.-]", "_", path.stem)
    target = out / f"browser-{stem}-scores.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["Saved browser STT scoring", "", CAVEAT, ""]
    for index, row in enumerate(rows):
        name = row["diagnostic_metadata"].get("channel", f"result-{index}")
        if row["metrics"] is None:
            lines.append(f"{name}: no transcript field; diagnostic failure, not scored.")
        else:
            metrics = row["metrics"]
            lines.append(f"{name}: WER {metrics['wer']['rate']:.2%}; CER {metrics['cer']['rate']:.2%}; status {row['status']} (provisional script comparison)")
            lines.append(f"Raw transcript: {row['raw_transcript']}")
    lines.extend(["", f"Scores: {target}"])
    summary = "\n".join(lines)
    target.with_suffix(".txt").write_text(summary, encoding="utf-8")
    write_console(summary)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", type=Path, default=REPO / "private-video-work/full-speech/candidate.wav")
    parser.add_argument("--script", type=Path, default=REPO / "src/data/presentation.ts")
    parser.add_argument("--out", type=Path, default=REPO / "private-video-work/speech-evaluation")
    parser.add_argument("--models", nargs="+", default=["small"])
    parser.add_argument("--reuse-transcript", type=Path, help="Reuse one prior actual transcription instead of rerunning speech; silence is still tested live")
    parser.add_argument("--hypothesis-report", type=Path, help="Score an existing actual browser results JSON instead of running Whisper; writes a separate artifact")
    args = parser.parse_args(argv)
    if args.hypothesis_report:
        score_browser_report(args.hypothesis_report, args.script, args.audio, args.out)
        return 0
    cues, script_hash = read_script(args.script)
    reference = " ".join(cues)
    audio = read_pcm_wav(args.audio)
    audio_hash = sha256(args.audio.read_bytes())
    args.out.mkdir(parents=True, exist_ok=True)
    silence_path = args.out / "silence-1s.wav"
    with wave.open(str(silence_path), "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000)
        output.writeframes(b"\0\0" * 16000)
    silence = read_pcm_wav(silence_path)
    report = {
        "schema_version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
        "evaluation": "provisional comparison to intended user script", "reference_verbatim_reviewed": False,
        "caveat": CAVEAT, "normalization": NORMALIZATION,
        "physical_microphone_tested": False, "tts_tested": False,
        "runtime": versions(), "cached_model_directories": cached_models(),
        "settings": {"device": "cpu", "compute_type": "int8", "language": "uz", "beam_size": 5,
                     "vad_filter": True, "condition_on_previous_text": False, "initial_prompt": None,
                     "local_files_only": True, "speech_sample_scope": "complete recording, offline PCM array (HTTP endpoint is limited to 30 seconds)"},
        "reference": {"script_file": str(args.script), "file_sha256": script_hash, "cues": cues, "text": reference},
        "samples": [
            {"id": "candidate-presentation-full", "file": str(args.audio), "sha256": audio_hash, "duration_seconds": len(audio) / 16000},
            {"id": "silence-1s", "file": str(silence_path), "sha256": sha256(silence_path.read_bytes()), "duration_seconds": 1},
        ], "results": [],
    }
    from faster_whisper import WhisperModel
    for model_name in args.models:
        started = time.perf_counter()
        try:
            model = WhisperModel(model_name, device="cpu", compute_type="int8", local_files_only=True)
        except Exception as error:
            report["results"].append({"model": model_name, "status": "unavailable", "error_type": type(error).__name__,
                                      "reason": "Model could not be loaded using local files only; not downloaded."})
            continue
        result = {"model": model_name, "status": "ok", "model_load_seconds": round(time.perf_counter() - started, 4)}
        if args.reuse_transcript:
            speech = reused_transcription(args.reuse_transcript, len(audio) / 16000)
            if speech["model"] != model_name:
                raise ValueError("A reused transcription can only score its original model.")
        else:
            speech = transcribe(model, audio)
            speech["provenance"] = "Actual fresh inference on the WAV identified by SHA-256."
        speech["sample_id"] = "candidate-presentation-full"
        speech["metrics"] = score(reference, speech["raw_transcript"])
        result["speech"] = speech
        silence_result = transcribe(model, silence)
        silence_result["sample_id"] = "silence-1s"
        silence_result["metrics"] = score("", silence_result["raw_transcript"])
        silence_result["passed_no_hallucination"] = silence_result["raw_transcript"] == ""
        result["silence"] = silence_result
        report["results"].append(result)
        del model
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = build_summary(report)
    (args.out / "summary.txt").write_text(summary, encoding="utf-8")
    write_console(summary)
    write_console(f"Report: {args.out / 'report.json'}")
    return 0 if any(result["status"] == "ok" for result in report["results"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
