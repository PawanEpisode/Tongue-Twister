import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Q
from django.utils import timezone

from .avatars import DEFAULT_AVATAR_EMOJI, validate_avatar_emoji
from .levels import level_for
from .names import PUBLIC_NAME_MAX, validate_display_name, validate_public_name


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


class TwisterVisibility(models.TextChoices):
    """Who may see a twister (D25). `private` twisters are generated for, and only visible to, their owner."""

    PUBLIC = "public", "Public"
    PRIVATE = "private", "Private"


def public_twister_q(prefix: str = "") -> Q:
    """The one definition of 'in the public catalogue': published and public. Querysets reach it through
    `Twister.objects.public()`, joins from other models through `prefix` (`"twister__"`)."""
    return Q(**{f"{prefix}is_published": True, f"{prefix}visibility": TwisterVisibility.PUBLIC})


def visible_twister_q(profile: "Profile | None", prefix: str = "") -> Q:
    """Public twisters plus, for a signed-in caller, their own private ones (D25)."""
    q = public_twister_q(prefix)
    if profile is not None:
        q |= Q(**{f"{prefix}visibility": TwisterVisibility.PRIVATE, f"{prefix}owner": profile})
    return q


class TwisterQuerySet(models.QuerySet):
    def public(self):
        """The catalogue everyone sees: lists, daily, random, facets, boards, drill fallbacks."""
        return self.filter(public_twister_q())

    def visible_to(self, profile: "Profile | None"):
        """What one caller may open or practise: the catalogue plus their own private twisters."""
        return self.filter(visible_twister_q(profile))


