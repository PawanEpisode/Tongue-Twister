import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q


class Difficulty(models.IntegerChoices):
    EASY = 1, "Easy"
    MEDIUM = 2, "Medium"
    HARD = 3, "Hard"
    INSANE = 4, "Insane"


class Origin(models.TextChoices):
    CLASSIC = "classic", "Classic"
    MODERN = "modern", "Modern"


class Category(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=60)
    emoji = models.CharField(max_length=8, blank=True)
    description = models.CharField(max_length=200, blank=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Twister(models.Model):
    slug = models.SlugField(unique=True, max_length=80)
    text = models.TextField()
    category = models.ForeignKey(Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="twisters")
    difficulty = models.PositiveSmallIntegerField(choices=Difficulty.choices, default=Difficulty.EASY, db_index=True)
    origin = models.CharField(max_length=10, choices=Origin.choices, default=Origin.CLASSIC, db_index=True)
    tip = models.CharField(max_length=240, blank=True, help_text="Coaching hint shown before practice")
    focus_sounds = models.JSONField(default=list, blank=True, help_text='e.g. ["s", "sh"]')
    word_count = models.PositiveSmallIntegerField(editable=False, default=0)
    is_published = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["difficulty", "id"]

    def save(self, *args, **kwargs):
        self.word_count = len(self.text.split())
        super().save(*args, **kwargs)

    def __str__(self):
        return self.text[:60]


def validate_timezone(value: str) -> None:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, OSError) as exc:
        raise ValidationError(f"'{value}' is not a valid IANA timezone.") from exc


class Plan(models.Model):
    """Entitlement tier. Only `free` ships for now (decision D11); limits are data, not code."""

    DEFAULT_CODE = "free"

    code = models.SlugField(primary_key=True, max_length=20)
    name = models.CharField(max_length=40)
    limits = models.JSONField(default=dict, blank=True)
    active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


