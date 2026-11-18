"""Sentence and simplify providers. The real prompts and Azure OpenAI calls belong to the ML team
(section 3); until they plug theirs in, a placeholder provider follows the same contract and marks
its output [PLACEHOLDER]. The name is data inserted into the output, never into prompt text."""
from __future__ import annotations

import re
from typing import Protocol

from .schemas import SentenceIn, SimplifyIn

MY_NAME = {"en": "My name is {name}", "ru": "Меня зовут {name}", "uz": "Mening ismim {name}"}


class SentenceProvider(Protocol):
    is_placeholder: bool

    def compose(self, req: SentenceIn, labels: dict[str, dict]) -> dict: ...

    def simplify(self, req: SimplifyIn, phrases: list[tuple[str, dict]]) -> dict: ...


class PlaceholderProvider:
    is_placeholder = True

    def compose(self, req: SentenceIn, labels: dict[str, dict]) -> dict:
        parts = []
        for s in req.signs:
            if s.label == "my_name" and req.name:
                parts.append(MY_NAME[req.language].replace("{name}", req.name))
            else:
                parts.append(labels.get(s.label, {}).get(req.language, s.label))
        words = ", ".join(parts)
        text = "[PLACEHOLDER] " + words[:1].upper() + words[1:] + ("?" if req.face_hints and req.face_hints.question else ".")
        return {"status": "ok", "sentence": text, "language": req.language, "needs_human": False}

    def simplify(self, req: SimplifyIn, phrases: list[tuple[str, dict]]) -> dict:
        first = re.split(r"(?<=[.!?])\s+", req.text)[0]
        words = first.split()
        short = " ".join(words[:12]) + (" …" if len(words) > 12 else "")
        low = req.text.lower()
        matches = [slug for slug, texts in phrases if any(t.lower().strip(".!?… ") in low for t in texts.values())]
        return {"status": "ok", "simplified": "[PLACEHOLDER] " + short, "phrasebook_matches": matches or ["please_repeat"]}


_provider: SentenceProvider = PlaceholderProvider()


def provider() -> SentenceProvider:
    return _provider


def set_provider(p: SentenceProvider) -> None:
    """The ML team calls this at startup with the Azure OpenAI provider."""
    global _provider
    _provider = p