class Twister(models.Model):
    slug = models.SlugField(unique=True, max_length=80)
    text = models.TextField()
    category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="twisters"
    )
    difficulty = models.PositiveSmallIntegerField(
        choices=Difficulty.choices, default=Difficulty.EASY, db_index=True
    )
    origin = models.CharField(
        max_length=10, choices=Origin.choices, default=Origin.CLASSIC, db_index=True
    )
    tip = models.CharField(
        max_length=240, blank=True, help_text="Coaching hint shown before practice"
    )
    focus_sounds = models.JSONField(default=list, blank=True, help_text='e.g. ["s", "sh"]')
    word_count = models.PositiveSmallIntegerField(editable=False, default=0)
    phonemes = models.JSONField(
        default=dict,
        blank=True,
        editable=False,
        help_text="word -> [ARPAbet variants], built offline by `build_pronunciations`",
    )
    phoneme_version = models.PositiveSmallIntegerField(default=0, editable=False)
    is_published = models.BooleanField(default=True, db_index=True)
    visibility = models.CharField(
        max_length=7,
        choices=TwisterVisibility.choices,
        default=TwisterVisibility.PUBLIC,
        db_index=True,
        help_text="`private` = generated for one person (D25); never listed for anyone else",
    )
    owner = models.ForeignKey(
        "Profile",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="generated_twisters",
        help_text="Set exactly when the twister is private",
    )
    topic = models.CharField(
        max_length=120, blank=True, help_text="What the owner asked for (generated twisters only)"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = TwisterQuerySet.as_manager()

    class Meta:
        ordering = ["difficulty", "id"]
        constraints = [
            # A private twister is owned and never `published`, so every legacy `is_published` filter
            # hides it by default; a public one has no owner. The database enforces both (D25).
            models.CheckConstraint(
                condition=(
                    Q(visibility="public", owner__isnull=True)
                    | Q(visibility="private", owner__isnull=False, is_published=False)
                ),
                name="twister_visibility_owner",
            ),
        ]

    def __str__(self):
        return self.text[:60]

    def save(self, *args, **kwargs):
        self.word_count = len(self.text.split())
        super().save(*args, **kwargs)

    @classmethod
    def slug_taken(cls, slug: str) -> bool:
        """Slugs are unique across every twister, private ones included, so this looks at all rows."""
        return cls.objects.filter(slug=slug).exists()


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


class AgeBand(models.TextChoices):
    """Self-declared once (decision D6): `under13` and `unknown` are both blocked from cloud media."""

    UNKNOWN = "unknown", "Unknown"
    UNDER13 = "under13", "Under 13"
    ADULT = "13plus", "13 or older"


def active_profile_q(prefix: str = "") -> Q:
    """Profiles that are not pending deletion (D21). The one definition of 'active': querysets reach it
    through `Profile.objects.active()`, and joins from other models through `prefix` (`"profile__"`)."""
    return Q(**{f"{prefix}deletion_requested_at__isnull": True})


class ProfileQuerySet(models.QuerySet):
    def active(self):
        return self.filter(active_profile_q())

    def pending_deletion(self):
        return self.exclude(active_profile_q())


class AvatarSource(models.TextChoices):
    PHOTO = "photo", "Sign-in photo"
    EMOJI = "emoji", "Emoji"


class Profile(models.Model):
    """One row per Supabase auth user. `id` is the Supabase `sub` claim."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(blank=True)
    canonical_email = models.CharField(
        max_length=254,
        blank=True,
        db_index=True,
        editable=False,
        help_text="The inbox this address reaches (Gmail dots and +tags folded): one account per inbox",
    )
    display_name = models.CharField(
        max_length=PUBLIC_NAME_MAX,
        blank=True,
        validators=[validate_display_name],
        help_text="Starts as the sign-in name; the person can change it. Shown to them only",
    )
    avatar_emoji = models.CharField(
        max_length=8, default=DEFAULT_AVATAR_EMOJI, validators=[validate_avatar_emoji]
    )
    avatar_source = models.CharField(
        max_length=5,
        choices=AvatarSource.choices,
        default=AvatarSource.PHOTO,
        help_text="Which avatar the person shows: their sign-in photo (when they have one) or the emoji",
    )
    public_name = models.CharField(
        max_length=PUBLIC_NAME_MAX,
        blank=True,
        default="",
        validators=[validate_public_name],
        help_text="Opt-in name shown to viewers of recordings the user shares; blank = anonymous",
    )
    xp = models.PositiveIntegerField(default=0)
    current_streak = models.PositiveIntegerField(default=0)
    best_streak = models.PositiveIntegerField(default=0)
    last_activity_date = models.DateField(
        null=True, blank=True, help_text="Local date of the last streak-qualifying activity"
    )
    timezone = models.CharField(
        max_length=64,
        default="UTC",
        validators=[validate_timezone],
        help_text="IANA name; decides what 'today' means",
    )
    timezone_confirmed = models.BooleanField(
        default=False,
        help_text="True once the person (or their browser) has set `timezone`: until then 'UTC' is a "
        "placeholder, and clock-based rules (reminders, hour badges) must not trust it",
    )
    plan = models.ForeignKey(
        Plan,
        to_field="code",
        db_column="plan_code",
        default=Plan.DEFAULT_CODE,
        on_delete=models.PROTECT,
        related_name="profiles",
    )
    age_band = models.CharField(max_length=8, choices=AgeBand.choices, default=AgeBand.UNKNOWN)
    guest_migrated_at = models.DateTimeField(null=True, blank=True)
    streak_freezes = models.PositiveSmallIntegerField(
        default=0, help_text="Banked streak freezes; one bridges one missed day (D16)"
    )
    hide_from_boards = models.BooleanField(
        default=False, help_text="Opt out of every public leaderboard (D18)"
    )
    night_owl = models.BooleanField(
        default=False,
        help_text="Streak day starts at NIGHT_OWL_CUTOFF_HOUR local time instead of midnight (D23)",
    )
    deletion_requested_at = models.DateTimeField(
        null=True, blank=True, help_text="Account is pending deletion from this moment (D21)"
    )
    deletion_scheduled_for = models.DateTimeField(
        null=True, blank=True, help_text="Purged by `purge_deleted_accounts` once this has passed"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects = ProfileQuerySet.as_manager()

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(streak_freezes__gte=0, streak_freezes__lte=settings.STREAK_FREEZE_MAX),
                name="profile_streak_freezes_range",
            ),
            models.CheckConstraint(
                condition=Q(deletion_requested_at__isnull=True, deletion_scheduled_for__isnull=True)
                | Q(
                    deletion_requested_at__isnull=False,
                    deletion_scheduled_for__isnull=False,
                    deletion_scheduled_for__gte=F("deletion_requested_at"),
                ),
                name="profile_deletion_window",
            ),
        ]

    # DRF compatibility: behave like an authenticated user object.
    is_authenticated = True
    is_anonymous = False

    def __str__(self):
        return self.display_name or str(self.id)

    @property
    def level(self) -> int:
        return level_for(self.xp)

    @property
    def pending_deletion(self) -> bool:
        return self.deletion_requested_at is not None


class AccentLang(models.TextChoices):
    EN_US = "en-US", "English (US)"
    EN_GB = "en-GB", "English (UK)"
    EN_IN = "en-IN", "English (India)"
    EN_AU = "en-AU", "English (Australia)"


class Engine(models.TextChoices):
    TEXT_LAYER = "text_layer", "Text layer"
    ONDEVICE = "ondevice", "On-device"
    WORKER = "worker", "Worker"
    NONE = "none", "None"


class AttemptKind(models.TextChoices):
    TEST = "test", "Test"
    TRAIN = "train", "Train"
    DRILL = "drill", "Drill"
    RECORD = "record", "Record"


class Verification(models.TextChoices):
    """Trust ladder (decision D8). `none` = text layer only, a practice score."""

    NONE = "none", "None"
    DEVICE = "device", "Device"
    PENDING = "pending", "Pending"
    VERIFIED = "verified", "Verified"
    FAILED = "failed", "Failed"


SCORE_VERSION_LEGACY = 1
SCORE_VERSION_CURRENT = 2


class Attempt(models.Model):
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="attempts")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="attempts")
    public_id = models.UUIDField(
        default=uuid.uuid4, unique=True, editable=False, help_text="For score-card sharing"
    )
    session = models.ForeignKey(
        "PracticeSession", null=True, blank=True, on_delete=models.SET_NULL, related_name="attempts"
    )
    kind = models.CharField(
        max_length=6, choices=AttemptKind.choices, default=AttemptKind.TEST, db_index=True
    )
    transcript = models.TextField(blank=True)
    accuracy = models.FloatField(help_text="0..1, server-computed")
    speed_score = models.FloatField(null=True, blank=True, help_text="0..1 (v2)")
    fluency_score = models.FloatField(null=True, blank=True, help_text="0..1 (v2)")
    gop_score = models.FloatField(
        null=True, blank=True, help_text="Acoustic score from our engine, 0..100"
    )
    completeness = models.FloatField(
        null=True, blank=True, help_text="Share of expected words found"
    )
    duration_ms = models.PositiveIntegerField()
    long_pause_ms = models.PositiveIntegerField(default=0)
    wpm = models.FloatField()
    score = models.PositiveSmallIntegerField(db_index=True)
    score_version = models.PositiveSmallIntegerField(default=SCORE_VERSION_CURRENT)
    xp_awarded = models.PositiveSmallIntegerField(default=0)
    client_attempt_id = models.UUIDField(
        null=True, blank=True, help_text="Client-generated; makes submissions idempotent"
    )
    engine = models.CharField(max_length=12, choices=Engine.choices, default=Engine.TEXT_LAYER)
    engine_version = models.CharField(max_length=40, blank=True)
    engine_confidence = models.FloatField(null=True, blank=True)
    model_version = models.ForeignKey(
        "AcousticModelVersion",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="attempts",
    )
    scoring_profile = models.ForeignKey(
        "ScoringProfile", null=True, blank=True, on_delete=models.PROTECT, related_name="attempts"
    )
    nonce = models.UUIDField(null=True, blank=True, help_text="Per-attempt anti-replay token")
    # NULL (not "") when absent, so the partial unique index below ignores it.
    audio_sha256 = models.CharField(max_length=64, null=True, blank=True)  # noqa: DJ001
    quality = models.JSONField(default=dict, blank=True, help_text="snr, clipping, blank_ratio")
    spot_checked = models.BooleanField(default=False)
    spot_check_delta = models.FloatField(
        null=True,
        blank=True,
        help_text="Signed: device score minus worker score (positive = generous)",
    )
    spot_check_requested_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the server asked the client for the audio (docs/features/13 §3.3)",
    )
    lang = models.CharField(max_length=5, choices=AccentLang.choices, blank=True)
    verification_status = models.CharField(
        max_length=8, choices=Verification.choices, default=Verification.NONE
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    is_personal_best = models.BooleanField(default=False)
    flagged = models.BooleanField(default=False)
    breakdown = models.JSONField(
        default=dict, blank=True, help_text="Aggregate for train/drill (no AttemptWord rows)"
    )
    voice_asset = models.ForeignKey(
        "MediaAsset",
        null=True,
        blank=True,
        db_column="voice_asset_id",
        on_delete=models.SET_NULL,
        related_name="voiced_attempts",
        help_text="Opt-in cloud copy of the audio (kind=audio); the id stays `voice_asset_id` in code and column",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["twister", "-score"]),
            models.Index(fields=["profile", "-created_at"]),
            models.Index(fields=["profile", "twister", "-created_at"], name="attempt_hist_idx"),
            models.Index(
                fields=["twister", "-score"],
                name="attempt_board_idx",
                condition=Q(verification_status="verified", flagged=False, kind="test"),
            ),
            models.Index(
                fields=["verification_status", "created_at"],
                name="attempt_pending_idx",
                condition=Q(verification_status="pending"),
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "client_attempt_id"], name="uniq_attempt_client_id"
            ),
            models.UniqueConstraint(
                fields=["profile", "nonce"],
                condition=Q(nonce__isnull=False),
                name="uniq_attempt_nonce",
            ),
            models.UniqueConstraint(
                fields=["audio_sha256"],
                condition=Q(audio_sha256__isnull=False),
                name="uniq_attempt_audio_hash",
            ),
            models.CheckConstraint(condition=Q(score__lte=100), name="attempt_score_range"),
        ]

    def __str__(self):
        return f"{self.score} on {self.twister_id}"


class Favorite(models.Model):
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="favorites")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="favorited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["profile", "twister"], name="uniq_favorite")]

    def __str__(self):
        return f"{self.profile_id}:{self.twister_id}"


# --- Practice Hub & Read-along (ERD 06a) -------------------------------------------------------


class PracticeMode(models.TextChoices):
    READ_ALONG = "read_along", "Read along"
    SPEAK_SCORE = "speak_score", "Speak & score"
    RECORD = "record", "Record"


class DisplayStyle(models.TextChoices):
    WORD = "word", "Word by word"
    LINE = "line", "Line by line"
    SCROLL = "scroll", "Continuous scroll"


class ThemeChoice(models.TextChoices):
    SYSTEM = "system", "System"
    LIGHT = "light", "Light"
    DARK = "dark", "Dark"
    READING = "reading", "Reading"


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
    "daily_goal_attempts": (0, 50),  # 0 = no goal
}


def _bounded(field: str) -> list:
    lo, hi = PREFERENCE_RANGES[field]
    return [MinValueValidator(lo), MaxValueValidator(hi)]


class UserPreference(models.Model):
    """Durable Practice Hub settings. Hot settings are typed columns; the rest live in `extra`."""

    profile = models.OneToOneField(
        Profile, primary_key=True, on_delete=models.CASCADE, related_name="preferences"
    )
    default_mode = models.CharField(
        max_length=12, choices=PracticeMode.choices, default=PracticeMode.SPEAK_SCORE
    )
    display_style = models.CharField(
        max_length=6, choices=DisplayStyle.choices, default=DisplayStyle.WORD
    )
    accent_lang = models.CharField(
        max_length=5, choices=AccentLang.choices, default=AccentLang.EN_US
    )
    wpm = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=_bounded("wpm"),
        help_text="Null = automatic, by twister difficulty (90/110/130/150)",
    )
    threshold_pct = models.PositiveSmallIntegerField(
        default=35, validators=_bounded("threshold_pct")
    )
    font_scale = models.FloatField(default=1.0, validators=_bounded("font_scale"))
    loop_count = models.PositiveSmallIntegerField(default=1, validators=_bounded("loop_count"))
    countdown_s = models.PositiveSmallIntegerField(default=3, validators=_bounded("countdown_s"))
    mirror_text = models.BooleanField(default=False)
    punctuation_pauses = models.BooleanField(default=True)
    metronome = models.BooleanField(default=False)
    metronome_volume = models.FloatField(default=0.5, validators=_bounded("metronome_volume"))
    listen_first = models.BooleanField(default=False)
    tts_voice = models.CharField(
        max_length=200, blank=True, help_text="Device-specific voiceURI; empty = default"
    )
    tts_rate = models.FloatField(default=1.0, validators=_bounded("tts_rate"))
    reduce_motion = models.BooleanField(default=False)
    dyslexia_font = models.BooleanField(default=False)
    high_contrast = models.BooleanField(default=False)
    theme = models.CharField(
        max_length=7,
        choices=ThemeChoice.choices,
        blank=True,
        default="",
        help_text="Blank = never chosen on any device: the first device that signs in seeds it",
    )
    confetti = models.BooleanField(default=True)
    daily_goal_attempts = models.PositiveSmallIntegerField(
        default=0,
        validators=_bounded("daily_goal_attempts"),
        help_text="Attempts to aim for each local day; 0 = no goal",
    )
    save_voice_default = models.BooleanField(default=False)
    record_layout = models.SlugField(max_length=24, default="camera_text")
    record_resolution = models.CharField(
        max_length=5, choices=RecordResolution.choices, default=RecordResolution.P720
    )
    speed_ladder = models.JSONField(default=dict, blank=True)
    extra = models.JSONField(default=dict, blank=True)
    schema_version = models.PositiveSmallIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(**{f"{f}__gte": lo, f"{f}__lte": hi}), name=f"pref_{f}_range"
            )
            for f, (lo, hi) in PREFERENCE_RANGES.items()
        ]

    def __str__(self):
        return f"prefs<{self.profile_id}>"


class ProfileEventKind(models.TextChoices):
    LEVEL_UP = "level_up", "Level up"
    ACHIEVEMENT = "achievement", "Achievement"
    STREAK_MILESTONE = "streak_milestone", "Streak milestone"
    TWISTER_MASTERED = "twister_mastered", "Twister mastered"
    PERSONAL_BEST = "personal_best", "Personal best"


class ProfileEvent(models.Model):
    """One moment on a person's profile timeline. Append-only; `ref` makes recording idempotent, so a
    replayed request or a retried job can never add the same moment twice."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=20, choices=ProfileEventKind.choices)
    ref = models.CharField(
        max_length=80, help_text="Natural key, e.g. 'level:5' or 'ach:first-steps'"
    )
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["profile", "ref"], name="uniq_profile_event_ref")
        ]
        indexes = [models.Index(fields=["profile", "-created_at"], name="profile_event_recent")]

    def __str__(self):
        return f"{self.profile_id} {self.ref}"


