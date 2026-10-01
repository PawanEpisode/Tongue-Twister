"""The vocabulary shared by generators and the service: what a generator hands back, and how it fails."""

from dataclasses import dataclass, field
from typing import Protocol

LANGUAGES = ("en",)
DEFAULT_LANGUAGE = "en"


class GeneratorUnavailable(Exception):
    """The provider could not be reached or refused us (missing key, 4xx, 5xx after the retry, timeout).
    Our problem, not the user's: it maps to 503 and the quota is handed back."""


class GenerationBlocked(Exception):
    """The provider declined to answer for safety reasons or returned nothing usable. The user's problem:
    it maps to 422 `generation_rejected` with this ``reason``."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Draft:
    """Untrusted generator output. Nothing here is stored before `validators.validate` has seen it."""

    text: str
    tip: str = ""
    focus_sounds: list[str] = field(default_factory=list)


class Generator(Protocol):
    def generate(
        self, topic: str, difficulty: int, language: str, words: int | None = None
    ) -> Draft: ...
