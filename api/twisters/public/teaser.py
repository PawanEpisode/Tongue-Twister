"""Which twisters a signed-out visitor sees (decision D44, PRD section 9.1).

The rule: take the first three twisters of each level in catalogue order, then repair coverage so every sound
family (category) appears. While a family is missing, its earliest twister is swapped into its own level,
replacing that level's pick from the most over-represented family (the latest pick on ties). The same
function produces the curated seed data, the fallback when a curated twister disappears, and the CI check.
It is pure (plain rows in, ids out) so it is unit tested without a database.
"""

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from django.conf import settings
from django.db.models import Case, IntegerField, QuerySet, Value, When

from ..models import Twister

PER_LEVEL = 3
LEVELS = (1, 2, 3, 4)


@dataclass(frozen=True)
class Row:
    """What the rule needs to know about a twister. `order` is its place in catalogue order."""

    id: int
    difficulty: int
    category: str | None
    order: int


def choose(rows: Sequence[Row], per_level: int = PER_LEVEL) -> list[Row]:
    """The teaser, in display order (level 1 to 4, then the order within the level).

    `rows` must already be in catalogue order (difficulty, id). Returns fewer than `per_level` for a level
    that has fewer twisters. A family that cannot be added without removing the only member of another family
    stays missing: a coverage gap is reported by `check_public_site`, never papered over.
    """
    levels = sorted({r.difficulty for r in rows} | set(LEVELS))
    picks: dict[int, list[Row]] = {
        lvl: [r for r in rows if r.difficulty == lvl][:per_level] for lvl in levels
    }
    families = list(dict.fromkeys(r.category for r in rows if r.category))

    def counts() -> Counter:
        return Counter(r.category for picked in picks.values() for r in picked)

    for family in families:
        if counts()[family]:
            continue
        candidate = min((r for r in rows if r.category == family), key=lambda r: r.order)
        level = picks[candidate.difficulty]
        have = counts()
        # Only a family that appears at least twice may give up a slot, so no family is ever lost.
        swappable = [i for i, r in enumerate(level) if have[r.category] >= 2]
        if not swappable:
            continue
        victim = max(swappable, key=lambda i: (have[level[i].category], i))
        level[victim] = candidate
    return [r for lvl in levels for r in picks[lvl]]


def _rows(queryset: QuerySet[Twister]) -> list[Row]:
    ordered = queryset.select_related("category").order_by("difficulty", "id")
    return [
        Row(t.id, t.difficulty, t.category.slug if t.category else None, i)
        for i, t in enumerate(ordered)
    ]


def teaser_ids() -> list[int]:
    """The ids shown to signed-out visitors, in order: the curated slots first, then (only if some are
    missing) the rule refills the rest from the public catalogue. Always at most `TEASER_SIZE`."""
    size = settings.TEASER_SIZE
    public = Twister.objects.public()
    curated = list(
        public.filter(teaser_position__isnull=False)
        .order_by("teaser_position")
        .values_list("id", flat=True)[:size]
    )
    if len(curated) >= size:
        return curated
    fill = [r.id for r in choose(_rows(public)) if r.id not in curated]
    return (curated + fill)[:size]


def teaser_queryset() -> QuerySet[Twister]:
    """The teaser as a queryset (so the usual filters apply inside it), in teaser order."""
    ids = teaser_ids()
    order = Case(
        *[When(pk=pk, then=Value(i)) for i, pk in enumerate(ids)],
        default=Value(len(ids)),
        output_field=IntegerField(),
    )
    return Twister.objects.public().filter(pk__in=ids).select_related("category").order_by(order)
