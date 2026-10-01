"""Per-twister mastery state (PRD 05 S4). Mastering itself is decided in ``speak.stats``
(``mastered_at`` is immutable once set); this module only names the states and counts them."""

from django.conf import settings
from django.db.models import Count

from ..models import Profile, UserTwisterStats, public_twister_q

NEW = "new"
PRACTISING = "practising"
ALMOST = "almost"
MASTERED = "mastered"
STATES = (NEW, PRACTISING, ALMOST, MASTERED)

STATS_FIELDS = (
    "twister_id",
    "attempts_count",
    "mastered_at",
    "best_score",
    "best_practice_score",
    "best_test_score",
)


def best_of(best_score: int | None, best_practice_score: int | None, best_test_score: int | None):
    return max(
        (b for b in (best_score, best_practice_score, best_test_score) if b is not None),
        default=None,
    )


def state_from(
    *,
    attempts_count: int,
    mastered_at,
    best_score: int | None,
    best_practice_score: int | None,
    best_test_score: int | None,
) -> str:
    if mastered_at is not None:
        return MASTERED
    best = best_of(best_score, best_practice_score, best_test_score)
    if best is not None and best >= settings.MASTERY_ALMOST_SCORE:
        return ALMOST
    return PRACTISING if attempts_count > 0 else NEW


def mastery_state(stats: UserTwisterStats | None) -> str:
    """State of one (user, twister) row; no row means the user never tried it."""
    if stats is None:
        return NEW
    return state_from(
        attempts_count=stats.attempts_count,
        mastered_at=stats.mastered_at,
        best_score=stats.best_score,
        best_practice_score=stats.best_practice_score,
        best_test_score=stats.best_test_score,
    )


def mastery_states_for(profile: Profile) -> dict[int, str]:
    """twister_id -> state in one query. Twisters without a row are absent, which means ``new``."""
    return {
        row["twister_id"]: state_from(**{k: v for k, v in row.items() if k != "twister_id"})
        for row in UserTwisterStats.objects.filter(profile=profile).values(*STATS_FIELDS)
    }


def _mastered(profile: Profile):
    return UserTwisterStats.objects.filter(
        public_twister_q("twister__"), profile=profile, mastered_at__isnull=False
    )


def mastered_count(profile: Profile) -> int:
    return _mastered(profile).count()


def mastered_by_category(profile: Profile) -> dict[str, int]:
    """category slug -> mastered twisters (uncategorised twisters are left out)."""
    rows = (
        _mastered(profile)
        .filter(twister__category__isnull=False)
        .values("twister__category__slug")
        .annotate(n=Count("pk"))
    )
    return {row["twister__category__slug"]: row["n"] for row in rows}


def bucket(state: str) -> str:
    """Random's three buckets: ``almost`` is still 'in progress'."""
    return PRACTISING if state == ALMOST else state