class ReminderPreference(models.Model):
    """Practice reminder by e-mail (D27). One optional row per profile; no row means "off".

    `hour_local` is a wall-clock hour in the profile's own timezone. `last_sent_on` is the streak day
    (`localtime.local_date`) of the last mail, which is what limits it to one per person per day.
    """

    profile = models.OneToOneField(
        Profile, primary_key=True, on_delete=models.CASCADE, related_name="reminder_preference"
    )
    enabled = models.BooleanField(default=False)
    hour_local = models.PositiveSmallIntegerField(
        default=18, validators=[MinValueValidator(0), MaxValueValidator(23)]
    )
    last_sent_on = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(hour_local__gte=0, hour_local__lte=23),
                name="reminder_hour_local_range",
            )
        ]

    def __str__(self):
        return f"reminder<{self.profile_id}>"


class Submode(models.TextChoices):
    TEST = "test", "Test"
    TRAIN = "train", "Train"
    DRILL = "drill", "Drill"


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
    client_session_id = models.CharField(
        max_length=64, help_text="Client-generated id; makes create idempotent"
    )
    mode = models.CharField(max_length=12, choices=PracticeMode.choices)
    submode = models.CharField(max_length=8, choices=Submode.choices, blank=True)
    status = models.CharField(
        max_length=10, choices=SessionStatus.choices, default=SessionStatus.ACTIVE
    )
    ended_reason = models.CharField(max_length=12, choices=EndReason.choices, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    active_ms = models.PositiveIntegerField(default=0)
    loops_completed = models.PositiveSmallIntegerField(default=0)
    passes_completed = models.PositiveSmallIntegerField(
        default=0, help_text="Full passes through the text"
    )
    avg_wpm = models.FloatField(null=True, blank=True)
    settings_snapshot = models.JSONField(default=dict, blank=True)
    engine = models.CharField(max_length=12, choices=Engine.choices, blank=True)
    user_agent_family = models.CharField(max_length=40, blank=True)

    class Meta:
        ordering = ["-started_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "client_session_id"], name="uniq_session_client_id"
            )
        ]
        indexes = [
            models.Index(fields=["profile", "-started_at"]),
            models.Index(fields=["twister", "mode"]),
        ]

    def __str__(self):
        return f"{self.mode} {self.status}"


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
        constraints = [
            models.UniqueConstraint(fields=["profile", "local_date"], name="uniq_daily_activity")
        ]

    def __str__(self):
        return f"{self.profile_id} {self.local_date}"


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
        constraints = [
            models.UniqueConstraint(fields=["profile", "client_batch_id"], name="uniq_sync_batch")
        ]

    def __str__(self):
        return f"{self.kind} {self.client_batch_id}"


class FeatureFlag(models.Model):
    """Server-driven switch. `enabled=False` is the kill switch; otherwise allow-list or percentage rollout."""

    code = models.SlugField(primary_key=True, max_length=40)
    description = models.CharField(max_length=200, blank=True)
    enabled = models.BooleanField(default=False)
    rollout_pct = models.PositiveSmallIntegerField(default=100, validators=[MaxValueValidator(100)])
    allow_list = models.JSONField(
        default=list, blank=True, help_text="Profile ids that always get the flag"
    )

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(rollout_pct__lte=100), name="flag_rollout_pct_range")
        ]

    def __str__(self):
        return self.code


# --- Speak & Score (ERD 06b) -------------------------------------------------------------------


class WordStatus(models.TextChoices):
    CORRECT = "correct", "Correct"
    NEAR = "near", "Near"
    WRONG = "wrong", "Wrong"
    MISSED = "missed", "Missed"
    EXTRA = "extra", "Extra"


