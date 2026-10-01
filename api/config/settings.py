"""Django settings for Twister API. All config via environment variables."""

import json
import os
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env(name: str, default: str = "") -> str:
    """os.getenv that tolerates surrounding whitespace/quotes (Vercel keeps quotes literally)."""
    return os.getenv(name, default).strip().strip("\"'").strip()


def env_list(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in env(name, default).split(",") if v.strip()]


def env_origins(name: str, default: str = "") -> list[str]:
    """Origins must be scheme://host[:port] with no path or trailing slash; normalise common typos."""
    out = []
    for v in env_list(name, default):
        v = v.strip("\"'").rstrip("/")
        if "://" in v:
            scheme, rest = v.split("://", 1)
            v = f"{scheme}://{rest.split('/', 1)[0]}"
        out.append(v)
    return out


DEBUG = env("DJANGO_DEBUG", "0") == "1"
SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-insecure-change-me" if DEBUG else "")
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG=0")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,.vercel.app")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "twisters",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "twisters.middleware.RequestIdMiddleware",
    "twisters.middleware.ApiResponseHeadersMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [
            BASE_DIR / "twisters" / "media" / "templates",
            BASE_DIR / "twisters" / "reminders" / "templates",
        ],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# Supabase Postgres in prod (use the *pooler* URL on serverless), sqlite locally.
DATABASES = {
    "default": dj_database_url.parse(
        env("DATABASE_URL") or f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=0 if env("VERCEL") else 60,
        ssl_require=env("DATABASE_SSL_REQUIRE", "0") == "1",
    )
}
if DATABASES["default"]["ENGINE"].endswith("postgresql"):
    # Required for Supabase transaction pooler (pgbouncer)
    DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True

AUTH_PASSWORD_VALIDATORS = []  # Auth handled by Supabase; Django admin only for staff.
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env_origins("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
CORS_ALLOW_CREDENTIALS = False
CSRF_TRUSTED_ORIGINS = env_origins("CSRF_TRUSTED_ORIGINS", "")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["twisters.auth.SupabaseJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticatedOrReadOnly"],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 24,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "120/min",
        "user": "300/min",
        # Scoped throttles (API contract 07 §1, decision D9); "N/Mmin" windows are parsed by twisters.throttles.
        "attempts": "30/10min",
        "attempts_sync": "10/1min",
        "word_feedback": "60/60min",
        # Media (API contract 07 §1): recordings create 10/h, share resolve 60/min/IP.
        "recordings": "10/h",
        "voice_uploads": "30/h",
        "share_resolve": "60/min",
        "share_create": "30/h",
        "share_report": "10/h",
        "export": "3/h",  # GET /me/export/ per user (round 1, spec 15)
        "unsubscribe": "600/min",  # GET|POST /public/unsubscribe/{token}/ per IP (round 2, D27)
        "generate": "3/min",  # POST /generate/ per user (round 2, spec 16 D26)
        "csp_report": "60/min",  # POST /csp-report/ per IP (round 4, spec 07 section 19)
    },
    "EXCEPTION_HANDLER": "twisters.errors.exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}
SPECTACULAR_SETTINGS = {"TITLE": "Twister API", "VERSION": "0.1.0", "SERVE_INCLUDE_SCHEMA": False}

# Practice rules (decisions D4/D5 in docs/features/11-decisions-log.md). Tunable without a migration.
READ_ALONG_MIN_ACTIVE_MS = int(
    env("READ_ALONG_MIN_ACTIVE_MS", "30000")
)  # streak needs >= 30 s active...
READ_ALONG_XP_RATIO = float(
    env("READ_ALONG_XP_RATIO", "0.25")
)  # ...and pays 25 % of a scored attempt,
READ_ALONG_XP_DAILY_CAP = int(
    env("READ_ALONG_XP_DAILY_CAP", "50")
)  # capped per local day (anti-farming)
SESSION_CLOCK_SKEW_MS = int(
    env("SESSION_CLOCK_SKEW_MS", "5000")
)  # tolerance when bounding client-reported active time

