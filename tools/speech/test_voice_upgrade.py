"""Speech preprocessing, offline-cache and synthesis protocol regressions."""
import io
import json
import threading
import unittest
from unittest.mock import patch
import urllib.request
import urllib.error
import wave
import numpy as np
from speech_audio import level_audio
from server import create_server, SpeechError
from tiny_tts import TinyVocaEngine

class VoiceUpgradeTests(unittest.TestCase):
    def test_level_preserves_timing_raises_quiet_audio_and_bounds_peaks(self):
        signal=(np.sin(np.arange(16000)*.1)*.003).astype(np.float32)
        out=level_audio(signal)
        self.assertEqual(out.shape,signal.shape)
        np.testing.assert_allclose(np.diff(out),np.diff(signal)*8,atol=1e-6)
        self.assertAlmostEqual(float(out.mean()),0.,places=6)
        self.assertLessEqual(np.abs(level_audio(signal*1000)).max(),.981)
        np.testing.assert_allclose(level_audio(np.ones(100,dtype=np.float32)*.1),0,atol=1e-6)
        with self.assertRaises(ValueError):level_audio(np.array([float('nan')]))

    def test_runtime_cache_requires_only_pinned_inference_files(self):
        from nvidia_ctc import cached_model_directory
        paths=['cache/snapshot/model.int8.onnx','cache/snapshot/tokens.txt']
        with patch('huggingface_hub.hf_hub_download',side_effect=paths) as download:
            self.assertEqual(cached_model_directory().replace('\\','/'),'cache/snapshot')
        self.assertEqual([c.kwargs['filename'] for c in download.call_args_list],['model.int8.onnx','tokens.txt'])
        self.assertTrue(all(c.kwargs['local_files_only'] and c.kwargs['token'] is False for c in download.call_args_list))

    def test_tts_rejects_invalid_text_or_language_without_loading_weights(self):
        e=TinyVocaEngine()
        for text,lang in [('', 'uz'),('x'*301,'uz'),('Hello','en'),(None,'uz')]:
            with self.assertRaises(SpeechError):e.synthesize(text,lang)
        self.assertIsNone(e.model);self.assertFalse(e.lock.locked())

    def test_http_voice_returns_wav_keeps_cors_and_hides_private_failures(self):
        buffer=io.BytesIO()
        with wave.open(buffer,'wb') as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(b'\0\0'*2400)
        class Engine:
            def health(self):return {'ok':True,'task':'text-to-speech','languages':['uz']}
            def synthesize(self,text,language):
                if text=='fail':raise RuntimeError('private internal data')
                return buffer.getvalue()
        server=create_server(port=0,engine=Engine());thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base=f'http://127.0.0.1:{server.server_address[1]}'
        def request(text,origin='http://localhost:5173'):
            return urllib.request.Request(base+'/api/synthesize',data=json.dumps({'text':text,'language':'uz'}).encode(),
                headers={'Content-Type':'application/json','Origin':origin})
        try:
            with urllib.request.urlopen(request('Salom')) as response:
                self.assertEqual(response.headers['Content-Type'],'audio/wav')
                self.assertEqual(response.headers['Cache-Control'],'no-store')
                self.assertEqual(response.headers['Access-Control-Allow-Origin'],'http://localhost:5173')
                self.assertEqual(response.read(),buffer.getvalue())
            with self.assertRaises(urllib.error.HTTPError) as caught:urllib.request.urlopen(request('Salom','https://untrusted.example'))
            self.assertEqual(caught.exception.code,403)
            with self.assertRaises(urllib.error.HTTPError) as caught:urllib.request.urlopen(request('fail'))
            self.assertNotIn(b'private internal',caught.exception.read())
        finally:server.shutdown();server.server_close();thread.join(2)

if __name__=='__main__':unittest.main()
