"""Offline inference for the documented NVIDIA Uzbek CTC ONNX conversion."""
from pathlib import Path


def cached_model_directory():
    from huggingface_hub import hf_hub_download
    # Loading/starting the service never silently downloads a checkpoint.
    # Newer hub clients reject a deliberately partial snapshot if unrelated NeMo
    # source weights are absent. Resolve only the two actual runtime files.
    paths = [Path(hf_hub_download(
        repo_id="algorithco/stt_uz_fastconformer_hybrid_large_pc", filename=name,
        revision="1786554e0cdfacb8bf9076b4d9739cb81d2fbb2d",
        local_files_only=True, token=False,
    )) for name in ('model.int8.onnx', 'tokens.txt')]
    if paths[0].parent != paths[1].parent:
        raise ValueError('Speech weights and tokens must use the same pinned snapshot')
    return str(paths[0].parent)


class NvidiaCtcModel:
    def __init__(self, directory, threads=4, vad_filter=True, preprocessing='raw'):
        import sherpa_onnx
        self.directory = Path(directory)
        self.vad_filter = vad_filter
        if preprocessing not in {'raw', 'trim', 'level'}:
            raise ValueError('Unknown speech preprocessing profile')
        self.preprocessing = preprocessing
        model = self.directory / "model.int8.onnx"
        tokens = self.directory / "tokens.txt"
        if not model.is_file() or not tokens.is_file():
            raise FileNotFoundError("Download the pinned NVIDIA ONNX model and matching tokens first.")
        self.recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=str(model), tokens=str(tokens), sample_rate=16000,
            feature_dim=80, num_threads=threads, decoding_method="greedy_search", provider="cpu",
        )

    def transcribe(self, audio):
        if self.preprocessing == 'level':
            from speech_audio import level_audio
            audio = level_audio(audio)
        if self.vad_filter:
            from faster_whisper.vad import VadOptions, get_speech_timestamps
            # Gate silence using audio alone. Keep the original waveform for
            # recognition so filtering cannot splice words or alter timing.
            regions = get_speech_timestamps(audio, VadOptions(min_silence_duration_ms=500), sampling_rate=16000)
            if not regions:
                return ""
            if self.preprocessing in {'trim', 'level'}:
                # Keep every sample between first/last speech; do not splice
                # internal pauses or use any expected text to choose boundaries.
                start = max(0, regions[0]['start'] - 3200)
                end = min(len(audio), regions[-1]['end'] + 3200)
                audio = audio[start:end]
        stream = self.recognizer.create_stream()
        stream.accept_waveform(16000, audio)
        self.recognizer.decode_stream(stream)
        return stream.result.text.strip()
