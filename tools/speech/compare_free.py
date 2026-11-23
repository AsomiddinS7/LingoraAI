"""Summarize actual saved model runs; fail if source audio or reference differs."""
import json
from pathlib import Path

from download_candidates import file_hash
from evaluate import CAVEAT, REPO, write_console


def main():
    root = REPO / "private-video-work/speech-evaluation"
    output = root / "free-candidates"
    nvidia = json.loads((output / "nvidia-onnx-vad/report.json").read_text(encoding="utf-8"))
    audio_hash = nvidia["audio"]["sha256"]
    reference_hash = nvidia["reference"]["script_sha256"]
    rows, sources = [], []
    for name, path in [("NVIDIA Uzbek CTC ONNX + Silero", output / "nvidia-onnx-vad/report.json"),
                       ("Ovozify original -> CTranslate2 int8", output / "ovozify/report.json")]:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["audio"]["sha256"] != audio_hash or data["reference"]["script_sha256"] != reference_hash:
            raise ValueError("Candidate audio/reference mismatch: " + name)
        rows.append({"model": name, "wer": data["speech"]["metrics"]["wer"]["rate"],
                     "cer": data["speech"]["metrics"]["cer"]["rate"],
                     "inference_seconds": data["speech"]["inference_seconds"],
                     "silence_empty": data["silence"]["passed_no_hallucination"],
                     "fixed_20s_wer": data["fixed_20s_turns"]["metrics"]["wer"]["rate"],
                     "fixed_20s_cer": data["fixed_20s_turns"]["metrics"]["cer"]["rate"],
                     "max_turn_inference_seconds": max(t["inference_seconds"] for t in data["fixed_20s_turns"]["turns"]),
                     "run": "fresh local benchmark"})
        sources.append({"file": str(path), "sha256": file_hash(path)})
    browser = root / "browser-quality-full-noloop-scores.json"
    data = json.loads(browser.read_text(encoding="utf-8"))
    if data["declared_audio"]["sha256"] != audio_hash or data["reference"]["file_sha256"] != reference_hash:
        raise ValueError("Browser baseline source/reference mismatch")
    metrics = data["results"][0]["metrics"]
    browser_provenance = data["declared_audio"]["association_caveat"]
    rows.append({"model": "Chrome native Uzbek STT", "wer": metrics["wer"]["rate"], "cer": metrics["cer"]["rate"],
                 "inference_seconds": None, "silence_empty": None, "run": "previous actual browser test; saved baseline, not rerun"})
    sources.append({"file": str(browser), "sha256": file_hash(browser)})
    for label, path in [("Generic Whisper small", root / "report.json"), ("Generic Whisper large-v3-turbo", root / "turbo/report.json")]:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["samples"][0]["sha256"] != audio_hash or data["reference"]["file_sha256"] != reference_hash:
            raise ValueError("Whisper baseline source/reference mismatch")
        result = data["results"][0]
        metrics = result["speech"]["metrics"]
        rows.append({"model": label, "wer": metrics["wer"]["rate"], "cer": metrics["cer"]["rate"],
                     "inference_seconds": result["speech"]["inference_seconds"],
                     "silence_empty": result["silence"]["passed_no_hallucination"], "run": "previous actual local test; saved baseline, not rerun"})
        sources.append({"file": str(path), "sha256": file_hash(path)})
    winner = rows[0]
    eligible = winner["wer"] < rows[2]["wer"] and winner["cer"] < rows[2]["cer"] and winner["silence_empty"]
    report = {"audio_sha256": audio_hash, "script_sha256": reference_hash, "caveat": CAVEAT,
              "source_reports": sources, "results": rows,
              "decision": "Use NVIDIA CTC + speech gate for this local demo" if eligible else "Keep prior default",
              "decision_scope": "Single recording and intended-script comparison; no general Uzbek accuracy claim",
              "browser_provenance_caveat": browser_provenance}
    (output / "comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["Free Uzbek STT comparison", "", CAVEAT, ""]
    for row in rows:
        timing = f"{row['inference_seconds']}s" if row['inference_seconds'] is not None else "not measured"
        lines.append(f"{row['model']}: WER {row['wer']:.2%}; CER {row['cer']:.2%}; inference {timing}; {row['run']}.")
    lines.extend(["", report["decision"], "", "Browser timing/silence are not measured here. Native browser audio may be processed remotely; candidate inference is local."])
    summary = "\n".join(lines)
    (output / "comparison.txt").write_text(summary, encoding="utf-8")
    write_console(summary)


if __name__ == "__main__":
    main()
