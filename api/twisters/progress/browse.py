"""Browse discovery: progress filter, sorting, facet counts and Random (PRD 05 S7, S9).

All of it is expressed as queryset operations or one small pure function, so the list endpoint
stays at a constant number of queries however many twisters a page holds.
"""

import random
from collections.abc import Mapping, Sequence

from django.conf import settings
from django.db.models import Count, Exists, F, OuterRef, QuerySet, Subquery
from rest_framework.exceptions import NotFound, ValidationError

from ..filters import FACET_PARAMS, TwisterFilter, TwisterSearchFilter
from ..models import Category, Difficulty, Favorite, Origin, Profile, Twister, UserTwisterStats
from . import mastery

SIGN_IN_FOR_STATUS = "Sign in to filter by progress."
SIGN_IN_FOR_BEST = "Sign in to sort by your best score."
STATUSES = ("mastered", "in_progress", "not_started", "favorites")
SORTS = (
    "recommended",
    "newest",
    "shortest",
    "longest",
    "hardest",
    "easiest",
    "best_desc",
    "best_asc",
)
DEFAULT_ORDER = ("difficulty", "id")  # the catalogue's natural order (Twister.Meta.ordering)
BEST_SORTS = {"best_desc", "best_asc"}

_SORT_ORDER: dict[str, tuple[str, ...]] = {
    "newest": ("-created_at", "-id"),
    "shortest": ("word_count", "id"),
    "longest": ("-word_count", "id"),
    "hardest": ("-difficulty", "id"),
    "easiest": ("difficulty", "id"),
}


def _viewer(request) -> Profile | None:
    user = request.user
    return user if isinstance(user, Profile) else None


def _stats(profile: Profile):
    return UserTwisterStats.objects.filter(profile=profile, twister=OuterRef("pk"))


# --- status & sort ---------------------------------------------------------------------------------


def apply_status(queryset: QuerySet[Twister], status: str, profile: Profile) -> QuerySet[Twister]:
    """Mastery buckets agree with `mastery.mastery_state`: mastered, tried-but-not-mastered, never tried."""
    tried = _stats(profile).filter(attempts_count__gt=0)
    if status == "mastered":
        return queryset.filter(Exists(_stats(profile).filter(mastered_at__isnull=False)))
    if status == "in_progress":
        return queryset.filter(Exists(tried.filter(mastered_at__isnull=True)))
    if status == "not_started":
        return queryset.exclude(Exists(tried))
    return queryset.filter(Exists(Favorite.objects.filter(profile=profile, twister=OuterRef("pk"))))


def apply_sort(
    queryset: QuerySet[Twister], sort: str, profile: Profile | None
) -> QuerySet[Twister]:
    """`recommended` puts what the user has not mastered first; signed-out callers get the default order."""
    if sort in BEST_SORTS:
        best = Subquery(_stats(profile).values("best_test_score")[:1])
        nulls_last = (
            sort == "best_desc"
        )  # unplayed twisters sink when looking for your best, rise when hunting weak ones
        order = F("best").desc(nulls_last=True) if nulls_last else F("best").asc(nulls_first=True)
        return queryset.annotate(best=best).order_by(order, *DEFAULT_ORDER)
    if sort == "recommended":
        if profile is None:
            return queryset.order_by(*DEFAULT_ORDER)
        mastered = Exists(_stats(profile).filter(mastered_at__isnull=False))
        return queryset.annotate(is_mastered=mastered).order_by("is_mastered", *DEFAULT_ORDER)
    return queryset.order_by(*_SORT_ORDER[sort])


def refine(queryset: QuerySet[Twister], request) -> QuerySet[Twister]:
    """Apply `?status=` and `?sort=` (sort wins over `?ordering=`). Bad values are a 400, never ignored."""
    params = request.query_params
    profile = _viewer(request)
    status, sort = params.get("status"), params.get("sort")
    if status is not None:
        if status not in STATUSES:
            raise ValidationError({"status": f"Use one of {', '.join(STATUSES)}."})
        if profile is None:
            raise ValidationError({"status": SIGN_IN_FOR_STATUS})
        queryset = apply_status(queryset, status, profile)
    if sort is not None:
        if sort not in SORTS:
            raise ValidationError({"sort": f"Use one of {', '.join(SORTS)}."})
        if sort in BEST_SORTS and profile is None:
            raise ValidationError({"sort": SIGN_IN_FOR_BEST})
        queryset = apply_sort(queryset, sort, profile)
    return queryset


