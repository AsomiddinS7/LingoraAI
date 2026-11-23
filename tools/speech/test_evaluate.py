"""Metric/reference tests; deliberately require no Whisper/native packages."""

import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("speech_evaluate", Path(__file__).with_name("evaluate.py"))
evaluate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluate)


class EvaluationTests(unittest.TestCase):
    def test_uzbek_apostrophe_variants_case_and_punctuation(self):
        expected = "O'ZBEK, g‘isht; sun’iy oʻgʻil OʼGʼLI!"
        self.assertEqual(evaluate.normalize(expected), "o'zbek g'isht sun'iy o'g'il o'g'li")
        self.assertEqual(evaluate.score("Imo-ishora: ‘SALOM’!", "imo ishora salom")["wer"]["rate"], 0)

    def test_apostrophe_is_not_silently_removed_from_uzbek_words(self):
        self.assertNotEqual(evaluate.normalize("o‘q"), evaluate.normalize("oq"))

    def test_independent_substitution_deletion_and_insertion_counts(self):
        self.assertEqual(evaluate.edit_counts(["salom"], ["rahmat"])["substitutions"], 1)
        self.assertEqual(evaluate.edit_counts(["a", "b"], ["a"])["deletions"], 1)
        self.assertEqual(evaluate.edit_counts(["a"], ["a", "b"])["insertions"], 1)

    def test_known_wer_and_cer(self):
        result = evaluate.score("salom dunyo", "salom duny")
        self.assertEqual(result["wer"]["rate"], 0.5)
        self.assertEqual(result["cer"]["rate"], 0.1)
        self.assertEqual(result["cer"]["deletions"], 1)

    def test_empty_reference_and_silence(self):
        self.assertEqual(evaluate.score("", "")["wer"]["rate"], 0)
        hallucination = evaluate.score("", "salom")["wer"]
        self.assertIsNone(hallucination["rate"])
        self.assertEqual(hallucination["insertions"], 1)
        self.assertEqual(evaluate.score("salom", "")["wer"]["rate"], 1)

    def test_wer_can_exceed_one_when_there_are_many_insertions(self):
        self.assertEqual(evaluate.score("a", "x y z")["wer"]["rate"], 3)

    def test_user_script_cues_are_read_without_executing_typescript(self):
        cues, digest = evaluate.read_script(evaluate.REPO / "src/data/presentation.ts")
        self.assertEqual(len(cues), 6)
        self.assertEqual(cues[0], "Assalomu alaykum!")
        self.assertIn("sun’iy", cues[1])
        self.assertEqual(len(digest), 64)

    def test_json_reference_accepts_strings_or_cue_lists(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "script.json"
            path.write_text('["Salom", "Rahmat"]', encoding="utf-8")
            self.assertEqual(evaluate.read_script(path)[0], ["Salom", "Rahmat"])
            path.write_text('"Salom"', encoding="utf-8")
            self.assertEqual(evaluate.read_script(path)[0], ["Salom"])
            path.write_text('[null]', encoding="utf-8")
            with self.assertRaises(ValueError):
                evaluate.read_script(path)

    def test_browser_results_extract_original_transcript_without_removing_repeated_tail(self):
        original = "  Salom. Rahmat! Salom.  "
        rows = evaluate.browser_hypotheses({"results": [{"channel": "chrome", "transcript": original}]})
        self.assertEqual(rows[0]["raw_transcript"], original)
        metrics = evaluate.score("Salom. Rahmat!", rows[0]["raw_transcript"])
        self.assertEqual(metrics["wer"]["insertions"], 1)

    def test_browser_final_messages_fallback_and_explicit_empty_transcript(self):
        rows = evaluate.browser_hypotheses({"finalMessages": ["Salom", "Rahmat"]})
        self.assertEqual(rows[0]["raw_transcript"], "Salom Rahmat")
        rows = evaluate.browser_hypotheses({"results": [{"transcript": "", "finalMessages": ["other"]}]})
        self.assertEqual(rows[0]["raw_transcript"], "")

    def test_browser_diagnostic_failure_is_not_an_invented_empty_transcript(self):
        rows = evaluate.browser_hypotheses({"results": [{"diagnosticFailure": "browser did not start"}]})
        self.assertIsNone(rows[0]["raw_transcript"])
        with self.assertRaises(ValueError):
            evaluate.browser_hypotheses({"transcript": 3})
        with self.assertRaises(ValueError):
            evaluate.browser_hypotheses({"finalMessages": [None]})

    def test_windows_cp1252_stdout_is_reconfigured_to_utf8_without_changing_text(self):
        buffer = io.BytesIO()
        output = io.TextIOWrapper(buffer, encoding="cp1252", newline="\n")
        text = "Raw transcript: teхnologiya, o‘qish, ўзбек"
        evaluate.write_console(text, output)
        output.flush()
        self.assertEqual(output.encoding, "utf-8")
        self.assertEqual(buffer.getvalue().decode("utf-8"), text + "\n")
        output.detach()

    def test_nonreconfigurable_legacy_stdout_escapes_display_only(self):
        class LegacyOutput:
            encoding = "cp1252"
            def __init__(self):
                self.value = ""
            def write(self, text):
                text.encode(self.encoding)
                self.value += text
        output = LegacyOutput()
        evaluate.write_console("teхnologiya", output)
        self.assertEqual(output.value, "te\\u0445nologiya\n")


if __name__ == "__main__":
    unittest.main()
