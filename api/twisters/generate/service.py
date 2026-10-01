"""Generate a private twister for one person (D24-D26). Views validate and shape; everything else is here.

Order, so the cheap and the safe checks come first: topic check, quota slot, generator, output
validation, then one insert. Nothing is stored for a rejected result, and a provider failure hands the
quota slot back.
"""

from __future__ import annotations

import datetime as dt
import logging
import secrets

from django.db import transaction
from django.utils import timezone

from .. import errors
from ..models import AgeBand, Origin, Profile, Twister, TwisterVisibility
from . import quota, topic
from .drafts import GenerationBlocked, Generator, GeneratorUnavailable
from .generators import get_generator
from .validators import Rejected, Validated, validate

log = logging.getLogger(__name__)

SLUG_PREFIX = "my-"
SLUG_BYTES = 6  # 48 random bits: unguessable, and the slug is only ever served to its owner


def _new_slug() -> str:
    return SLUG_PREFIX + secrets.token_hex(SLUG_BYTES)


def _store(profile: Profile, topic_text: str, difficulty: int, result: Validated) -> Twister:
    return Twister.objects.create(
        slug=_new_slug(),
        text=result.text,
        tip=result.tip,
        focus_sounds=result.focus_sounds,
        difficulty=difficulty,
        origin=Origin.MODERN,
        topic=topic_text,
        phonemes=result.phonemes,
        phoneme_version=1,
        visibility=TwisterVisibility.PRIVATE,
        owner=profile,
        is_published=False,
    )


def generate(
    profile: Profile,
    topic_text: str,
    difficulty: int,
    language: str,
    *,
    generator: Generator | None = None,
    now: dt.datetime | None = None,
) -> Twister:
    """The new private twister, or an `ApiProblem`: 403 minor_not_allowed, 422 generation_rejected,
    429 generation_limit, 503 generator_unavailable."""
    now = now or timezone.now()
    if profile.age_band == AgeBand.UNDER13:  # no child's text goes to a third-party model
        raise errors.minor_not_allowed("Twister generation is for people aged 13 or older.")
    if not topic.is_allowed(topic_text):
        raise errors.generation_rejected("topic_not_allowed")
    if not quota.reserve(profile, now):
        current = quota.status(profile, now)
        raise errors.generation_limit(current.limit, current.used, current.resets_at)
    try:
        draft = (generator or get_generator()).generate(topic_text, difficulty, language)
    except GeneratorUnavailable as exc:
        quota.release(profile, now)
        log.warning("generate.unavailable topic_len=%d reason=%s", len(topic_text), exc)
        raise errors.generator_unavailable() from None
    except GenerationBlocked as exc:
        log.info("generate.blocked topic_len=%d reason=%s", len(topic_text), exc.reason)
        raise errors.generation_rejected(exc.reason) from None
    try:
        result = validate(draft)
    except Rejected as exc:
        log.info("generate.rejected topic_len=%d reason=%s", len(topic_text), exc.reason)
        raise errors.generation_rejected(exc.reason) from None
    with transaction.atomic():
        return _store(profile, topic_text, difficulty, result)