class WordReason(models.TextChoices):
    HOMOPHONE = "homophone", "Homophone"
    FOCUS_SWAP = "focus_swap", "Focus sound swapped"
    SLURRED = "slurred", "Slurred"
    UNCERTAIN = "uncertain", "Uncertain"
    LOW_CONF = "low_conf", "Low confidence"


class PhonemeVerdict(models.TextChoices):
    OK = "ok", "OK"
    WEAK = "weak", "Weak"
    SUBSTITUTED = "substituted", "Substituted"
    DELETED = "deleted", "Deleted"
    UNCERTAIN = "uncertain", "Uncertain"


def _in(field: str, choices: type[models.TextChoices]) -> Q:
    return Q(**{f"{field}__in": choices.values})


class TwisterPronunciation(models.Model):
    """Per-word override for the lexicon (names, rare words). `twister=NULL` applies to every twister."""

    class Source(models.TextChoices):
        CMUDICT = "cmudict", "CMUdict"
        RULE = "rule", "Rule"
        OVERRIDE = "override", "Override"
        G2P = "g2p", "G2P"

    twister = models.ForeignKey(
        Twister, null=True, blank=True, on_delete=models.CASCADE, related_name="pronunciations"
    )
    word = models.CharField(max_length=64, help_text="Normalised (see speak.normalise)")
    arpabet = models.CharField(
        max_length=200,
        blank=True,
        help_text="Space-separated phones; alternative pronunciations are separated by ' | '",
    )
    ipa = models.CharField(max_length=200, blank=True)
    respelling = models.CharField(max_length=80, blank=True, help_text="e.g. PEK-uhld")
    accepted_variants = models.JSONField(
        default=list, blank=True, help_text="Spoken forms counted correct"
    )
    accent = models.CharField(
        max_length=5, choices=AccentLang.choices, blank=True, help_text="Blank = every accent"
    )
    source = models.CharField(max_length=8, choices=Source.choices, default=Source.OVERRIDE)
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["twister", "word", "accent"], name="uniq_pronunciation_per_twister"
            ),
            models.UniqueConstraint(
                fields=["word", "accent"],
                condition=Q(twister__isnull=True),
                name="uniq_pronunciation_global",
            ),
        ]

    def __str__(self):
        return f"{self.word} /{self.arpabet}/"


class AttemptWord(models.Model):
    """One aligned word of a Test/Record attempt. `target_index` is null for extras, `spoken_index` for misses."""

    attempt = models.ForeignKey(Attempt, on_delete=models.CASCADE, related_name="words")
    target_index = models.PositiveSmallIntegerField(null=True, blank=True)
    spoken_index = models.PositiveSmallIntegerField(null=True, blank=True)
    target_word = models.CharField(max_length=64, blank=True)
    spoken_word = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=8, choices=WordStatus.choices)
    reason = models.CharField(max_length=12, choices=WordReason.choices, blank=True)
    credit = models.FloatField()
    confidence = models.FloatField(null=True, blank=True)
    acoustic_score = models.FloatField(null=True, blank=True, help_text="0..100 from GOP features")
    phoneme_distance = models.FloatField(null=True, blank=True)
    start_ms = models.PositiveIntegerField(null=True, blank=True)
    end_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["attempt"])]
        constraints = [
            models.CheckConstraint(condition=_in("status", WordStatus), name="attemptword_status")
        ]

    def __str__(self):
        return f"{self.status}: {self.target_word or self.spoken_word}"


class AttemptPhoneme(models.Model):
    """Written only for attempts scored by the device/worker engine (~3-4x words per twister)."""

    attempt_word = models.ForeignKey(AttemptWord, on_delete=models.CASCADE, related_name="phonemes")
    idx = models.PositiveSmallIntegerField()
    target_phoneme = models.CharField(max_length=8)
    heard_phoneme = models.CharField(max_length=8, blank=True, help_text="Empty if deleted")
    variant_used = models.CharField(max_length=40, blank=True)
    verdict = models.CharField(max_length=12, choices=PhonemeVerdict.choices)
    delta = models.FloatField(
        null=True, blank=True, help_text="Substitution test, log-likelihood ratio"
    )
    lpp = models.FloatField(null=True, blank=True, help_text="Mean log posterior of target")
    lpr = models.FloatField(
        null=True, blank=True, help_text="Log posterior ratio vs best competitor"
    )
    start_ms = models.PositiveIntegerField(null=True, blank=True)
    end_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["attempt_word_id", "idx"]
        indexes = [
            models.Index(fields=["attempt_word"]),
            models.Index(
                fields=["target_phoneme", "heard_phoneme"],
                name="phoneme_sub_idx",
                condition=Q(verdict="substituted"),
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=_in("verdict", PhonemeVerdict), name="attemptphoneme_verdict"
            )
        ]

    def __str__(self):
        return f"{self.target_phoneme}>{self.heard_phoneme or '-'} {self.verdict}"


class UserWordStat(models.Model):
    """Per-user, per-word tallies: powers 'practise weak words' and the spaced-review queue."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="word_stats")
    word_norm = models.CharField(max_length=64)
    seen = models.PositiveIntegerField(default=0)
    correct = models.PositiveIntegerField(default=0)
    near = models.PositiveIntegerField(default=0)
    wrong = models.PositiveIntegerField(default=0)
    missed = models.PositiveIntegerField(default=0)
    recent_error_rate = models.FloatField(default=0.0, help_text="EMA of per-attempt error (0..1)")
    weakness = models.FloatField(default=0.0, help_text="0..1, recency-weighted")
    last_seen_at = models.DateTimeField(null=True, blank=True)
    next_review_at = models.DateTimeField(null=True, blank=True)
    streak_correct = models.PositiveSmallIntegerField(default=0)
    mastered_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Set by a confident drill pass; cleared by the next wrong or missed word. "
        "While set, the word is 'nailed' and leaves the weak-word queue.",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["profile", "word_norm"], name="uniq_word_stat"),
            models.CheckConstraint(
                condition=Q(weakness__gte=0, weakness__lte=1), name="wordstat_weakness_range"
            ),
        ]
        indexes = [
            models.Index(fields=["profile", "-weakness"]),
            models.Index(fields=["profile", "next_review_at"]),
            models.Index(fields=["profile", "-mastered_at"]),
        ]

    def __str__(self):
        return f"{self.word_norm} ({self.weakness:.2f})"


class UserPhonemeStat(models.Model):
    """`phoneme_pair` is `TARGET>HEARD` (e.g. S>SH; `S>-` for a deletion). `S>S` rows count every observation."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="phoneme_stats")
    phoneme_pair = models.CharField(max_length=20)
    occurrences = models.PositiveIntegerField(default=0)
    errors = models.PositiveIntegerField(default=0)
    error_rate = models.FloatField(default=0.0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["profile", "phoneme_pair"], name="uniq_phoneme_stat")
        ]

    def __str__(self):
        return self.phoneme_pair


