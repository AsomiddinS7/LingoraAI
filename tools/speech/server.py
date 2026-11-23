"""Optional, local-only microphone transcription. No recordings/transcripts are saved."""

from __future__ import annotations

import argparse
import io
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

MAX_BYTES = 10 * 1024 * 1024
MAX_SECONDS = 30
SAMPLE_RATE = 16000
DEFAULT_ORIGINS = {
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in (5173, 4173, 8787)
}
LANGUAGES = {"uz", "ru", "en"}
MIME_TYPES = {"audio/wav", "audio/x-wav", "audio/wave", "audio/webm", "audio/mp4", "audio/m4a", "audio/ogg", "video/webm", "video/mp4"}


class SpeechError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


def decode_audio(payload: bytes):
    """Decode bytes only, never a path/URL; bound decoded memory and duration."""
    import av
    import numpy as np

    parts = []
    samples = 0
    try:
        with av.open(io.BytesIO(payload)) as container:
            if not container.streams.audio:
                raise SpeechError(422, "invalid_audio", "The recording contains no audio stream.")
            stream = container.streams.audio[0]
            resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
            for frame in container.decode(stream):
                # Reject an excessively large single frame before resampling it.
                if frame.sample_rate and frame.samples / frame.sample_rate > MAX_SECONDS:
                    raise SpeechError(413, "audio_too_long", "Recordings must be at most 30 seconds.")
                for converted in resampler.resample(frame):
                    data = converted.to_ndarray().reshape(-1)
                    samples += data.size
                    if samples > MAX_SECONDS * SAMPLE_RATE:
                        raise SpeechError(413, "audio_too_long", "Recordings must be at most 30 seconds.")
                    parts.append(data)
            for converted in resampler.resample(None):
                data = converted.to_ndarray().reshape(-1)
                samples += data.size
                if samples > MAX_SECONDS * SAMPLE_RATE:
                    raise SpeechError(413, "audio_too_long", "Recordings must be at most 30 seconds.")
                parts.append(data)
    except SpeechError:
        raise
    except Exception:
        raise SpeechError(422, "invalid_audio", "The recording could not be decoded as audio.") from None
    if not parts or samples < SAMPLE_RATE // 10:
        raise SpeechError(422, "empty_audio", "Record at least 0.1 seconds of audio.")
    audio = np.concatenate(parts).astype(np.float32, copy=False)
    if not np.isfinite(audio).all():
        raise SpeechError(422, "invalid_audio", "The recording contains invalid audio samples.")
    return audio


class WhisperEngine:
    provider = "faster-whisper"
    languages = LANGUAGES

    def __init__(self, model_name: str = "small"):
        self.model_name = model_name
        self.model = None
        self.lock = threading.Lock()
        self.loading = False
        self.failed = False

    def health(self):
        return {
            "ok": True, "provider": self.provider, "model": self.model_name,
            "ready": self.model is not None, "loading": self.loading,
            "busy": self.lock.locked(), "load_failed": self.failed,
            "languages": sorted(self.languages), "max_duration_seconds": MAX_SECONDS,
        }

    def load(self):
        if self.model is not None:
            return
        self.loading = True
        try:
            self.model = self._load_model()
            self.failed = False
        except Exception:
            self.failed = True
            raise SpeechError(503, "model_unavailable", "The speech model could not load. Check installed dependencies and the model download/cache.") from None
        finally:
            self.loading = False

    def _load_model(self):
        from faster_whisper import WhisperModel
        return WhisperModel(self.model_name, device="cpu", compute_type="int8")

    def recognize(self, audio, language):
        # No script, initial prompt, expected answer, or fallback transcript.
        segments, _ = self.model.transcribe(
            audio, language=language, beam_size=5, vad_filter=True,
            condition_on_previous_text=False,
            vad_parameters={"min_silence_duration_ms": 500},
        )
        return " ".join(segment.text.strip() for segment in segments if segment.text.strip())

    def transcribe(self, payload: bytes, language: str):
        if language not in self.languages:
            raise SpeechError(400, "invalid_language", "This speech model supports: " + ", ".join(sorted(self.languages)) + ".")
        if not self.lock.acquire(blocking=False):
            raise SpeechError(503, "busy", "Local speech recognition is busy. Please retry shortly.")
        started = time.monotonic()
        try:
            audio = decode_audio(payload)
            self.load()
            text = self.recognize(audio, language)
            return {
                "text": text, "language": language,
                "duration_seconds": round(len(audio) / SAMPLE_RATE, 3),
                "processing_ms": round((time.monotonic() - started) * 1000),
                "provider": self.provider, "model": self.model_name,
            }
        finally:
            self.lock.release()


