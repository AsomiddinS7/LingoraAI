"""Backend contract tests independent of downloaded model weights."""
import unittest
from unittest.mock import patch

from server import NvidiaCtcEngine, SpeechError, WhisperEngine


class EngineContracts(unittest.TestCase):
    def test_nvidia_rejects_other_languages_before_loading_or_decoding(self):
        engine = NvidiaCtcEngine("not-loaded")
        with self.assertRaises(SpeechError) as caught:
            engine.transcribe(b"not-audio", "ru")
        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(caught.exception.code, "invalid_language")
        self.assertIsNone(engine.model)
        self.assertFalse(engine.lock.locked())
        self.assertEqual(engine.health()["languages"], ["uz"])
        self.assertEqual(engine.health()["provider"], "nvidia-ctc")
        self.assertEqual(WhisperEngine().health()["languages"], ["en", "ru", "uz"])

    def test_failed_load_can_recover_without_exposing_private_exception_details(self):
        engine = NvidiaCtcEngine("not-loaded")
        with patch.object(engine, "_load_model", side_effect=RuntimeError("private filesystem detail")):
            with self.assertRaises(SpeechError) as caught:
                engine.load()
        self.assertNotIn("private filesystem detail", str(caught.exception))
        self.assertTrue(engine.health()["load_failed"])
        self.assertFalse(engine.health()["loading"])
        with patch.object(engine, "_load_model", return_value=object()):
            engine.load()
        self.assertTrue(engine.health()["ready"])
        self.assertFalse(engine.health()["load_failed"])


if __name__ == "__main__":
    unittest.main()
