import base64
import unittest
from unittest.mock import Mock
from server import SpeechError
from space_api import SpeechSpaceApi

class SpeechSpaceTests(unittest.TestCase):
    def setUp(self):
        self.stt=Mock();self.tts=Mock();self.api=SpeechSpaceApi(self.stt,self.tts)
    def test_uploaded_audio_bytes_are_forwarded_unchanged(self):
        self.stt.transcribe.return_value={'text':'Salom.','language':'uz'}
        result=self.api.transcribe({'audio_base64':base64.b64encode(b'recording').decode(),'mime_type':'audio/webm','language':'uz'})
        self.stt.transcribe.assert_called_once_with(b'recording','uz');self.assertEqual(result['text'],'Salom.')
    def test_invalid_encoding_mime_and_language_never_reach_a_model(self):
        valid={'audio_base64':'YQ==','mime_type':'audio/wav','language':'uz'}
        for changes in [{'audio_base64':'@@@'},{'audio_base64':''},{'mime_type':[]},{'mime_type':'text/html'},{'language':'ru'},{'url':'https://elsewhere'}]:
            with self.assertRaises(SpeechError):self.api.transcribe({**valid,**changes})
        self.stt.transcribe.assert_not_called()
    def test_voice_is_encoded_without_saving_a_public_file(self):
        self.tts.synthesize.return_value=b'RIFF'+b'x'*50
        result=self.api.synthesize({'text':'Salom.','language':'uz'})
        self.assertEqual(base64.b64decode(result['audio_base64']),self.tts.synthesize.return_value)
        self.assertEqual(result['mime_type'],'audio/wav');self.assertTrue(result['synthetic'])
    def test_readiness_reflects_both_models_without_exposing_cache_paths(self):
        self.stt.health.return_value={'ready':True,'model':'private/cache/path'}
        self.tts.health.return_value={'ready':False}
        status=self.api.health();self.assertFalse(status['ready']);self.assertNotIn('private/cache',str(status))

if __name__=='__main__':unittest.main()
