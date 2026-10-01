"""Generate a private twister for one person (D24-D26). Views validate and shape; everything else is here.

Order, so the cheap and the safe checks come first: topic check, stored-twister cap, quota slot, generator, output
validation, then one insert. Nothing is stored for a rejected result. The quota slot is handed back
unless a twister is stored.
"""

from __future__ import annotations

import datetime as dt
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from .. import errors
from ..models import AgeBand, Origin, Profile, Twister, TwisterVisibility
from . import quota, topic
from .drafts import GenerationBlocked, Generator, GeneratorUnavailable
from .generators import get_generator
from .validators import Rejected, Validated, validate

log = logging.getLogger(__name__)

SLUG_MAX = 80  # Twister.slug max_length


def _new_slug(topic_text: str) -> str:
    """A readable slug from the topic. A clash with an existing slug gets `-2`, `-3`, and so on."""
    base = (slugify(topic_text) or "twister").strip("-")[:SLUG_MAX].strip("-") or "twister"
    candidate = base
    number = 2
    while Twister.objects.filter(slug=candidate).exists():
        suffix = f"-{number}"
        stem = base[: SLUG_MAX - len(suffix)].strip("-") or "twister"
        candidate = f"{stem}{suffix}"
        number += 1
    return candidate


def _store(profile: Profile, topic_text: str, difficulty: int, result: Validated) -> Twister:
    return Twister.objects.create(
        slug=_new_slug(topic_text),
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
    words: int | None = None,
    *,
    generator: Generator | None = None,
    now: dt.datetime | None = None,
) -> Twister:
    """The new private twister, or an `ApiProblem`: 403 minor_not_allowed, 422 generation_rejected,
    409 stored_limit, 429 generation_limit, 503 generator_unavailable."""
    now = now or timezone.now()
    if profile.age_band == AgeBand.UNDER13:  # no child's text goes to a third-party model
        raise errors.minor_not_allowed("Twister generation is for people aged 13 or older.")
    if not topic.is_allowed(topic_text):
        raise errors.generation_rejected("topic_not_allowed")
    if not quota.has_room(profile):  # before a slot is taken: a refusal must cost nothing
        raise errors.stored_limit(settings.GENERATE_MAX_STORED, quota.stored_count(profile))
    if not quota.reserve(profile, now):
        current = quota.status(profile, now)
        raise errors.generation_limit(current.limit, current.used, current.resets_at)
    twister = None
    try:
        draft = (generator or get_generator()).generate(topic_text, difficulty, language, words)
        result = validate(draft, topic=topic_text, words=words, difficulty=difficulty)
        with transaction.atomic():
            twister = _store(profile, topic_text, difficulty, result)
        return twister
    except GeneratorUnavailable as exc:
        log.warning("generate.unavailable topic_len=%d reason=%s", len(topic_text), exc)
        raise errors.generator_unavailable() from None
    except GenerationBlocked as exc:
        log.info("generate.blocked topic_len=%d reason=%s", len(topic_text), exc.reason)
        raise errors.generation_rejected(exc.reason) from None
    except Rejected as exc:
        log.info("generate.rejected topic_len=%d reason=%s", len(topic_text), exc.reason)
        raise errors.generation_rejected(exc.reason) from None
    finally:
        if twister is None:
            quota.release(profile, now)