class UserTwisterStats(models.Model):
    """Single-row read for the side panel and mastery. Maintained in the attempt transaction."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="twister_stats")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="user_stats")
    attempts_count = models.PositiveIntegerField(default=0)
    test_attempts_count = models.PositiveIntegerField(default=0)
    best_score = models.PositiveSmallIntegerField(null=True, blank=True, help_text="Verified test")
    best_practice_score = models.PositiveSmallIntegerField(
        null=True, blank=True, help_text="Provisional test"
    )
    best_test_score = models.PositiveSmallIntegerField(null=True, blank=True)
    last_score = models.PositiveSmallIntegerField(null=True, blank=True)
    first_attempt_at = models.DateTimeField(null=True, blank=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    mastered_at = models.DateTimeField(null=True, blank=True)
    mastery_days_hit = models.PositiveSmallIntegerField(default=0)
    mastery_last_day = models.DateField(null=True, blank=True)

    class Meta:
        verbose_name_plural = "user twister stats"
        constraints = [
            models.UniqueConstraint(fields=["profile", "twister"], name="uniq_user_twister_stats")
        ]
        indexes = [models.Index(fields=["profile", "mastered_at"])]

    def __str__(self):
        return f"{self.profile_id}:{self.twister_id}"


class AcousticModelVersion(models.Model):
    class Quantization(models.TextChoices):
        FP32 = "fp32", "fp32"
        FP16 = "fp16", "fp16"
        INT8 = "int8", "int8"

    name = models.CharField(max_length=80, help_text="e.g. w2v-espeak-lv60-int8-r1")
    base_model = models.CharField(max_length=120)
    licence = models.CharField(max_length=60)
    quantization = models.CharField(max_length=4, choices=Quantization.choices)
    size_bytes = models.BigIntegerField()
    sha256 = models.CharField(max_length=64, unique=True)
    download_url = models.URLField(
        blank=True, help_text="Our own storage, never a third-party host"
    )
    label_map_version = models.CharField(max_length=20)
    active = models.BooleanField(default=False)
    released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-released_at", "-id"]

    def __str__(self):
        return self.name


class ScoringProfile(models.Model):
    code = models.CharField(max_length=40, unique=True, help_text="e.g. sp-2026-10-a")
    model_version = models.ForeignKey(
        AcousticModelVersion, on_delete=models.PROTECT, related_name="scoring_profiles"
    )
    thresholds = models.JSONField(default=dict, blank=True)
    accent_packs = models.JSONField(default=dict, blank=True)
    confusion_map = models.JSONField(default=dict, blank=True)
    calibration_set = models.CharField(max_length=80, blank=True)
    active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["model_version"],
                condition=Q(active=True),
                name="uniq_active_profile_per_model",
            )
        ]

    def __str__(self):
        return self.code


class ScoringJob(models.Model):
    class Kind(models.TextChoices):
        SPOT_CHECK = "spot_check", "Spot check"
        VERIFY = "verify", "Verify"
        DEVICE_UNSUPPORTED = "device_unsupported", "Device unsupported"
        RECORD = "record", "Record"  # scores a recording's analysis audio into an Attempt (A5)

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    attempt = models.ForeignKey(
        Attempt, null=True, blank=True, on_delete=models.CASCADE, related_name="scoring_jobs"
    )
    recording = models.ForeignKey(
        "Recording",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="scoring_jobs",
        help_text="Set for kind=record: the recording whose analysis audio is scored",
    )
    audio_asset = models.ForeignKey(
        "MediaAsset",
        null=True,
        blank=True,
        db_column="audio_asset_id",
        on_delete=models.SET_NULL,
        related_name="scoring_jobs",
    )
    kind = models.CharField(max_length=20, choices=Kind.choices)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.QUEUED)
    tries = models.PositiveSmallIntegerField(default=0)
    max_tries = models.PositiveSmallIntegerField(default=3)
    locked_until = models.DateTimeField(
        null=True, blank=True, help_text="Lease; a running job past it is re-queued"
    )
    worker_id = models.CharField(max_length=80, blank=True)
    result = models.JSONField(
        default=dict, blank=True, help_text="Worker summary: no audio, no transcript"
    )
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    error_code = models.CharField(max_length=40, blank=True)
    model_version = models.ForeignKey(
        AcousticModelVersion, on_delete=models.PROTECT, related_name="jobs"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["status", "created_at"]), models.Index(fields=["attempt"])]
        constraints = [
            models.UniqueConstraint(
                fields=["attempt", "kind"],
                condition=Q(status__in=["queued", "running"]),
                name="uniq_active_scoring_job",
            ),
            models.UniqueConstraint(
                fields=["recording", "kind"],
                condition=Q(status__in=["queued", "running"]),
                name="uniq_active_record_scoring_job",
            ),
            models.CheckConstraint(
                condition=Q(tries__lte=models.F("max_tries")), name="scoring_job_tries_le_max"
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        attempt__isnull=False,
                        recording__isnull=True,
                        kind__in=["spot_check", "verify", "device_unsupported"],
                    )
                )
                | Q(attempt__isnull=True, recording__isnull=False, kind="record"),
                name="scoring_job_one_subject",
            ),
        ]

    ACTIVE = ("queued", "running")

    def __str__(self):
        return f"{self.kind} {self.status}"

    @property
    def owner(self) -> "Profile":
        """Whose audio this is (spot-checks hang off an attempt, record jobs off a recording)."""
        return (self.recording or self.attempt).profile


class AttemptFeedback(models.Model):
    """'Was this verdict right?' — feeds threshold calibration. One row per (word, user)."""

    attempt_word = models.ForeignKey(AttemptWord, on_delete=models.CASCADE, related_name="feedback")
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="word_feedback")
    judged_correct = models.BooleanField(help_text="User says the verdict was right")
    comment = models.CharField(max_length=200, blank=True)
    donated_audio = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "attempt feedback"
        indexes = [models.Index(fields=["attempt_word"])]
        constraints = [
            models.UniqueConstraint(fields=["attempt_word", "profile"], name="uniq_word_feedback")
        ]

    def __str__(self):
        return f"{self.attempt_word_id} {'👍' if self.judged_correct else '👎'}"


# --- Record, media, sharing & consent (ERD 06c) ------------------------------------------------

MAX_ASSET_BYTES = 100 * 1024 * 1024  # hard ceiling for any one object (DB CHECK); plans go lower
MAX_RECORDING_MS = 600_000  # 10 minutes: the longest recording any plan may ever allow


class InvalidTransition(Exception):
    """A status change that the state machine (ERD 06 §4) does not allow."""


class StateMachine:
    """Mixin: every status change goes through `transition()` so illegal edges cannot be written by
    accident and each edge is defined once, next to the model (ERD 06 §4)."""

    TRANSITIONS: dict[str, frozenset[str]] = {}

    def transition(self, new: str, **fields) -> bool:
        """Move to `new` (saving `fields` with it). Returns False when already there (idempotent)."""
        if self.status == new:
            return False
        if new not in self.TRANSITIONS.get(self.status, frozenset()):
            raise InvalidTransition(f"{type(self).__name__}: {self.status} -> {new}")
        self.status = new
        for name, value in fields.items():
            setattr(self, name, value)
        self.save(update_fields=["status", *fields])
        return True


class MediaKind(models.TextChoices):
    AUDIO = "audio", "Audio"
    VIDEO = "video", "Video"
    IMAGE = "image", "Image"
    CAPTION = "caption", "Caption"


class MediaStatus(models.TextChoices):
    PENDING_UPLOAD = "pending_upload", "Pending upload"
    UPLOADING = "uploading", "Uploading"
    UPLOADED = "uploaded", "Uploaded"
    PROCESSING = "processing", "Processing"
    READY = "ready", "Ready"
    FAILED = "failed", "Failed"
    DELETED = "deleted", "Deleted"


class MediaAsset(StateMachine, models.Model):
    """One object in a private storage bucket. Rows are tombstoned (`deleted`), never removed, so the
    storage ledger keeps a complete audit trail."""

    TRANSITIONS = {
        MediaStatus.PENDING_UPLOAD: frozenset({"uploading", "uploaded", "failed", "deleted"}),
        MediaStatus.UPLOADING: frozenset({"uploaded", "failed", "deleted"}),
        MediaStatus.UPLOADED: frozenset({"processing", "ready", "failed", "deleted"}),
        MediaStatus.PROCESSING: frozenset({"ready", "failed", "deleted"}),
        MediaStatus.READY: frozenset({"processing", "deleted"}),
        MediaStatus.FAILED: frozenset({"uploading", "uploaded", "processing", "deleted"}),
        MediaStatus.DELETED: frozenset(),
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="media_assets")
    kind = models.CharField(max_length=8, choices=MediaKind.choices)
    bucket = models.CharField(max_length=20)
    path = models.CharField(max_length=200)
    mime_type = models.CharField(max_length=100)
    size_bytes = models.BigIntegerField(default=0)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    checksum_sha256 = models.CharField(max_length=64, blank=True)
    status = models.CharField(
        max_length=14, choices=MediaStatus.choices, default=MediaStatus.PENDING_UPLOAD
    )
    upload_id = models.CharField(max_length=120, blank=True)
    upload_attempts = models.PositiveSmallIntegerField(default=0)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["bucket", "path"], name="uniq_asset_object"),
            models.CheckConstraint(
                condition=Q(size_bytes__gte=0, size_bytes__lte=MAX_ASSET_BYTES),
                name="asset_size_range",
            ),
            models.CheckConstraint(condition=_in("kind", MediaKind), name="asset_kind"),
            models.CheckConstraint(condition=_in("status", MediaStatus), name="asset_status"),
        ]
        indexes = [
            models.Index(fields=["status", "created_at"], name="asset_sweep_idx"),
            models.Index(
                fields=["expires_at"],
                name="asset_expiry_idx",
                condition=Q(expires_at__isnull=False, deleted_at__isnull=True),
            ),
            models.Index(fields=["profile", "kind"], name="asset_owner_idx"),
        ]

    def __str__(self):
        return f"{self.kind} {self.status}"


class RecordingStatus(models.TextChoices):
    RECORDING = "recording", "Recording"
    LOCAL_READY = "local_ready", "Local ready"
    UPLOADING = "uploading", "Uploading"
    UPLOADED = "uploaded", "Uploaded"
    PROCESSING = "processing", "Processing"
    READY = "ready", "Ready"
    FAILED = "failed", "Failed"
    DELETED = "deleted", "Deleted"


class Visibility(models.TextChoices):
    """No `public` value on purpose: there is no gallery (decision D2)."""

    PRIVATE = "private", "Private"
    UNLISTED = "unlisted", "Unlisted"


class CaptureSource(models.TextChoices):
    GET_USER_MEDIA = "getUserMedia", "getUserMedia"
    GET_DISPLAY_MEDIA = "getDisplayMedia", "getDisplayMedia"
    REGION_CAPTURE = "region_capture", "Region capture"
    ELEMENT_CAPTURE = "element_capture", "Element capture"


class RecordingEndReason(models.TextChoices):
    USER = "user", "User"
    LIMIT = "limit", "Limit"
    DEVICE = "device", "Device"
    ERROR = "error", "Error"
    TAB_HIDDEN = "tab_hidden", "Tab hidden"


class CaptionsSource(models.TextChoices):
    NONE = "none", "None"
    ALIGNMENT = "alignment", "Alignment"


class Recording(StateMachine, models.Model):
    """A cloud-saved take. Local-only recordings never reach the server (PRD 04 V6)."""

    TRANSITIONS = {
        RecordingStatus.RECORDING: frozenset({"local_ready", "uploading", "failed", "deleted"}),
        RecordingStatus.LOCAL_READY: frozenset({"uploading", "failed", "deleted"}),
        RecordingStatus.UPLOADING: frozenset({"uploaded", "failed", "deleted"}),
        RecordingStatus.UPLOADED: frozenset({"processing", "ready", "failed", "deleted"}),
        RecordingStatus.PROCESSING: frozenset({"ready", "failed", "deleted"}),
        RecordingStatus.READY: frozenset({"processing", "deleted"}),
        RecordingStatus.FAILED: frozenset({"processing", "uploaded", "deleted"}),
        RecordingStatus.DELETED: frozenset(),
    }

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="recordings")
    client_recording_id = models.UUIDField(help_text="Client-generated; makes create idempotent")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="recordings")
    session = models.ForeignKey(
        PracticeSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="recordings"
    )
    attempt = models.OneToOneField(
        Attempt, null=True, blank=True, on_delete=models.SET_NULL, related_name="recording"
    )
    title = models.CharField(max_length=80, blank=True)
    notes = models.CharField(max_length=1000, blank=True)
    layout = models.SlugField(
        max_length=24,
        default="camera_text",
        help_text="Layout id from the web registry; deliberately not an enum so adding one is web-only",
    )
    layout_settings = models.JSONField(default=dict, blank=True)
    crop_rect = models.JSONField(null=True, blank=True)
    trim_start_ms = models.PositiveIntegerField(default=0)
    trim_end_ms = models.PositiveIntegerField(null=True, blank=True)
    has_camera = models.BooleanField(default=False)
    has_screen = models.BooleanField(default=False)
    has_mic = models.BooleanField(default=True)
    has_system_audio = models.BooleanField(default=False)
    duration_ms = models.PositiveIntegerField()
    width = models.PositiveSmallIntegerField(null=True, blank=True)
    height = models.PositiveSmallIntegerField(null=True, blank=True)
    fps = models.PositiveSmallIntegerField(null=True, blank=True)
    mime_type = models.CharField(max_length=120)
    size_bytes = models.BigIntegerField()
    capture_source = models.CharField(
        max_length=16, choices=CaptureSource.choices, default=CaptureSource.GET_USER_MEDIA
    )
    status = models.CharField(
        max_length=12, choices=RecordingStatus.choices, default=RecordingStatus.UPLOADING
    )
    failure_reason = models.CharField(max_length=60, blank=True)
    recovered = models.BooleanField(default=False, help_text="Rebuilt from IndexedDB chunks")
    video_asset = models.OneToOneField(
        MediaAsset, null=True, on_delete=models.SET_NULL, related_name="video_of"
    )
    thumbnail_asset = models.OneToOneField(
        MediaAsset, null=True, blank=True, on_delete=models.SET_NULL, related_name="thumbnail_of"
    )
    captions_asset = models.OneToOneField(
        MediaAsset, null=True, blank=True, on_delete=models.SET_NULL, related_name="captions_of"
    )
    audio_asset = models.OneToOneField(
        MediaAsset,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="analysis_audio_of",
        help_text="16 kHz mono WAV made by the worker for later analysis (A2.3)",
    )
    captions_source = models.CharField(
        max_length=9, choices=CaptionsSource.choices, default=CaptionsSource.NONE
    )
    visibility = models.CharField(
        max_length=8, choices=Visibility.choices, default=Visibility.PRIVATE
    )
    ended_reason = models.CharField(max_length=10, choices=RecordingEndReason.choices, blank=True)
    consented_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    reminder_sent_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the T-3 day expiry e-mail covering this take went out",
    )
    deleted_at = models.DateTimeField(null=True, blank=True)
    hidden_at = models.DateTimeField(
        null=True, blank=True, help_text="Set by moderation; a hidden take cannot be shared"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "client_recording_id"], name="uniq_recording_client_id"
            ),
            models.CheckConstraint(
                condition=Q(trim_end_ms__isnull=True) | Q(trim_end_ms__gt=F("trim_start_ms")),
                name="recording_trim_order",
            ),
            models.CheckConstraint(
                condition=Q(duration_ms__lte=MAX_RECORDING_MS), name="recording_duration_max"
            ),
            models.CheckConstraint(
                condition=Q(size_bytes__gte=0, size_bytes__lte=MAX_ASSET_BYTES),
                name="recording_size_range",
            ),
            models.CheckConstraint(
                condition=_in("visibility", Visibility), name="recording_visibility"
            ),
            models.CheckConstraint(
                condition=_in("status", RecordingStatus), name="recording_status"
            ),
        ]
        indexes = [
            models.Index(
                fields=["profile", "-created_at"],
                name="recording_owner_idx",
                condition=Q(deleted_at__isnull=True),
            ),
            models.Index(
                fields=["expires_at"],
                name="recording_expiry_idx",
                condition=Q(deleted_at__isnull=True),
            ),
            models.Index(
                fields=["deleted_at"],
                name="recording_purge_idx",
                condition=Q(deleted_at__isnull=False),
            ),
        ]

    def __str__(self):
        return self.title or str(self.id)


class JobKind(models.TextChoices):
    PROCESS = "process", "Process"
    ANALYSE = "analyse", "Analyse"


class JobStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    RUNNING = "running", "Running"
    DONE = "done", "Done"
    FAILED = "failed", "Failed"


def default_job_max_tries() -> int:
    return settings.MEDIA_JOB_MAX_TRIES


class MediaJob(StateMachine, models.Model):
    """Work for the media worker (transcode/thumbnail/captions, or audio extraction for analysis).

    A worker *claims* a job and holds a lease (`locked_until`) that it extends with heartbeats; the
    sweeper re-queues jobs whose lease ran out and fails those that used up `max_tries`.
    """

    TRANSITIONS = {
        JobStatus.QUEUED: frozenset(
            {"running", "done", "failed"}
        ),  # done: a late result after a lapse
        JobStatus.RUNNING: frozenset({"queued", "done", "failed"}),
        JobStatus.DONE: frozenset(),
        JobStatus.FAILED: frozenset(),
    }
    ACTIVE = (JobStatus.QUEUED, JobStatus.RUNNING)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recording = models.ForeignKey(Recording, on_delete=models.CASCADE, related_name="jobs")
    asset = models.ForeignKey(
        MediaAsset,
        on_delete=models.CASCADE,
        related_name="jobs",
        help_text="The source video asset the job reads",
    )
    kind = models.CharField(max_length=8, choices=JobKind.choices)
    status = models.CharField(max_length=8, choices=JobStatus.choices, default=JobStatus.QUEUED)
    tries = models.PositiveSmallIntegerField(default=0)
    max_tries = models.PositiveSmallIntegerField(default=default_job_max_tries)
    locked_until = models.DateTimeField(null=True, blank=True)
    error_code = models.CharField(max_length=60, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["recording", "kind"],
                condition=Q(status__in=["queued", "running"]),
                name="mediajob_one_active",
            ),
            models.CheckConstraint(condition=_in("kind", JobKind), name="mediajob_kind"),
            models.CheckConstraint(condition=_in("status", JobStatus), name="mediajob_status"),
            models.CheckConstraint(
                condition=Q(max_tries__gte=1, tries__lte=F("max_tries")), name="mediajob_tries"
            ),
            models.CheckConstraint(
                condition=~Q(status="running") | Q(locked_until__isnull=False),
                name="mediajob_running_has_lease",
            ),
        ]
        indexes = [
            models.Index(
                fields=["status", "created_at"],
                name="mediajob_active_idx",
                condition=Q(status__in=["queued", "running"]),
            ),
            models.Index(fields=["recording", "kind"], name="mediajob_recording_idx"),
        ]

    def __str__(self):
        return f"{self.kind} {self.status}"


class QuotaHit(models.Model):
    """One "your plan's limit is reached" (HTTP 402) answer. Evidence for the paid-plan decision
    (`manage.py plan_demand_report`, docs/features/13 D): written best-effort by the error handler, at most
    one row per user and limit per 10 minutes, and pruned after `QUOTA_HIT_RETENTION_DAYS`. No content, no
    request data: just who (a profile that is deleted with the account), which limit, which plan, when."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="quota_hits")
    limit = models.CharField(max_length=20, help_text="recordings, recording_ms or storage_bytes")
    plan_code = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["created_at"]),
            models.Index(fields=["profile", "limit", "-created_at"], name="quotahit_dedupe_idx"),
        ]

    def __str__(self):
        return f"{self.limit} {self.created_at:%Y-%m-%d}"