# Speak & Score (decisions D5 mastery, D8 trust, D9 abuse controls; docs/features/03, 06b, 11).
MASTERY_MIN_SCORE = int(env("MASTERY_MIN_SCORE", "90"))
MASTERY_DAYS = int(env("MASTERY_DAYS", "2"))  # distinct local days at/above the score...
MASTERY_WINDOW_DAYS = int(env("MASTERY_WINDOW_DAYS", "30"))  # ...within this many days
# Until the worker can verify attempts (P2b) provisional test attempts may count so mastery is reachable (D5 note).
MASTERY_ALLOW_PROVISIONAL = env("MASTERY_ALLOW_PROVISIONAL", "1") == "1"
MASTERY_PROVISIONAL_MIN_CONFIDENCE = float(env("MASTERY_PROVISIONAL_MIN_CONFIDENCE", "0.6"))
LEADERBOARD_REQUIRE_VERIFIED = (
    env("LEADERBOARD_REQUIRE_VERIFIED", "0") == "1"
)  # flip on with the worker
MIN_ENGINE_CONFIDENCE = float(
    env("MIN_ENGINE_CONFIDENCE", "0.45")
)  # below: "couldn't hear you", no save
MAX_PLAUSIBLE_WPM = int(
    env("MAX_PLAUSIBLE_WPM", "320")
)  # faster than this is flagged, never ranked
SPAM_TRANSCRIPT_LIMIT = int(
    env("SPAM_TRANSCRIPT_LIMIT", "5")
)  # identical transcripts per twister...
SPAM_WINDOW_MIN = int(env("SPAM_WINDOW_MIN", "10"))  # ...within this many minutes
OFFLINE_XP_MAX_AGE_DAYS = int(
    env("OFFLINE_XP_MAX_AGE_DAYS", "7")
)  # older queued attempts earn no XP
ATTEMPT_MAX_BACKDATE_DAYS = int(env("ATTEMPT_MAX_BACKDATE_DAYS", "365"))
SPOT_CHECK_RATE = float(env("SPOT_CHECK_RATE", "0.10"))  # share of device test attempts re-scored
SPOT_CHECK_MIN_SCORE = int(
    env("SPOT_CHECK_MIN_SCORE", "90")
)  # every would-be personal best above this
SPOT_CHECK_MAX_DELTA = float(
    env("SPOT_CHECK_MAX_DELTA", "15")
)  # score points before a disagreement
DEVICE_DISTRUST_AFTER = int(
    env("DEVICE_DISTRUST_AFTER", "3")
)  # disagreements before device results stop counting
PENDING_RETRY_AFTER_MIN = int(env("PENDING_RETRY_AFTER_MIN", "10"))
WORKER_SHARED_SECRET = env(
    "WORKER_SHARED_SECRET", ""
)  # HMAC key for /internal/scoring-jobs/ callbacks
WORD_WEAKNESS_RECENT_ALPHA = (
    0.3  # EMA weight of the latest attempt in UserWordStat.recent_error_rate
)
WEAK_WORD_LADDER_DAYS = (
    1,
    3,
    7,
    14,
)  # spaced review: next_review_at after 1, 2, 3, 4+ correct in a row
XP_KIND_MULTIPLIER = {"test": 1.0, "train": 0.5, "drill": 0.25, "record": 1.0}

# Progress, achievements & discovery (docs/features/14-06d-build-spec.md). Rules, not secrets: safe
# defaults, tunable per environment without a migration -- except STREAK_FREEZE_MAX, which is also a
# DB CHECK on Profile.streak_freezes, so changing it needs a migration.
STREAK_FREEZE_MAX = 2
# A freeze is banked each time the streak reaches a multiple of this (D16).
STREAK_FREEZE_EVERY = int(env("STREAK_FREEZE_EVERY", "7"))
STREAK_MILESTONES = (3, 7, 14, 30, 60, 100)
# Local hour from which an idle, live streak counts as "at risk".
STREAK_AT_RISK_HOUR = int(env("STREAK_AT_RISK_HOUR", "18"))
# A best score at or above this makes a twister "almost" mastered.
MASTERY_ALMOST_SCORE = int(env("MASTERY_ALMOST_SCORE", "80"))
LEADERBOARD_TOP_N = int(env("LEADERBOARD_TOP_N", "10"))
# Random's bucket weights (PRD 05 S7): favour what the user has not mastered.
RANDOM_WEIGHTS = {"new": 60, "practising": 30, "mastered": 10}
RANDOM_EXCLUDE_MAX = 20  # slugs a client may ask Random to skip
STATS_MAX_POINTS = int(env("STATS_MAX_POINTS", "400"))  # longer ranges are bucketed by ISO week

