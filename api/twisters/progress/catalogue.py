"""The achievement catalogue: one tuple, the single source of truth (spec 14 S3.1).

Migration ``0013_progress_seeds`` holds a *frozen* copy of this list as it was when 06d shipped;
later edits here reach the database through the idempotent ``sync_achievements`` command.
Adding a badge is one row here plus, for a new kind of rule, one function in ``achievements``.
"""

from dataclasses import asdict, dataclass, field

from django.db.models import Model

BRONZE, SILVER, GOLD = "bronze", "silver", "gold"
TEST_OR_RECORD = [
    "test",
    "record",
]  # train/drill score only part of a twister, so they never earn badges
SWEEP_SIZE = 5  # twisters to master in one sound family
LEVEL_PASS_SCORE = 80
LEVELS = [1, 2, 3, 4]


@dataclass(frozen=True)
class AchievementDef:
    code: str
    name: str
    description: str
    icon: str
    tier: str
    category: str
    criteria: dict = field(default_factory=dict)
    xp_reward: int = 0
    verified_only: bool = False
    hidden: bool = False
    sort_order: int = 0


def _rows() -> list[dict]:
    """Catalogue rows in display order; ``sort_order`` is assigned from the position."""
    rows: list[dict] = [
        dict(
            code="first_word",
            name="First Words",
            description="Finish your first attempt.",
            icon="mic",
            tier=BRONZE,
            category="start",
            criteria={"type": "attempts", "min": 1},
            xp_reward=10,
        ),
        dict(
            code="first_test",
            name="Put to the Test",
            description="Finish your first scored Test.",
            icon="target",
            tier=BRONZE,
            category="start",
            criteria={"type": "test_attempts", "min": 1},
            xp_reward=10,
        ),
    ]
    for code, name, tier, days, xp in (
        ("streak_3", "Warming Up", BRONZE, 3, 15),
        ("streak_7", "On Fire", SILVER, 7, 30),
        ("streak_14", "Two Weeks", SILVER, 14, 50),
        ("streak_30", "Unstoppable", GOLD, 30, 100),
    ):
        rows.append(
            dict(
                code=code,
                name=name,
                description=f"Practise {days} days in a row.",
                icon="flame",
                tier=tier,
                category="streak",
                criteria={"type": "streak", "min": days},
                xp_reward=xp,
            )
        )
    for code, name, tier, count, xp in (
        ("mastered_1", "Tongue Tied No More", BRONZE, 1, 25),
        ("mastered_10", "Word Smith", SILVER, 10, 60),
        ("mastered_50", "Twister Pro", GOLD, 50, 150),
        ("mastered_100", "Legend", GOLD, 100, 300),
    ):
        rows.append(
            dict(
                code=code,
                name=name,
                tier=tier,
                icon="trophy",
                category="mastery",
                description=f"Master {count} twister{'s' if count > 1 else ''}.",
                criteria={"type": "mastered", "min": count},
                xp_reward=xp,
            )
        )
    rows += [
        dict(
            code="perfect_100",
            name="Flawless",
            description="Score 100 on a twister of 10 words or more.",
            icon="sparkles",
            tier=GOLD,
            category="skill",
            verified_only=True,
            xp_reward=50,
            criteria={
                "type": "attempt_score",
                "min": 100,
                "min_words": 10,
                "kinds": TEST_OR_RECORD,
            },
        ),
        dict(
            code="insane_clear",
            name="Insane in the Membrane",
            description="Score 80 or more on an Insane twister.",
            icon="skull",
            tier=GOLD,
            category="skill",
            verified_only=True,
            xp_reward=50,
            criteria={"type": "attempt_score", "min": 80, "difficulty": 4, "kinds": TEST_OR_RECORD},
        ),
        dict(
            code="marathoner",
            name="Marathoner",
            description="Score 80 or more on a twister of 100 words or more.",
            icon="route",
            tier=SILVER,
            category="skill",
            verified_only=True,
            xp_reward=40,
            criteria={
                "type": "attempt_score",
                "min": 80,
                "min_words": 100,
                "kinds": TEST_OR_RECORD,
            },
        ),
        dict(
            code="speed_demon",
            name="Speed Demon",
            description="Reach 180 words per minute with 90% accuracy.",
            icon="zap",
            tier=SILVER,
            category="skill",
            verified_only=True,
            xp_reward=40,
            criteria={
                "type": "attempt_wpm",
                "min": 180,
                "min_accuracy": 0.9,
                "kinds": TEST_OR_RECORD,
            },
        ),
    ]
    for code, name, category_slug in (
        ("sweep_hissers", "Hisser Master", "hissers"),
        ("sweep_poppers", "Popper Master", "poppers"),
        ("sweep_rollers", "Roller Master", "rollers"),
        ("sweep_th", "TH Master", "th-tangles"),
        ("sweep_vowels", "Vowel Master", "vowel-vortex"),
        ("sweep_benders", "Bender Master", "brain-benders"),
    ):
        rows.append(
            dict(
                code=code,
                name=name,
                icon="medal",
                tier=SILVER,
                category="mastery",
                xp_reward=50,
                description=f"Master {SWEEP_SIZE} twisters in one sound family.",
                criteria={
                    "type": "category_mastered",
                    "category": category_slug,
                    "min": SWEEP_SIZE,
                },
            )
        )
    rows += [
        dict(
            code="all_levels",
            name="Ladder Climber",
            description="Pass a Test with 80 or more at every level.",
            icon="mountain",
            tier=SILVER,
            category="skill",
            verified_only=True,
            xp_reward=40,
            criteria={
                "type": "levels_passed",
                "min_score": LEVEL_PASS_SCORE,
                "difficulties": LEVELS,
            },
        ),
        dict(
            code="read_10min",
            name="Steady Pacer",
            description="Read along for 10 minutes in total.",
            icon="timer",
            tier=BRONZE,
            category="start",
            xp_reward=20,
            criteria={"type": "read_along_ms", "min": 600_000},
        ),
        dict(
            code="recorded_1",
            name="On Camera",
            description="Save your first recording.",
            icon="video",
            tier=BRONZE,
            category="start",
            xp_reward=20,
            criteria={"type": "recordings_saved", "min": 1},
        ),
        dict(
            code="comeback",
            name="Comeback Kid",
            description="Raise a twister's best score by 25 points or more.",
            icon="trending-up",
            tier=SILVER,
            category="skill",
            verified_only=True,
            xp_reward=30,
            criteria={"type": "score_gain", "min": 25, "kinds": ["test"]},
        ),
        dict(
            code="explorer",
            name="Explorer",
            description="Try a twister from every category.",
            icon="compass",
            tier=SILVER,
            category="explore",
            xp_reward=30,
            criteria={"type": "categories_attempted"},
        ),
        # Clock-based badges (D23): the hour window is on the *local* clock and `to` is exclusive, so
        # 23:00-02:59 and 05:00-07:59. Both need a confirmed timezone (see `achievements`).
        dict(
            code="night_owl",
            name="Night Owl",
            description="Finish a scored attempt between 11 p.m. and 3 a.m.",
            icon="moon",
            tier=BRONZE,
            category="skill",
            xp_reward=20,
            criteria={"type": "attempt_local_hour", "from": 23, "to": 3, "kinds": TEST_OR_RECORD},
        ),
        dict(
            code="early_bird",
            name="Early Bird",
            description="Finish a scored attempt between 5 and 8 a.m.",
            icon="sunrise",
            tier=BRONZE,
            category="skill",
            xp_reward=20,
            criteria={"type": "attempt_local_hour", "from": 5, "to": 8, "kinds": TEST_OR_RECORD},
        ),
    ]
    return rows


CATALOGUE: tuple[AchievementDef, ...] = tuple(
    AchievementDef(sort_order=position * 10, **row) for position, row in enumerate(_rows(), start=1)
)


def upsert_catalogue(model: type[Model] | None = None) -> dict[str, int]:
    """Make the table match ``CATALOGUE``: upsert every code (re-activating it) and switch off codes that
    are no longer listed. Rows are never deleted, so a user's unlocks survive any catalogue change.

    ``model`` defaults to the live ``Achievement``; it is injectable so a test or a migration can pass
    its own (this module itself imports no models).
    """
    if model is None:
        from ..models import Achievement

        model = Achievement
    created = updated = 0
    for definition in CATALOGUE:
        fields = {k: v for k, v in asdict(definition).items() if k != "code"}
        _, was_created = model.objects.update_or_create(
            code=definition.code, defaults={**fields, "active": True}
        )
        created += was_created
        updated += not was_created
    deactivated = (
        model.objects.exclude(code__in=[d.code for d in CATALOGUE])
        .filter(active=True)
        .update(active=False)
    )
    return {"created": created, "updated": updated, "deactivated": deactivated}
