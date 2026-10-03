"""Direct JSON export of one person's data (decision D22, `GET /me/export/`).

The body is streamed section by section from chunked queries, so a large account never sits in memory
twice. Leak-proofing is by construction: every section is an explicit whitelist of ``(output key, ORM
path)`` pairs and nothing is serialised from a model wholesale, so a field added to a model tomorrow
(a hash, a storage path, an internal flag) stays out until someone deliberately lists it here. Every
query starts from the caller's own rows. No media bytes are included, only metadata.

Size: Vercel Functions cap a response body at 4.5 MB, so the document is held to `EXPORT_MAX_BYTES`
(default 4 MB) as well as to `EXPORT_MAX_ATTEMPTS`. Attempts (with their per-word verdicts) are by far
the largest section, so they are written last and take whatever the byte budget has left, newest first;
`truncated` (also last, once it is known) says whether any were left out. Everything else is small and
bounded by the account's own rows.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
from collections import defaultdict
from collections.abc import Iterable, Iterator
from itertools import batched

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import QuerySet

from ..models import (
    Attempt,
    AttemptWord,
    DailyActivity,
    PracticeSession,
    Profile,
    Recording,
    RecordingStatus,
    ReminderPreference,
    Twister,
    TwisterVisibility,
    UserAchievement,
    UserConsent,
    UserPhonemeStat,
    UserPreference,
    UserTwisterStats,
    UserWordStat,
)

SCHEMA_VERSION = 1
OWNER_KEY = "_owner"  # internal join key, popped before a row is serialised

Spec = tuple[tuple[str, str], ...]  # (key in the export, ORM lookup)


def _same(*fields: str) -> Spec:
    return tuple((f, f) for f in fields)


PROFILE: Spec = _same(
    "id",
    "email",
    "display_name",
    "public_name",
    "avatar_emoji",
    "avatar_source",
    "xp",
    "current_streak",
    "best_streak",
    "last_activity_date",
    "streak_freezes",
    "timezone",
    "timezone_confirmed",
    "night_owl",
    "age_band",
    "hide_from_boards",
    "created_at",
    "deletion_requested_at",
    "deletion_scheduled_for",
) + (("plan", "plan_id"),)

PREFERENCES: Spec = _same(
    "default_mode",
    "display_style",
    "accent_lang",
    "wpm",
    "threshold_pct",
    "font_scale",
    "loop_count",
    "countdown_s",
    "mirror_text",
    "punctuation_pauses",
    "metronome",
    "metronome_volume",
    "listen_first",
    "tts_rate",
    "reduce_motion",
    "dyslexia_font",
    "high_contrast",
    "theme",
    "confetti",
    "daily_goal_attempts",
    "save_voice_default",
    "record_layout",
    "record_resolution",
    "extra",
    "updated_at",
)

REMINDERS: Spec = _same("enabled", "hour_local", "last_sent_on", "updated_at")

ATTEMPT: Spec = (
    ("id", "public_id"),
    ("twister", "twister__slug"),
    *_same(
        "kind",
        "transcript",
        "accuracy",
        "speed_score",
        "fluency_score",
        "completeness",
        "duration_ms",
        "long_pause_ms",
        "wpm",
        "score",
        "score_version",
        "xp_awarded",
        "is_personal_best",
        "breakdown",
        "created_at",
    ),
)

EVENT: Spec = _same("kind", "ref", "data", "created_at")

# The spreadsheet view of an attempt: flat columns only (no per-word verdicts, no free-form JSON).
CSV_COLUMNS: Spec = (
    ("date", "created_at"),
    ("twister", "twister__slug"),
    *_same(
        "kind",
        "score",
        "accuracy",
        "speed_score",
        "fluency_score",
        "completeness",
        "wpm",
        "duration_ms",
        "xp_awarded",
        "is_personal_best",
        "transcript",
    ),
)

WORD: Spec = _same(
    "target_index",
    "spoken_index",
    "target_word",
    "spoken_word",
    "status",
    "reason",
    "credit",
    "start_ms",
    "end_ms",
)

SESSION: Spec = (
    ("id", "id"),
    ("twister", "twister__slug"),
    *_same(
        "mode",
        "submode",
        "status",
        "ended_reason",
        "started_at",
        "ended_at",
        "active_ms",
        "loops_completed",
        "passes_completed",
        "avg_wpm",
    ),
)

DAILY_ACTIVITY: Spec = _same(
    "local_date",
    "attempts",
    "active_ms",
    "read_along_ms",
    "read_along_passes",
    "xp",
    "read_along_xp",
    "qualifies_streak",
    "freeze_used",
)

TWISTER_STATS: Spec = (("twister", "twister__slug"),) + _same(
    "attempts_count",
    "test_attempts_count",
    "best_score",
    "best_practice_score",
    "best_test_score",
    "last_score",
    "first_attempt_at",
    "last_attempt_at",
    "mastered_at",
    "mastery_days_hit",
    "mastery_last_day",
)

WORD_STATS: Spec = _same(
    "word_norm",
    "seen",
    "correct",
    "near",
    "wrong",
    "missed",
    "recent_error_rate",
    "weakness",
    "last_seen_at",
    "next_review_at",
    "streak_correct",
    "mastered_at",
)

PHONEME_STATS: Spec = _same("phoneme_pair", "occurrences", "errors", "error_rate")

ACHIEVEMENT: Spec = (("code", "achievement_id"), ("unlocked_at", "unlocked_at"))

# Metadata only: no storage bucket/path, no asset ids, no checksums, no signed URLs.
RECORDING: Spec = (("id", "id"), ("twister", "twister__slug")) + _same(
    "title",
    "notes",
    "layout",
    "has_camera",
    "has_screen",
    "has_mic",
    "has_system_audio",
    "duration_ms",
    "width",
    "height",
    "fps",
    "mime_type",
    "size_bytes",
    "status",
    "visibility",
    "captions_source",
    "expires_at",
    "created_at",
)

# The caller's private generated twisters (D25): text they asked for, so it is theirs to take with them.
GENERATED_TWISTER: Spec = _same(
    "slug", "text", "topic", "tip", "focus_sounds", "difficulty", "created_at"
)

CONSENT: Spec = _same("type", "version", "granted_at", "revoked_at")


def _rows(queryset: QuerySet, spec: Spec) -> Iterator[dict]:
    """Rows of ``queryset`` as dicts shaped by ``spec``, fetched in chunks (never all at once)."""
    keys = [key for key, _ in spec]
    lookups = [lookup for _, lookup in spec]
    for values in queryset.values_list(*lookups).iterator(chunk_size=settings.EXPORT_CHUNK_SIZE):
        yield dict(zip(keys, values, strict=True))


def _one(queryset: QuerySet, spec: Spec) -> dict | None:
    return next(_rows(queryset[:1], spec), None)


class Budget:
    """Bytes of the export written so far, against `EXPORT_MAX_BYTES`."""

    TAIL = 64  # room kept for `]`, `,"truncated":false` and the closing brace

    def __init__(self, limit: int):
        self.limit = limit
        self.used = 0
        self.cut = False  # set when a row did not fit

    def spend(self, text: str) -> None:
        self.used += len(text.encode("utf-8"))

    def fits(self, text: str) -> bool:
        return self.used + len(text.encode("utf-8")) + self.TAIL <= self.limit


def _attempts(profile: Profile) -> Iterator[dict]:
    """Newest first, capped at ``EXPORT_MAX_ATTEMPTS``; each carries its per-word verdicts."""
    mine = Attempt.objects.filter(profile=profile)
    newest = mine.order_by("-created_at", "-id").values_list("pk", flat=True)
    ids = list(newest[: settings.EXPORT_MAX_ATTEMPTS])
    for chunk in batched(ids, settings.EXPORT_CHUNK_SIZE):
        words: dict[int, list[dict]] = defaultdict(list)
        word_rows = AttemptWord.objects.filter(attempt_id__in=chunk).order_by("id")
        for word in _rows(word_rows, ((OWNER_KEY, "attempt_id"), *WORD)):
            words[word.pop(OWNER_KEY)].append(word)
        rows = mine.filter(pk__in=chunk).order_by("-created_at", "-id")
        for row in _rows(rows, ((OWNER_KEY, "pk"), *ATTEMPT)):
            attempt_id = row.pop(OWNER_KEY)
            yield {**row, "words": words[attempt_id]}


def _was_truncated(profile: Profile) -> bool:
    return Attempt.objects.filter(profile=profile).count() > settings.EXPORT_MAX_ATTEMPTS


def _array(rows: Iterable[dict], budget: Budget | None = None) -> Iterator[str]:
    """A JSON array; with a ``budget`` it ends early (and marks the budget cut) once a row would not fit."""
    yield "["
    for index, row in enumerate(rows):
        fragment = ("," if index else "") + _dump(row)
        if budget is not None and not budget.fits(fragment):
            budget.cut = True
            break
        yield fragment
    yield "]"


def _dump(value) -> str:
    return json.dumps(value, cls=DjangoJSONEncoder, ensure_ascii=False, separators=(",", ":"))


def _sections(
    profile: Profile, now: dt.datetime, budget: Budget
) -> Iterator[tuple[str, Iterable[str]]]:
    """(key, JSON fragments) in export order. Each fragment generator runs only when consumed."""
    own = {"profile": profile}
    me = Profile.objects.filter(pk=profile.pk)
    yield "schema_version", [_dump(SCHEMA_VERSION)]
    yield "generated_at", [_dump(now)]
    yield "profile", [_dump(_one(me, PROFILE))]
    yield "preferences", [_dump(_one(UserPreference.objects.filter(**own), PREFERENCES))]
    yield "reminders", [_dump(_one(ReminderPreference.objects.filter(**own), REMINDERS))]
    favourites = profile.favorites.order_by("created_at").values_list("twister__slug", flat=True)
    yield "favorites", [_dump(list(favourites))]
    sessions = PracticeSession.objects.filter(**own).order_by("-started_at")
    yield "sessions", _array(_rows(sessions, SESSION))
    daily = DailyActivity.objects.filter(**own).order_by("local_date")
    yield "daily_activity", _array(_rows(daily, DAILY_ACTIVITY))
    generated = Twister.objects.filter(owner=profile, visibility=TwisterVisibility.PRIVATE)
    yield "generated_twisters", _array(_rows(generated.order_by("created_at"), GENERATED_TWISTER))
    yield "stats", _stats(profile)
    unlocked = UserAchievement.objects.filter(revoked=False, **own).order_by("unlocked_at")
    yield "achievements", _array(_rows(unlocked, ACHIEVEMENT))
    yield "timeline", _array(_rows(profile.events.order_by("created_at", "id"), EVENT))
    recordings = (
        Recording.objects.filter(**own)
        .exclude(status=RecordingStatus.DELETED)
        .order_by("-created_at")
    )
    yield "recordings", _array(_rows(recordings, RECORDING))
    yield (
        "consents",
        _array(_rows(UserConsent.objects.filter(**own).order_by("granted_at"), CONSENT)),
    )
    # Last, so they take what the byte budget has left; `truncated` follows because it is known only now.
    yield "attempts", _array(_attempts(profile), budget)
    yield "truncated", _Lazy(lambda: _dump(_was_truncated(profile) or budget.cut))


class _Lazy:
    """A fragment list evaluated when consumed (after the sections before it were written)."""

    def __init__(self, make):
        self.make = make

    def __iter__(self):
        yield self.make()


def _stats(profile: Profile) -> Iterator[str]:
    own = {"profile": profile}
    parts = (
        (
            "twisters",
            UserTwisterStats.objects.filter(**own).order_by("twister__slug"),
            TWISTER_STATS,
        ),
        ("words", UserWordStat.objects.filter(**own).order_by("word_norm"), WORD_STATS),
        ("phonemes", UserPhonemeStat.objects.filter(**own).order_by("phoneme_pair"), PHONEME_STATS),
    )
    yield "{"
    for index, (key, queryset, spec) in enumerate(parts):
        yield ("," if index else "") + _dump(key) + ":"
        yield from _array(_rows(queryset, spec))
    yield "}"


def stream(profile: Profile, now: dt.datetime) -> Iterator[str]:
    """The whole export as JSON text fragments, one top-level object."""
    budget = Budget(settings.EXPORT_MAX_BYTES)
    for fragment in _fragments(profile, now, budget):
        budget.spend(fragment)
        yield fragment


def _fragments(profile: Profile, now: dt.datetime, budget: Budget) -> Iterator[str]:
    yield "{"
    for index, (key, fragments) in enumerate(_sections(profile, now, budget)):
        yield ("," if index else "") + _dump(key) + ":"
        yield from fragments
    yield "}"


def filename(now: dt.datetime) -> str:
    return f"twister-export-{now:%Y%m%d}.json"


_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_cell(value) -> str:
    """One CSV cell. Text that a spreadsheet could run as a formula (spoken transcripts are
    user-controlled) is prefixed with an apostrophe, so opening the file can never execute anything."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, dt.datetime):
        return value.isoformat()
    text = str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def attempts_csv(profile: Profile) -> Iterator[str]:
    """The caller's attempts as CSV, newest first, capped at ``EXPORT_MAX_ATTEMPTS``."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")

    def flush() -> str:
        chunk = buffer.getvalue()
        buffer.seek(0)
        buffer.truncate()
        return chunk

    writer.writerow([key for key, _ in CSV_COLUMNS])
    yield "\ufeff" + flush()  # BOM so Excel reads the accents in transcripts as UTF-8
    rows = (
        Attempt.objects.filter(profile=profile)
        .order_by("-created_at", "-id")
        .values_list(*[path for _, path in CSV_COLUMNS])[: settings.EXPORT_MAX_ATTEMPTS]
    )
    for row in rows.iterator(chunk_size=settings.EXPORT_CHUNK_SIZE):
        writer.writerow([_csv_cell(v) for v in row])
        yield flush()


def csv_filename(now: dt.datetime) -> str:
    return f"twister-attempts-{now:%Y-%m-%d}.csv"
