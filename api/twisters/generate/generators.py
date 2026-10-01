"""Which generator runs (D24): `GENERATOR_BACKEND` = `gemini` | `fake`, `fake` whenever no key is set."""

import logging

from django.conf import settings

from . import gemini
from .drafts import Generator, GeneratorUnavailable
from .fake import FakeGenerator

log = logging.getLogger(__name__)

BACKENDS = ("gemini", "fake")


def backend_name() -> str:
    """The configured backend; unset means `gemini` when a key exists, otherwise `fake`."""
    chosen = settings.GENERATOR_BACKEND
    if chosen not in ("", *BACKENDS):
        raise GeneratorUnavailable("GENERATOR_BACKEND must be 'gemini' or 'fake'")
    return chosen or ("gemini" if settings.GEMINI_API_KEY else "fake")


def get_generator() -> Generator:
    if backend_name() == "fake":
        return FakeGenerator()
    return gemini.from_settings()