class LedgerKind(models.TextChoices):
    RECORDING = "recording", "Recording"
    VOICE = "voice", "Voice"
    THUMB = "thumb", "Thumbnail"
    CAPTION = "caption", "Caption"


class LedgerReason(models.TextChoices):
    RESERVE = "reserve", "Reserve"
    COMPLETE = "complete", "Complete"
    DELETE = "delete", "Delete"
    EXPIRE = "expire", "Expire"
    ORPHAN = "orphan", "Orphan sweep"
    REJECT = "reject", "Rejected upload"


class StorageLedger(models.Model):
    """Append-only quota ledger: usage = SUM(delta_bytes). Written only under the owner's Profile lock."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="storage_ledger")
    kind = models.CharField(max_length=9, choices=LedgerKind.choices)
    asset = models.ForeignKey(
        MediaAsset, null=True, on_delete=models.SET_NULL, related_name="ledger_rows"
    )
    delta_bytes = models.BigIntegerField(help_text="Positive reserves, negative releases")
    reason = models.CharField(max_length=8, choices=LedgerReason.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["profile", "created_at"]),
            models.Index(fields=["asset"], name="ledger_asset_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=~Q(delta_bytes=0), name="ledger_nonzero_delta"),
            models.CheckConstraint(condition=_in("kind", LedgerKind), name="ledger_kind"),
            models.CheckConstraint(condition=_in("reason", LedgerReason), name="ledger_reason"),
        ]

    def __str__(self):
        return f"{self.delta_bytes:+d} {self.reason}"


class ShareTarget(models.TextChoices):
    RECORDING = "recording", "Recording"
    SCORE_CARD = "score_card", "Score card"


class ShareLink(models.Model):
    """Unlisted access to one recording or score card. Only the sha256 of the 128-bit token is stored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    target_type = models.CharField(max_length=10, choices=ShareTarget.choices)
    target_id = models.UUIDField(help_text="Recording.id, or Attempt.public_id for a score card")
    token_hash = models.CharField(max_length=64)
    created_by = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="share_links")
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    hidden_at = models.DateTimeField(
        null=True, blank=True, help_text="Moderation hold (reports or staff); resolves as 410"
    )
    view_count = models.PositiveIntegerField(default=0)
    last_viewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["token_hash"], name="uniq_share_token_hash"),
            models.CheckConstraint(condition=_in("target_type", ShareTarget), name="share_target"),
        ]
        indexes = [models.Index(fields=["target_type", "target_id"])]

    def __str__(self):
        return f"{self.target_type} {self.target_id}"


