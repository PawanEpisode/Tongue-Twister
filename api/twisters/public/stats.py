"""Numbers for the public site. Counts of the catalogue are live; usage numbers come from a snapshot that
`refresh_public_stats` writes, and are withheld (null) until they clear PUBLIC_STAT_FLOOR."""

from django.conf import settings

from ..models import Category, PublicStatSnapshot, Twister, public_twister_q

PRACTISERS = "practisers_30d"
ATTEMPTS = "attempts_30d"


def catalogue_stats() -> dict:
    return {
        "twisters": Twister.objects.public().count(),
        "categories": Category.objects.filter(twisters__in=Twister.objects.public())
        .distinct()
        .count(),
        "levels": 4,
    }


def usage_stats() -> dict:
    rows = {r.key: r for r in PublicStatSnapshot.objects.filter(key__in=[PRACTISERS, ATTEMPTS])}
    floor = settings.PUBLIC_STAT_FLOOR

    def shown(key: str) -> int | None:
        row = rows.get(key)
        return row.value if row and row.value >= floor else None

    as_of = max((r.computed_at for r in rows.values()), default=None)
    return {
        "practisers": shown(PRACTISERS),
        "attempts": shown(ATTEMPTS),
        "as_of": as_of.isoformat() if as_of else None,
    }


def facet_counts() -> dict:
    """Public totals across the whole catalogue (counts only; PRD E-14)."""
    from django.db.models import Count

    qs = Twister.objects.public()
    levels = {
        str(r["difficulty"]): r["n"]
        for r in qs.order_by().values("difficulty").annotate(n=Count("pk"))
    }
    cats = {
        c["slug"]: c["n"]
        for c in Category.objects.annotate(
            n=Count("twisters", filter=public_twister_q("twisters__"))
        )
        .filter(n__gt=0)
        .values("slug", "n")
    }
    return {"levels": levels, "categories": cats}
