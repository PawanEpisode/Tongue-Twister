"""Test settings: never touch the real (Supabase) database, whatever .env says.

Tests use in-memory sqlite. CI also runs them on Postgres by setting TEST_DATABASE_URL (an explicit
opt-in, deliberately not DATABASE_URL, so a stray production URL can never be used by the suite).
"""

import os

import dj_database_url

# Tests run with dev semantics whatever the environment (CI has no .env and no DJANGO_* variables):
# `DJANGO_DEBUG=1` supplies the throwaway secret keys and the console e-mail backend, so the suite
# never needs real secrets. The production guards are tested separately in `tests/test_media_config.py`.
os.environ.setdefault("DJANGO_DEBUG", "1")

from .settings import *  # noqa: F401,F403
from .settings import env

_test_db = env("TEST_DATABASE_URL")
DATABASES = {
    "default": dj_database_url.parse(_test_db)
    if _test_db
    else {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}
}

# Tests must never reach a real bucket, whatever the environment says.
MEDIA_STORAGE_BACKEND = "memory"