class NvidiaCtcEngine(WhisperEngine):
    provider = "nvidia-ctc"
    languages = {"uz"}

    def _load_model(self):
        from nvidia_ctc import NvidiaCtcModel
        return NvidiaCtcModel(self.model_name)

    def recognize(self, audio, language):
        return self.model.transcribe(audio)


def create_server(host="127.0.0.1", port=8790, *, engine=None, allowed_origins=None):
    """Inject a lightweight fake engine for protocol tests without importing ML dependencies."""
    engine = engine if engine is not None else WhisperEngine(os.getenv("LINGORA_STT_MODEL", "small"))
    origins = DEFAULT_ORIGINS if allowed_origins is None else set(allowed_origins)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def log_message(self, _format, *_args):
            pass

        def reply(self, status, body):
            payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            # Chrome's local-network preflight, where supported.
            if origin in origins and self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass

        def check_origin(self):
            # No-Origin calls are useful for local command-line diagnostics. Host
            # validation blocks DNS rebinding; browser cross-origin calls require allowlisting.
            hostname = (self.headers.get("Host") or "").split(":", 1)[0].lower()
            if hostname not in {"127.0.0.1", "localhost"}:
                raise SpeechError(403, "forbidden_host", "Use this service through localhost or 127.0.0.1.")
            origin = self.headers.get("Origin")
            if origin is not None and origin not in origins:
                raise SpeechError(403, "forbidden_origin", "This website is not allowed to use the local speech service.")

        def handle_error(self, error):
            if isinstance(error, SpeechError):
                self.reply(error.status, {"error": str(error), "code": error.code})
            elif isinstance(error, TimeoutError):
                self.reply(408, {"error": "Audio upload timed out.", "code": "upload_timeout"})
            else:
                # Never expose exception strings that may include private input.
                self.reply(500, {"error": "Local speech recognition failed. Check the service dependencies and retry.", "code": "transcription_failed"})

        def do_OPTIONS(self):
            try:
                self.check_origin()
                self.reply(200, {"ok": True})
            except Exception as error:
                self.handle_error(error)

        def do_GET(self):
            try:
                self.check_origin()
                if urlsplit(self.path).path != "/api/health":
                    raise SpeechError(404, "not_found", "Unknown endpoint.")
                self.reply(200, engine.health())
            except Exception as error:
                self.handle_error(error)

        def do_POST(self):
            try:
                self.check_origin()
                url = urlsplit(self.path)
                if url.path != "/api/transcribe":
                    raise SpeechError(404, "not_found", "Unknown endpoint.")
                language = parse_qs(url.query).get("language", ["uz"])[0]
                if language not in LANGUAGES:
                    raise SpeechError(400, "invalid_language", "Supported languages are uz, ru, and en.")
                mime = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                if mime not in MIME_TYPES:
                    raise SpeechError(415, "unsupported_audio", "Send WAV, WebM, Ogg, or MP4 audio bytes.")
                if self.headers.get("Transfer-Encoding"):
                    raise SpeechError(400, "invalid_upload", "Send an audio body with Content-Length.")
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    raise SpeechError(400, "invalid_upload", "Invalid Content-Length.") from None
                if length <= 0:
                    raise SpeechError(400, "empty_audio", "No microphone audio was received.")
                if length > MAX_BYTES:
                    raise SpeechError(413, "audio_too_large", "Audio must be at most 10 MiB.")
                payload = self.rfile.read(length)
                if len(payload) != length:
                    raise SpeechError(400, "incomplete_audio", "The audio upload was interrupted.")
                self.reply(200, engine.transcribe(payload, language))
            except Exception as error:
                self.handle_error(error)

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--model", default=os.getenv("LINGORA_STT_MODEL"))
    parser.add_argument("--engine", choices=["whisper", "nvidia-ctc"], default="whisper")
    parser.add_argument("--warmup", action="store_true", help="Download/load the model before accepting requests")
    parser.add_argument("--allow-origin", action="append", default=[], help="Explicitly allow an additional frontend origin")
    args = parser.parse_args()
    if args.model is None:
        if args.engine == "nvidia-ctc":
            from nvidia_ctc import cached_model_directory
            args.model = cached_model_directory()
        else:
            args.model = "small"
    engine = NvidiaCtcEngine(args.model) if args.engine == "nvidia-ctc" else WhisperEngine(args.model)
    if args.warmup:
        print(f"Loading local speech model {args.model} on CPU ({args.engine})...", flush=True)
        engine.load()
    server = create_server(port=args.port, engine=engine, allowed_origins=DEFAULT_ORIGINS | set(args.allow_origin))
    print(f"Lingora local speech: http://127.0.0.1:{args.port} (model={args.model}, ready={engine.model is not None})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