# --- filters & facets ------------------------------------------------------------------------------


def filter_twisters(request, queryset: QuerySet[Twister], *, without: str | None = None):
    """The catalogue filters (difficulty, category, origin, word counts) with one parameter left out."""
    data = request.query_params.copy()
    if without:
        data.pop(without, None)
    filterset = TwisterFilter(data, queryset=queryset, request=request)
    if not filterset.is_valid():
        raise ValidationError(filterset.errors)
    return filterset.qs


def _searched(view, queryset: QuerySet[Twister]) -> QuerySet[Twister]:
    return TwisterSearchFilter().filter_queryset(view.request, queryset, view)


def _counts(queryset: QuerySet[Twister], field: str) -> dict:
    rows = queryset.order_by().values(field).annotate(n=Count("pk"))
    return {row[field]: row["n"] for row in rows}


def facets(view, queryset: QuerySet[Twister]) -> dict:
    """Counts per level / category / origin. Each facet ignores its own filter, so a chip shows what you
    would get by switching to it; `total` honours every filter and equals the list's `count`."""
    request = view.request

    def narrowed(without: str | None = None) -> QuerySet[Twister]:
        return _searched(view, filter_twisters(request, queryset, without=without))

    levels = _counts(narrowed(FACET_PARAMS["levels"]), "difficulty")
    by_category = _counts(narrowed(FACET_PARAMS["categories"]), "category__slug")
    origins = _counts(narrowed(FACET_PARAMS["origins"]), "origin")
    category_slugs = Category.objects.filter(twisters__is_published=True).distinct()
    return {
        "total": narrowed().count(),
        "levels": {str(level): levels.get(level, 0) for level in Difficulty.values},
        "categories": {
            slug: by_category.get(slug, 0) for slug in category_slugs.values_list("slug", flat=True)
        },
        "origins": {origin: origins.get(origin, 0) for origin in Origin.values},
    }


# --- random ----------------------------------------------------------------------------------------


def parse_exclude(request) -> list[str]:
    raw = request.query_params.get("exclude", "")
    slugs = list(dict.fromkeys(s.strip() for s in raw.split(",") if s.strip()))
    if len(slugs) > settings.RANDOM_EXCLUDE_MAX:
        raise ValidationError({"exclude": f"Skip at most {settings.RANDOM_EXCLUDE_MAX} twisters."})
    return slugs


def pick_random(
    candidates: Sequence[int],
    states: Mapping[int, str] | None,
    *,
    rng: random.Random | None = None,
    weights: Mapping[str, int] | None = None,
) -> int | None:
    """One id from ``candidates``. Signed-in callers (``states`` given) pick a bucket first, by weight,
    then uniformly inside it, so a long tail of mastered twisters cannot drown out new ones. Empty
    buckets are dropped and the remaining weights renormalised (a weighted choice does that itself)."""
    if not candidates:
        return None
    rng = rng or random.Random()
    if states is None:
        return rng.choice(list(candidates))
    weights = weights or settings.RANDOM_WEIGHTS
    buckets: dict[str, list[int]] = {}
    for twister_id in candidates:
        buckets.setdefault(mastery.bucket(states.get(twister_id, mastery.NEW)), []).append(
            twister_id
        )
    weighted = [name for name in buckets if weights.get(name, 0) > 0]
    names = weighted or list(
        buckets
    )  # all weights zero: fall back to a uniform pick over the buckets
    name = rng.choices(names, weights=[weights.get(n, 0) for n in names] if weighted else None)[0]
    return rng.choice(buckets[name])


def random_twister(view, *, rng: random.Random | None = None) -> Twister:
    """The Random button: filters minus `exclude`, weighted by the caller's mastery when signed in."""
    request = view.request
    queryset = filter_twisters(request, view.get_queryset()).exclude(
        slug__in=parse_exclude(request)
    )
    profile = _viewer(request)
    picked = pick_random(
        list(queryset.order_by("id").values_list("id", flat=True)),
        mastery.mastery_states_for(profile) if profile else None,
        rng=rng,
    )
    if picked is None:
        raise NotFound("No twister matches those filters.")
    return queryset.get(pk=picked)