class Profile(models.Model):
    """One row per Supabase auth user. `id` is the Supabase `sub` claim."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(blank=True)
    display_name = models.CharField(max_length=40, blank=True)
    avatar_emoji = models.CharField(max_length=8, default="🗣️")
    xp = models.PositiveIntegerField(default=0)
    current_streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)
    last_activity_date = models.DateField(null=True, blank=True, help_text="Local date of the last streak-qualifying activity")
    timezone = models.CharField(max_length=64, default="UTC", validators=[validate_timezone], help_text="IANA name; decides what 'today' means")
    plan = models.ForeignKey(Plan, to_field="code", db_column="plan_code", default=Plan.DEFAULT_CODE,
                             on_delete=models.PROTECT, related_name="profiles")
    guest_migrated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # DRF compatibility: behave like an authenticated user object.
    is_authenticated = True
    is_anonymous = False

    def __str__(self):
        return self.display_name or str(self.id)

    @property
    def level(self) -> int:
        return 1 + self.xp // 200


class Attempt(models.Model):
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="attempts")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="attempts")
    transcript = models.TextField(blank=True)
    accuracy = models.FloatField(help_text="0..1, server-computed")
    duration_ms = models.PositiveIntegerField()
    wpm = models.FloatField()
    score = models.PositiveSmallIntegerField(db_index=True)
    xp_awarded = models.PositiveSmallIntegerField(default=0)
    client_attempt_id = models.UUIDField(null=True, blank=True, help_text="Client-generated; makes imports idempotent")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["twister", "-score"]), models.Index(fields=["profile", "-created_at"])]
        constraints = [models.UniqueConstraint(fields=["profile", "client_attempt_id"], name="uniq_attempt_client_id")]


class Favorite(models.Model):
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="favorites")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="favorited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["profile", "twister"], name="uniq_favorite")]


# --- Practice Hub & Read-along (ERD 06a) -------------------------------------------------------

class PracticeMode(models.TextChoices):
    READ_ALONG = "read_along", "Read along"
    SPEAK_SCORE = "speak_score", "Speak & score"
    RECORD = "record", "Record"


class DisplayStyle(models.TextChoices):
    WORD = "word", "Word by word"
    LINE = "line", "Line by line"
    SCROLL = "scroll", "Continuous scroll"


class AccentLang(models.TextChoices):
    EN_US = "en-US", "English (US)"
    EN_GB = "en-GB", "English (UK)"
    EN_IN = "en-IN", "English (India)"
    EN_AU = "en-AU", "English (Australia)"


class RecordResolution(models.TextChoices):
    P720 = "720p", "720p"
    P1080 = "1080p", "1080p"


# Single source of truth for numeric preference bounds: feeds model validators AND DB CHECK constraints.
# NOTE threshold is 20-60 per PRD 01 §6 and API contract 07 §2 (ERD 06a said 80; docs corrected).
PREFERENCE_RANGES: dict[str, tuple[float, float]] = {
    "wpm": (40, 300),
    "threshold_pct": (20, 60),
    "font_scale": (0.8, 2.0),
    "loop_count": (0, 10),  # 0 = loop forever
    "countdown_s": (0, 5),
    "tts_rate": (0.5, 1.5),
    "metronome_volume": (0.0, 1.0),
}


def _bounded(field: str) -> list:
    lo, hi = PREFERENCE_RANGES[field]
    return [MinValueValidator(lo), MaxValueValidator(hi)]


class UserPreference(models.Model):
    """Durable Practice Hub settings. Hot settings are typed columns; the rest live in `extra`."""

    profile = models.OneToOneField(Profile, primary_key=True, on_delete=models.CASCADE, related_name="preferences")
    default_mode = models.CharField(max_length=12, choices=PracticeMode.choices, default=PracticeMode.SPEAK_SCORE)
    display_style = models.CharField(max_length=6, choices=DisplayStyle.choices, default=DisplayStyle.WORD)
    accent_lang = models.CharField(max_length=5, choices=AccentLang.choices, default=AccentLang.EN_US)
    wpm = models.PositiveSmallIntegerField(null=True, blank=True, validators=_bounded("wpm"),
                                           help_text="Null = automatic, by twister difficulty (90/110/130/150)")
    threshold_pct = models.PositiveSmallIntegerField(default=35, validators=_bounded("threshold_pct"))
    font_scale = models.FloatField(default=1.0, validators=_bounded("font_scale"))
    loop_count = models.PositiveSmallIntegerField(default=1, validators=_bounded("loop_count"))
    countdown_s = models.PositiveSmallIntegerField(default=3, validators=_bounded("countdown_s"))
    mirror_text = models.BooleanField(default=False)
    punctuation_pauses = models.BooleanField(default=True)
    metronome = models.BooleanField(default=False)
    metronome_volume = models.FloatField(default=0.5, validators=_bounded("metronome_volume"))
    listen_first = models.BooleanField(default=False)
    tts_voice = models.CharField(max_length=200, blank=True, help_text="Device-specific voiceURI; empty = default")
    tts_rate = models.FloatField(default=1.0, validators=_bounded("tts_rate"))
    reduce_motion = models.BooleanField(default=False)
    dyslexia_font = models.BooleanField(default=False)
    high_contrast = models.BooleanField(default=False)
    save_voice_default = models.BooleanField(default=False)
    record_layout = models.SlugField(max_length=24, default="camera_text")
    record_resolution = models.CharField(max_length=5, choices=RecordResolution.choices, default=RecordResolution.P720)
    speed_ladder = models.JSONField(default=dict, blank=True)
    extra = models.JSONField(default=dict, blank=True)
    schema_version = models.PositiveSmallIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(**{f"{f}__gte": lo, f"{f}__lte": hi}), name=f"pref_{f}_range")
            for f, (lo, hi) in PREFERENCE_RANGES.items()
        ]

    def __str__(self):
        return f"prefs<{self.profile_id}>"


class Submode(models.TextChoices):
    TEST = "test", "Test"
    TRAIN = "train", "Train"
    DRILL = "drill", "Drill"


class Engine(models.TextChoices):
    TEXT_LAYER = "text_layer", "Text layer"
    ONDEVICE = "ondevice", "On-device"
    WORKER = "worker", "Worker"
    NONE = "none", "None"


class SessionStatus(models.TextChoices):
    ACTIVE = "active", "Active"
    COMPLETED = "completed", "Completed"
    ABANDONED = "abandoned", "Abandoned"


class EndReason(models.TextChoices):
    USER = "user", "User"
    FINISHED = "finished", "Finished"
    TAB_HIDDEN = "tab_hidden", "Tab hidden"
    TIMEOUT = "timeout", "Timeout"
    ERROR = "error", "Error"


class PracticeSession(models.Model):
    """One continuous stretch of practice in a single mode. Append-mostly; heartbeats bump `active_ms`."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="practice_sessions")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="practice_sessions")
    client_session_id = models.CharField(max_length=64, help_text="Client-generated id; makes create idempotent")
    mode = models.CharField(max_length=12, choices=PracticeMode.choices)
    submode = models.CharField(max_length=8, choices=Submode.choices, blank=True)
    status = models.CharField(max_length=10, choices=SessionStatus.choices, default=SessionStatus.ACTIVE)
    ended_reason = models.CharField(max_length=12, choices=EndReason.choices, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    active_ms = models.PositiveIntegerField(default=0)
    loops_completed = models.PositiveSmallIntegerField(default=0)
    passes_completed = models.PositiveSmallIntegerField(default=0, help_text="Full passes through the text")
    avg_wpm = models.FloatField(null=True, blank=True)
    settings_snapshot = models.JSONField(default=dict, blank=True)
    engine = models.CharField(max_length=12, choices=Engine.choices, blank=True)
    user_agent_family = models.CharField(max_length=40, blank=True)

    class Meta:
        ordering = ["-started_at"]
        constraints = [models.UniqueConstraint(fields=["profile", "client_session_id"], name="uniq_session_client_id")]
        indexes = [models.Index(fields=["profile", "-started_at"]), models.Index(fields=["twister", "mode"])]


class DailyActivity(models.Model):
    """Per-profile, per-local-day ledger that drives streaks and capped Read-along XP."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="daily_activity")
    local_date = models.DateField()
    attempts = models.PositiveSmallIntegerField(default=0)
    active_ms = models.PositiveIntegerField(default=0)
    read_along_ms = models.PositiveIntegerField(default=0)
    read_along_passes = models.PositiveSmallIntegerField(default=0)
    xp = models.PositiveIntegerField(default=0)
    read_along_xp = models.PositiveIntegerField(default=0)
    qualifies_streak = models.BooleanField(default=False)
    freeze_used = models.BooleanField(default=False)

    class Meta:
        verbose_name_plural = "daily activity"
        constraints = [models.UniqueConstraint(fields=["profile", "local_date"], name="uniq_daily_activity")]


class SyncKind(models.TextChoices):
    GUEST_SIGNUP = "guest_signup", "Guest sign-up"
    OFFLINE_QUEUE = "offline_queue", "Offline queue"


class SyncBatch(models.Model):
    """Receipt for one idempotent import of guest/offline data (a replay returns these counts)."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="sync_batches")
    client_batch_id = models.UUIDField()
    kind = models.CharField(max_length=14, choices=SyncKind.choices, default=SyncKind.GUEST_SIGNUP)
    payload_sha256 = models.CharField(max_length=64, blank=True)
    attempts_imported = models.PositiveIntegerField(default=0)
    favorites_imported = models.PositiveIntegerField(default=0)
    rejected = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["profile", "client_batch_id"], name="uniq_sync_batch")]


class FeatureFlag(models.Model):
    """Server-driven switch. `enabled=False` is the kill switch; otherwise allow-list or percentage rollout."""

    code = models.SlugField(primary_key=True, max_length=40)
    description = models.CharField(max_length=200, blank=True)
    enabled = models.BooleanField(default=False)
    rollout_pct = models.PositiveSmallIntegerField(default=100, validators=[MaxValueValidator(100)])
    allow_list = models.JSONField(default=list, blank=True, help_text="Profile ids that always get the flag")

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(rollout_pct__lte=100), name="flag_rollout_pct_range")]

    def __str__(self):
        return self.code
