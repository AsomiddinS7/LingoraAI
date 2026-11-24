"""Bounded Gradio payloads shared by the Space and offline protocol tests."""
import base64
import binascii
from server import MAX_BYTES, MIME_TYPES, SpeechError

class SpeechSpaceApi:
    def __init__(self, stt, tts):
        self.stt, self.tts = stt, tts

    def health(self):
        stt, tts = self.stt.health(), self.tts.health()
        stt={**stt,'model':'algorithco/stt_uz_fastconformer_hybrid_large_pc@1786554e0cdfacb8bf9076b4d9739cb81d2fbb2d'}
        return {'ok': True, 'ready': bool(stt['ready'] and tts['ready']), 'languages': ['uz'],
                'provider': 'lingora-huggingface', 'stt': stt, 'tts': tts,
                'max_audio_bytes': MAX_BYTES, 'max_audio_seconds': 30, 'max_text_characters': 300}

    def transcribe(self, payload):
        if not isinstance(payload, dict) or set(payload) != {'audio_base64','mime_type','language'}:
            raise SpeechError(400,'invalid_request','Send audio_base64, mime_type and language.')
        if payload['language'] != 'uz':
            raise SpeechError(400,'invalid_language','This speech model supports Uzbek only.')
        if not isinstance(payload['mime_type'],str) or payload['mime_type'] not in MIME_TYPES:
            raise SpeechError(415,'unsupported_audio','Unsupported recording format.')
        encoded = payload['audio_base64']
        if not isinstance(encoded, str) or not 0 < len(encoded) <= ((MAX_BYTES+2)//3)*4:
            raise SpeechError(413,'audio_too_large','Recording exceeds the audio limit.')
        try:
            audio = base64.b64decode(encoded, validate=True)
        except (ValueError,binascii.Error):
            raise SpeechError(400,'invalid_audio','Invalid audio encoding.') from None
        if not 0 < len(audio) <= MAX_BYTES:
            raise SpeechError(413,'audio_too_large','Recording exceeds the audio limit.')
        return self.stt.transcribe(audio, payload['language'])

    def synthesize(self, payload):
        if not isinstance(payload, dict) or set(payload) != {'text','language'}:
            raise SpeechError(400,'invalid_request','Send text and language.')
        audio = self.tts.synthesize(payload['text'], payload['language'])
        if not isinstance(audio,bytes) or not 44 <= len(audio) <= 2_200_000 or not audio.startswith(b'RIFF'):
            raise SpeechError(422,'invalid_synthesis','Invalid generated audio.')
        return {'audio_base64':base64.b64encode(audio).decode('ascii'),'mime_type':'audio/wav',
                'language':'uz','synthetic':True,'voice':'M2'}