# --- Round 1 (spec 15, api-core): score cards, account deletion/export, night owl -------------------
# Absolute origin of this API; score-card image URLs in `GET /public/s/{token}/` are built from it. In
# production it is only needed once score cards are used: when unset the `images` block is omitted.
API_PUBLIC_URL = env("API_PUBLIC_URL", "" if not DEBUG else "http://localhost:8000").rstrip("/")
# Account deletion (D21): a pending account can still cancel for this long, then it is purged.
ACCOUNT_DELETION_GRACE_DAYS = int(env("ACCOUNT_DELETION_GRACE_DAYS", "30"))
# Hard cap on attempts in `GET /me/export/` (newest first); `truncated: true` when it bites.
EXPORT_MAX_ATTEMPTS = int(env("EXPORT_MAX_ATTEMPTS", "20000"))
# Vercel Functions cap a response body at 4.5 MB, so the export also stops adding attempts once the
# serialised JSON would pass this many bytes (round 4); `truncated: true` then. Keep it below 4.5 MB.
EXPORT_MAX_BYTES = int(env("EXPORT_MAX_BYTES", "4000000"))
EXPORT_CHUNK_SIZE = 500  # rows per database round trip while streaming an export section
# Public score-card images are cacheable by browsers and crawlers for this long (the ETag covers the rest).
SCORE_CARD_IMAGE_MAX_AGE_S = int(env("SCORE_CARD_IMAGE_MAX_AGE_S", "3600"))
# Night owl mode (D23): for opted-in profiles the streak day starts at this local hour.
NIGHT_OWL_CUTOFF_HOUR = int(env("NIGHT_OWL_CUTOFF_HOUR", "3"))
DAILY_LOOKBACK_DAYS = 60  # how far back GET /daily/?day= may look
ACHIEVEMENT_SEEN_MAX_CODES = 100  # codes one "mark seen" request may name