class ConsentType(models.TextChoices):
    RECORDING_UPLOAD = "recording_upload", "Recording upload"
    VOICE_STORAGE = "voice_storage", "Voice storage"
    VOICE_PROCESSING = "voice_processing", "Voice processing"
    MODEL_IMPROVEMENT = "model_improvement", "Model improvement"
    TERMS = "terms", "Terms"
    MARKETING = "marketing", "Marketing"


class UserConsent(models.Model):
    """Consent log. Rows are never edited except to stamp `revoked_at`, so the history is auditable."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="consents")
    type = models.CharField(max_length=20, choices=ConsentType.choices)
    version = models.CharField(max_length=20)
    granted_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    ip_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-granted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "type"],
                condition=Q(revoked_at__isnull=True),
                name="uniq_active_consent",
            ),
            models.CheckConstraint(condition=_in("type", ConsentType), name="consent_type"),
        ]

    def __str__(self):
        return f"{self.type}@{self.version}"


class ReportReason(models.TextChoices):
    ABUSE = "abuse", "Abusive or harmful"
    SEXUAL = "sexual", "Sexual content"
    MINOR = "minor", "Involves a child"
    PRIVACY = "privacy", "Privacy"
    SPAM = "spam", "Spam"
    OTHER = "other", "Other"


class ReportStatus(models.TextChoices):
    OPEN = "open", "Open"
    ACTIONED = "actioned", "Actioned"
    DISMISSED = "dismissed", "Dismissed"


class ModerationReport(models.Model):
    """A viewer's report of a shared link. One per (link, reporter) so nobody can stuff the ballot."""

    reporter = models.ForeignKey(
        Profile, null=True, blank=True, on_delete=models.SET_NULL, related_name="reports_filed"
    )
    reporter_ip_hash = models.CharField(max_length=64, blank=True)
    share_link = models.ForeignKey(ShareLink, on_delete=models.CASCADE, related_name="reports")
    reason = models.CharField(max_length=8, choices=ReportReason.choices)
    details = models.TextField(blank=True, max_length=1000)
    status = models.CharField(
        max_length=9, choices=ReportStatus.choices, default=ReportStatus.OPEN, db_index=True
    )
    resolved_by = models.CharField(max_length=150, blank=True, help_text="Staff username")
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["share_link", "reporter"],
                condition=Q(reporter__isnull=False),
                name="uniq_report_user",
            ),
            models.UniqueConstraint(
                fields=["share_link", "reporter_ip_hash"],
                condition=Q(reporter__isnull=True),
                name="uniq_report_ip",
            ),
            models.CheckConstraint(condition=_in("reason", ReportReason), name="report_reason"),
            models.CheckConstraint(condition=_in("status", ReportStatus), name="report_status"),
        ]

    def __str__(self):
        return f"{self.reason} on {self.share_link_id}"


