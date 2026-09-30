"""Django settings for Twister API. All config via environment variables."""

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
        "DIRS": [],
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

# Supabase auth (JWT verification). Provide SUPABASE_URL (JWKS, asymmetric keys)
# and/or SUPABASE_JWT_SECRET (legacy HS256 secret).
SUPABASE_URL = env("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWT_SECRET = env("SUPABASE_JWT_SECRET", "")
SUPABASE_JWT_AUDIENCE = env("SUPABASE_JWT_AUDIENCE", "authenticated")

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env("DJANGO_SSL_REDIRECT", "0") == "1"
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