# Record, media, sharing & consent (docs/features/13-06c-build-spec.md). Numbers that belong to a plan live
# in Plan.limits (decision D1); PLAN_LIMIT_DEFAULTS only fills keys a plan row does not define.
PLAN_LIMIT_DEFAULTS = {
    "recordings_max": 5,
    "recording_ms_max": 180_000,
    "storage_bytes_max": 104_857_600,
    "retention_days": 30,
    "share_max_days": 7,
    "voice_clip_ms_max": 60_000,
    "voice_clip_bytes_max": 2_097_152,
}
# Object storage adapter: "memory" (dev/tests, never touches the network) or "supabase".
MEDIA_STORAGE_BACKEND = env("MEDIA_STORAGE_BACKEND", "memory" if DEBUG else "supabase")
SUPABASE_SERVICE_ROLE_KEY = env(
    "SUPABASE_SERVICE_ROLE_KEY", ""
)  # server-side only, never returned/logged
MEDIA_MAX_BYTES = int(
    env("MEDIA_MAX_BYTES", str(100 * 1024 * 1024))
)  # per object, server-side ceiling
# Off until the FFmpeg worker ships: `complete` then marks a recording ready directly (PRD 04 §10).
MEDIA_PROCESSING_ENABLED = env("MEDIA_PROCESSING_ENABLED", "0") == "1"
MEDIA_ORPHAN_HOURS = int(env("MEDIA_ORPHAN_HOURS", "24"))  # abandoned uploads are swept after this
UPLOAD_URL_TTL_S = int(env("UPLOAD_URL_TTL_S", "3600"))
PLAYBACK_URL_TTL_S = int(env("PLAYBACK_URL_TTL_S", "900"))
UPLOAD_CHUNK_BYTES = 6 * 1024 * 1024  # Supabase TUS requires exactly 6 MiB chunks
THUMBNAIL_MAX_BYTES = 200 * 1024
RESTORE_WINDOW_HOURS = int(env("RESTORE_WINDOW_HOURS", "24"))  # soft-delete undo, then hard delete
CONSENT_REVOCATION_GRACE_HOURS = int(env("CONSENT_REVOCATION_GRACE_HOURS", "24"))
EXPIRY_REMINDER_DAYS = int(env("EXPIRY_REMINDER_DAYS", "3"))
VOICE_RETENTION_DAYS = int(env("VOICE_RETENTION_DAYS", "30"))
SHARE_BASE_URL = env("SHARE_BASE_URL", "https://twister.meetpawan.com").rstrip("/")
SCORE_CARD_SHARE_DAYS = int(env("SCORE_CARD_SHARE_DAYS", "30"))
SHARE_MAX_ACTIVE_PER_TARGET = int(env("SHARE_MAX_ACTIVE_PER_TARGET", "10"))
REPORT_AUTOHIDE_THRESHOLD = int(env("REPORT_AUTOHIDE_THRESHOLD", "3"))  # distinct reporters
# Media worker queue (spec 13 A2). The worker claims a job, holds a lease and extends it by heartbeat;
# the sweeper re-queues jobs whose lease lapsed and fails those that used up their tries.
MEDIA_JOB_LEASE_S = int(env("MEDIA_JOB_LEASE_S", "120"))
MEDIA_JOB_MAX_TRIES = int(env("MEDIA_JOB_MAX_TRIES", "3"))
MEDIA_JOB_MAX_RUN_S = int(env("MEDIA_JOB_MAX_RUN_S", "900"))  # told to the worker as limits.max_s
MEDIA_WORKER_MAX_HEIGHT = int(env("MEDIA_WORKER_MAX_HEIGHT", "1080"))
MEDIA_WORKER_URL_TTL_S = int(env("MEDIA_WORKER_URL_TTL_S", "1800"))  # signed GET / upload URLs
ANALYSIS_AUDIO_RETENTION_DAYS = int(env("ANALYSIS_AUDIO_RETENTION_DAYS", "7"))
# Opaque storage folders: HMAC key for `hmac(profile_id)[:16]` (spec 13 A2.5). Changing it only affects
# new uploads (each asset stores its own path). Required in production like the other secrets.
MEDIA_PATH_SECRET = env("MEDIA_PATH_SECRET") or ("dev-insecure-media-path-secret" if DEBUG else "")
if not MEDIA_PATH_SECRET:
    raise RuntimeError("MEDIA_PATH_SECRET must be set when DJANGO_DEBUG=0")

# Transactional e-mail (expiry reminders). Console backend in dev; SMTP elsewhere.
EMAIL_BACKEND = env(
    "EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.smtp.EmailBackend",
)
EMAIL_HOST = env("EMAIL_HOST") or "localhost"
EMAIL_PORT = int(env("EMAIL_PORT") or "587")  # blank CI secrets fall back too
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env("EMAIL_USE_TLS", "1") == "1"
EMAIL_TIMEOUT = int(env("EMAIL_TIMEOUT", "10"))
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL") or "Twister <no-reply@twister.meetpawan.com>"
WEB_BASE_URL = (env("WEB_BASE_URL", "") or SHARE_BASE_URL).rstrip("/")  # links inside e-mails
# Current version of each consent text; bump one to make everyone re-consent (docs/features/06c).
CONSENT_VERSIONS = {
    "recording_upload": "v1",
    "voice_storage": "v1",
    "voice_processing": "v1",
    "model_improvement": "v1",
    "terms": "v1",
    "marketing": "v1",
    **(json.loads(env("CONSENT_VERSIONS", "{}")) or {}),
}
# Salt for the stored IP hashes (consent log, anonymous reports); defaults to a key derived from SECRET_KEY.
IP_HASH_SALT = env("IP_HASH_SALT", "") or SECRET_KEY

# Supabase auth (JWT verification). Provide SUPABASE_URL (JWKS, asymmetric keys)
# and/or SUPABASE_JWT_SECRET (legacy HS256 secret).
SUPABASE_URL = env("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET", "")
SUPABASE_JWT_AUDIENCE = env("SUPABASE_JWT_AUDIENCE", "authenticated")

