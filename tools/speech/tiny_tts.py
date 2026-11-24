"""Optional CPU Uzbek neural TTS. Input text and generated speech stay in memory."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import threading
import wave

from download_tts import DEFAULT_DIRECTORY, FILES, REPO, REVISION
from server import SpeechError

MAX_TEXT = 300

class TinyVocaEngine:
    provider = 'tiny-voca'
    languages = {'uz'}

    def __init__(self, directory=DEFAULT_DIRECTORY):
        self.directory = Path(directory)
        self.model_name = f'{REPO}@{REVISION}'
        self.model = None
        self.lock = threading.Lock()
        self.loading = False
        self.failed = False

    def health(self):
        return {'ok': True, 'provider': self.provider, 'model': self.model_name, 'task': 'text-to-speech',
                'ready': self.model is not None, 'loading': self.loading, 'load_failed': self.failed,
                'busy': self.lock.locked(), 'languages': ['uz'], 'max_text_characters': MAX_TEXT,
                'voice': 'M2 (synthetic)', 'sample_rate': 24000}

    def load(self):
        if self.model is not None:
            return
        self.loading = True
        try:
            manifest = json.loads((self.directory/'download-manifest.json').read_text())
            if manifest['repo_id'] != REPO or manifest['revision'] != REVISION:
                raise ValueError('Wrong TTS model revision')
            hashes = {r['file']: r['sha256'] for r in manifest['files']}
            for name in FILES:
                if hashlib.sha256((self.directory/name).read_bytes()).hexdigest() != hashes[name]:
                    raise ValueError('TTS checkpoint/runtime hash mismatch')
            import torch
            torch.set_num_threads(4)
            sys.path.insert(0, str(self.directory/'src'))
            from tiny_voca.infer import load_model, speak_text
            spec = importlib.util.spec_from_file_location('lingora_uzbek_normalize', self.directory/'uzbek_normalize.py')
            normalizer = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(normalizer)
            self.normalize = normalizer.normalize
            self.speak_text = speak_text
            # The reviewed upstream loader uses torch.load(weights_only=True).
            self.model = load_model(self.directory/'inference.pt', device='cpu')
            self.failed = False
        except Exception:
            self.failed = True
            raise SpeechError(503, 'model_unavailable', 'Download the pinned TTS model and install its optional CPU dependencies.') from None
        finally:
            self.loading = False

    def synthesize(self, text, language):
        if language != 'uz':
            raise SpeechError(400, 'invalid_language', 'The local neural voice supports Uzbek only.')
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT or any(ord(c) < 32 and not c.isspace() for c in text):
            raise SpeechError(400, 'invalid_text', f'Send 1 to {MAX_TEXT} characters of Uzbek text.')
        if not self.lock.acquire(blocking=False):
            raise SpeechError(503, 'busy', 'The local voice is busy. Please retry shortly.')
        try:
            self.load()
            import numpy as np
            import torch
            spoken = self.normalize(text.strip(), mode='infer')
            with torch.inference_mode():
                output, _ = self.speak_text(self.model, spoken, 'M2', speed=1.0, seed=42)
            samples = output.detach().cpu().numpy()
            if not len(samples) or len(samples) > 24000 * 45 or not np.isfinite(samples).all():
                raise SpeechError(422, 'invalid_synthesis', 'The voice could not produce bounded speech for this text.')
            pcm = (np.clip(samples, -1, 1) * 32767).round().astype('<i2').tobytes()
            buffer = io.BytesIO()
            with wave.open(buffer, 'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(pcm)
            return buffer.getvalue()
        finally:
            self.lock.release()
