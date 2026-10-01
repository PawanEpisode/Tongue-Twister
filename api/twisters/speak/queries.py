"""Read-side helpers shared by the twister, history and profile endpoints."""

from functools import reduce
from operator import or_

from django.conf import settings
from django.db.models import Max, Q, QuerySet
from django.utils import timezone

from ..models import (
    SCORE_VERSION_CURRENT,
    Attempt,
    AttemptKind,
    AttemptWord,
    Profile,
    Twister,
    TwisterPronunciation,
    UserWordStat,
    Verification,
)
from .normalise import tokenise


def best_scores(attempts: QuerySet[Attempt]) -> dict[int, int]:
    """twister_id -> best test score. Scores are only comparable within a version (v1 vs v2), so
    the current version wins and a legacy v1 best is the fallback."""
    rows = (
        attempts.filter(kind=AttemptKind.TEST, flagged=False)
        .values("twister_id", "score_version")
        .annotate(best=Max("score"))
    )
    chosen: dict[int, tuple[int, int]] = {}
    for row in rows:
        version, best = row["score_version"], row["best"]
        if row["twister_id"] not in chosen or version > chosen[row["twister_id"]][0]:
            chosen[row["twister_id"]] = (version, best)
    return {twister_id: best for twister_id, (_, best) in chosen.items()}


def leaderboard_attempts() -> QuerySet[Attempt]:
    """Attempts allowed on boards: unflagged current-version tests (verified only once the worker ships)."""
    qs = Attempt.objects.filter(
        kind=AttemptKind.TEST, flagged=False, score_version=SCORE_VERSION_CURRENT
    )
    if settings.LEADERBOARD_REQUIRE_VERIFIED:
        qs = qs.filter(verification_status=Verification.VERIFIED)
    return qs


CONTEXT_WORDS = 3  # words of the twister shown on each side of a drilled word
MAX_HISTORY_ROWS = 2000


def drill_targets(profile: Profile, words: list[str]) -> dict[str, dict]:
    """Where to drill each word: a published twister that contains it and the word's position.

    Prefers the twister the user most recently said it in; falls back to any published twister with
    that word (by easiest first). Words that cannot be placed are left out. Positions are checked
    against the twister's current text, so an edited twister never yields a wrong index.
    """
    placed: dict[str, tuple[int, int]] = {}
    history = (
        AttemptWord.objects.filter(
            attempt__profile=profile,
            attempt__twister__is_published=True,
            target_word__in=words,
            target_index__isnull=False,
        )
        .order_by("-attempt__created_at", "-id")
        .values_list("target_word", "attempt__twister_id", "target_index")[:MAX_HISTORY_ROWS]
    )
    for word, twister_id, index in history:
        placed.setdefault(word, (twister_id, index))
    missing = [word for word in words if word not in placed]
    if missing:  # one query for all of them: easiest published twister that contains each word
        fallbacks = Twister.objects.filter(
            reduce(or_, (Q(phonemes__has_key=word) for word in missing)), is_published=True
        ).order_by("difficulty", "id")
        remaining = set(missing)
        for twister in fallbacks.iterator(chunk_size=20):
            for word in remaining & twister.phonemes.keys():
                placed[word] = (twister.pk, -1)
            remaining -= twister.phonemes.keys()
            if not remaining:
                break

    twisters = Twister.objects.in_bulk({twister_id for twister_id, _ in placed.values()})
    out: dict[str, dict] = {}
    for word, (twister_id, index) in placed.items():
        twister = twisters.get(twister_id)
        if twister is None:
            continue
        tokens = tokenise(twister.text)
        if not 0 <= index < len(tokens) or tokens[index] != word:
            if word not in tokens:
                continue
            index = tokens.index(word)
        start = max(0, index - CONTEXT_WORDS)
        out[word] = {
            "twister": twister.slug,
            "start": index,
            "end": index + 1,
            "context": tokens[start : index + CONTEXT_WORDS + 1],
            "context_index": index - start,
        }
    return out


def weak_word_rows(profile: Profile, *, limit: int, due: bool = False) -> list[dict]:
    """The weakest words first, each with where to drill it. Shared by `GET /me/words/weak/` and the
    Stats page, so the two can never disagree. ``due`` keeps only words whose review is due."""
    qs = UserWordStat.objects.filter(profile=profile, weakness__gt=0)
    if due:
        qs = qs.filter(Q(next_review_at__isnull=True) | Q(next_review_at__lte=timezone.now()))
    rows = list(qs.order_by("-weakness", "word_norm")[:limit])
    hints = dict(
        TwisterPronunciation.objects.filter(word__in=[r.word_norm for r in rows])
        .exclude(respelling="")
        .order_by("-twister_id")  # global rows (NULL) sort last, so a twister-specific hint wins
        .values_list("word", "respelling")
    )
    targets = drill_targets(profile, [r.word_norm for r in rows])
    return [
        {
            "word": r.word_norm,
            "seen": r.seen,
            "miss_rate": round((r.wrong + r.missed) / r.seen, 3),
            "weakness": round(r.weakness, 3),
            "next_review_at": r.next_review_at,
            "respelling": hints.get(r.word_norm, ""),
            "drill": targets.get(r.word_norm),
        }
        for r in rows
    ]