# --- Security headers & cookies (spec 15 §2.3; round 1, api-ops) -----------------------------------------
# Production-safe defaults; every value has an env override. The API is bearer-token JSON, so the cookie
# flags only matter for the Django admin.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = env("SECURE_REFERRER_POLICY", "same-origin")
X_FRAME_OPTIONS = "DENY"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
# Header sent on JSON responses by ApiResponseHeadersMiddleware; report-only. Blank disables it. Read with
# os.getenv, not env(): env() strips quote characters, which would eat the closing ' of 'none'.
API_CSP_REPORT_ONLY = os.getenv(
    "API_CSP_REPORT_ONLY", "default-src 'none'; frame-ancestors 'none'"
).strip()

# Largest CSP violation report body `POST /csp-report/` will read (round 4); bigger ones are dropped.
CSP_REPORT_MAX_BYTES = 16 * 1024

if not DEBUG:
    # Vercel terminates TLS and sets X-Forwarded-Proto. Not set in dev, where the header is spoofable.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env("DJANGO_SSL_REDIRECT", "0") == "1"
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # HSTS is only emitted on HTTPS responses. 1 year, subdomains on, preload off (preloading is a
    # one-way door: opt in with SECURE_HSTS_PRELOAD=1 only after reading the hstspreload.org rules).
    SECURE_HSTS_SECONDS = int(env("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env("SECURE_HSTS_INCLUDE_SUBDOMAINS", "1") == "1"
    SECURE_HSTS_PRELOAD = env("SECURE_HSTS_PRELOAD", "0") == "1"

# --- Signed worker callbacks (spec 15 §2.1) ---------------------------------------------------------------
WORKER_SIGNATURE_MAX_SKEW_S = int(env("WORKER_SIGNATURE_MAX_SKEW_S", "300"))
# Accept the old body-only signature (no X-Worker-Timestamp). On by default so API and worker can be
# deployed in either order; set to 0 once the worker sends timestamps (docs/runbooks/deploy-and-rollback.md).
WORKER_ALLOW_LEGACY_SIGNATURE = env("WORKER_ALLOW_LEGACY_SIGNATURE", "1") == "1"

# --- Sentry (spec 15 §2.2): starts only when SENTRY_DSN is set -------------------------------------------
SENTRY_DSN = env("SENTRY_DSN", "")
SENTRY_ENVIRONMENT = env("SENTRY_ENVIRONMENT", "development" if DEBUG else "production")
SENTRY_RELEASE = env("SENTRY_RELEASE") or env("VERCEL_GIT_COMMIT_SHA")
SENTRY_TRACES_SAMPLE_RATE = float(env("SENTRY_TRACES_SAMPLE_RATE", "0.0"))
if SENTRY_DSN:
    from twisters.observability import init_sentry

    init_sentry(
        SENTRY_DSN,
        environment=SENTRY_ENVIRONMENT,
        release=SENTRY_RELEASE,
        traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
    )

# --- Round 2 (spec 16): Generate Twister ------------------------------------------------------------------
# Google Gemini over REST (D24). The key is a secret: server only, never logged or returned.
GEMINI_API_KEY = env("GEMINI_API_KEY", "")
GEMINI_MODEL = env("GEMINI_MODEL") or "gemini-2.5-flash"
GEMINI_TIMEOUT_S = float(env("GEMINI_TIMEOUT_S", "10"))
# `gemini` | `fake`. Blank = `gemini` when GEMINI_API_KEY is set, otherwise `fake` (canned twisters, no network).
GENERATOR_BACKEND = env("GENERATOR_BACKEND", "").lower()
# Generations per person per UTC day (D26); a rejected result still counts, a provider outage does not.
GENERATE_DAILY_LIMIT = int(env("GENERATE_DAILY_LIMIT", "5"))
# Private generated twisters one person may keep at a time (round 4); delete one to make another.
GENERATE_MAX_STORED = int(env("GENERATE_MAX_STORED", "50"))
# Daily usage rows older than this are deleted by `manage.py prune_generation_usage` (round 4).
GENERATE_USAGE_RETENTION_DAYS = int(env("GENERATE_USAGE_RETENTION_DAYS", "90"))
