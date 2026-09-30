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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["difficulty", "id"]

    def __str__(self):
        return self.text[:60]

    def save(self, *args, **kwargs):
        self.word_count = len(self.text.split())
        super().save(*args, **kwargs)


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
    last_activity_date = models.DateField(
        null=True, blank=True, help_text="Local date of the last streak-qualifying activity"
    )
    timezone = models.CharField(
        max_length=64,
        default="UTC",
        validators=[validate_timezone],
        help_text="IANA name; decides what 'today' means",
    )
    plan = models.ForeignKey(
        Plan,
        to_field="code",
        db_column="plan_code",
        default=Plan.DEFAULT_CODE,
        on_delete=models.PROTECT,
        related_name="profiles",
    )
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
    spot_check_delta = models.FloatField(null=True, blank=True)
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
    voice_asset_id = models.UUIDField(
        null=True, blank=True, help_text="MediaAsset (ERD 06c); a plain id until that table ships"
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

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"
        EXPIRED = "expired", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    attempt = models.ForeignKey(Attempt, on_delete=models.CASCADE, related_name="scoring_jobs")
    audio_asset_id = models.UUIDField(
        null=True, blank=True, help_text="MediaAsset (ERD 06c); a plain id until that table ships"
    )
    kind = models.CharField(max_length=20, choices=Kind.choices)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.QUEUED)
    tries = models.PositiveSmallIntegerField(default=0)
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

    def __str__(self):
        return f"{self.kind} {self.status}"


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