# --- Progress, achievements & boards (ERD 06d, spec 14) ---------------------------------------------


class AchievementTier(models.TextChoices):
    BRONZE = "bronze", "Bronze"
    SILVER = "silver", "Silver"
    GOLD = "gold", "Gold"


class AchievementCategory(models.TextChoices):
    START = "start", "Getting started"
    STREAK = "streak", "Streaks"
    MASTERY = "mastery", "Mastery"
    SKILL = "skill", "Skill"
    EXPLORE = "explore", "Explore"


class Achievement(models.Model):
    """One badge. Rules are data (`criteria`), evaluated by `progress.achievements`; the catalogue in
    `progress.catalogue` is the source of truth and `sync_achievements` upserts it."""

    code = models.SlugField(primary_key=True, max_length=40)
    name = models.CharField(max_length=60)
    description = models.CharField(max_length=200)
    icon = models.CharField(max_length=40, help_text="lucide icon name")
    tier = models.CharField(max_length=6, choices=AchievementTier.choices)
    category = models.CharField(max_length=8, choices=AchievementCategory.choices)
    criteria = models.JSONField(default=dict)
    xp_reward = models.PositiveSmallIntegerField(default=0)
    verified_only = models.BooleanField(
        default=False,
        help_text="Only attempts whose result can be trusted (mastery trust rules) count",
    )
    hidden = models.BooleanField(default=False, help_text="Shown as a secret until unlocked")
    active = models.BooleanField(default=True)
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "code"]
        constraints = [
            models.CheckConstraint(condition=_in("tier", AchievementTier), name="achievement_tier"),
            models.CheckConstraint(
                condition=_in("category", AchievementCategory), name="achievement_category"
            ),
        ]

    def __str__(self):
        return self.code


class UserAchievement(models.Model):
    """An unlock. Never deleted by the engine; `revoked` is an admin-only decision (PRD 05 edge 2)."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="achievements")
    achievement = models.ForeignKey(
        Achievement,
        to_field="code",
        db_column="achievement_code",
        on_delete=models.PROTECT,
        related_name="unlocks",
    )
    unlocked_at = models.DateTimeField(default=timezone.now)
    progress = models.FloatField(
        null=True, blank=True, help_text="0..1 at unlock; NULL for event rules"
    )
    revoked = models.BooleanField(default=False)
    seen = models.BooleanField(default=False, help_text="The user has been shown the toast")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "achievement"], name="uniq_user_achievement"
            ),
            models.CheckConstraint(
                condition=Q(progress__isnull=True) | Q(progress__gte=0, progress__lte=1),
                name="user_achievement_progress_range",
            ),
        ]
        indexes = [models.Index(fields=["profile", "seen"], name="user_achievement_seen_idx")]

    def __str__(self):
        return f"{self.profile_id}:{self.achievement_id}"


class DailyTwisterSource(models.TextChoices):
    EDITORIAL = "editorial", "Editorial"
    AUTO = "auto", "Automatic"


class DailyTwister(models.Model):
    """The featured twister of one UTC day. A row in admin *is* the editorial override; otherwise the
    first request of the day persists the deterministic pick so it never changes afterwards."""

    day = models.DateField(primary_key=True)
    twister = models.ForeignKey(Twister, on_delete=models.PROTECT, related_name="daily_features")
    source = models.CharField(
        max_length=9, choices=DailyTwisterSource.choices, default=DailyTwisterSource.EDITORIAL
    )
    locked_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-day"]
        constraints = [
            models.CheckConstraint(
                condition=_in("source", DailyTwisterSource), name="daily_twister_source"
            )
        ]

    def __str__(self):
        return f"{self.day} {self.twister_id}"


class LeaderboardEntry(models.Model):
    """A profile's best eligible score on one twister in one UTC week, ranked. Rebuilt hourly by
    `build_leaderboard`; reads never aggregate live."""

    week_start = models.DateField(help_text="Monday, UTC")
    twister = models.ForeignKey(Twister, on_delete=models.CASCADE, related_name="board_entries")
    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="board_entries")
    best_score = models.PositiveSmallIntegerField()
    best_attempt = models.ForeignKey(
        Attempt, null=True, blank=True, on_delete=models.SET_NULL, related_name="board_entries"
    )
    achieved_at = models.DateTimeField()
    rank = models.PositiveIntegerField()
    built_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "leaderboard entries"
        ordering = ["week_start", "twister", "rank"]
        constraints = [
            models.UniqueConstraint(
                fields=["week_start", "twister", "profile"], name="uniq_leaderboard_entry"
            ),
            models.CheckConstraint(
                condition=Q(best_score__gte=0, best_score__lte=100), name="leaderboard_score_range"
            ),
            models.CheckConstraint(condition=Q(rank__gte=1), name="leaderboard_rank_positive"),
        ]
        indexes = [
            models.Index(fields=["week_start", "twister", "rank"], name="leaderboard_rank_idx")
        ]

    def __str__(self):
        return f"{self.week_start} {self.twister_id} #{self.rank}"


class GenerationUsage(models.Model):
    """Generations a person has used on one UTC day (D26): the quota ledger. Counted when the provider
    is asked, so deleting a generated twister never hands the quota back."""

    profile = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="generation_usage")
    day = models.DateField()
    count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["profile", "day"], name="generation_usage_profile_day"),
        ]

    def __str__(self):
        return f"{self.profile_id} {self.day}: {self.count}"
