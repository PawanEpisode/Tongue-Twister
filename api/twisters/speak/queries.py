"""Read-side helpers shared by the twister, history and profile endpoints."""

from django.conf import settings
from django.db.models import Max, QuerySet

from ..models import SCORE_VERSION_CURRENT, Attempt, AttemptKind, Verification


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
