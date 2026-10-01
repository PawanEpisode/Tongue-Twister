"""Shared builders for the Generate Twister (round 2) tests."""

import itertools
import uuid

from twisters.generate.drafts import Draft, GenerationBlocked, GeneratorUnavailable
from twisters.models import FeatureFlag, Origin, Profile, Twister, TwisterVisibility
from twisters.speak import pronunciations

API = "/api/v1"
GOOD_TEXT = "Six slick snakes slid slowly by the sea."
_counter = itertools.count(1)


def enable_generation(on: bool = True) -> None:
    FeatureFlag.objects.filter(code="generate_twister").update(enabled=on, rollout_pct=100)


def private_twister(owner: Profile, text: str = GOOD_TEXT, **over) -> Twister:
    """A private twister built straight through the ORM, shaped exactly as the service stores one."""
    phonemes, _ = pronunciations.resolve(text)
    fields = {
        "slug": f"my-test-{next(_counter)}-{uuid.uuid4().hex[:6]}",
        "text": text,
        "origin": Origin.MODERN,
        "visibility": TwisterVisibility.PRIVATE,
        "owner": owner,
        "is_published": False,
        "phonemes": phonemes,
        "phoneme_version": 1,
        **over,
    }
    return Twister.objects.create(**fields)


class ScriptedGenerator:
    """A generator whose answer (or failure) the test chooses; records what it was asked."""

    def __init__(self, result: Draft | Exception | None = None):
        self.result = result if result is not None else Draft(text=GOOD_TEXT)
        self.calls: list[tuple[str, int, str]] = []

    def generate(self, topic: str, difficulty: int, language: str) -> Draft:
        self.calls.append((topic, difficulty, language))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def unavailable() -> ScriptedGenerator:
    return ScriptedGenerator(GeneratorUnavailable("down"))


def blocked(reason: str = "provider_blocked") -> ScriptedGenerator:
    return ScriptedGenerator(GenerationBlocked(reason))
