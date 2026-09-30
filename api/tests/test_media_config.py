"""Deployment-facing guarantees: secrets are required in production, storage RLS denies clients."""

import os
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
POLICIES = (API_DIR / "twisters/media/storage_policies.sql").read_text()


def import_settings(**env) -> subprocess.CompletedProcess:
    base = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_", "MEDIA_"))}
    return subprocess.run(
        [sys.executable, "-c", "import config.settings"],
        cwd=API_DIR,
        env={**base, "DATABASE_URL": "", **env},
        capture_output=True,
        text=True,
    )


def test_production_refuses_to_start_without_the_path_secret():
    prod = {"DJANGO_DEBUG": "0", "DJANGO_SECRET_KEY": "x" * 20}
    missing = import_settings(**prod, MEDIA_PATH_SECRET="")
    assert missing.returncode != 0 and "MEDIA_PATH_SECRET" in missing.stderr
    assert import_settings(**prod, MEDIA_PATH_SECRET="s3cret").returncode == 0


def test_dev_has_a_safe_default_path_secret():
    assert import_settings(DJANGO_DEBUG="1", MEDIA_PATH_SECRET="").returncode == 0


def test_storage_policies_deny_clients_and_no_longer_key_on_the_user_id():
    sql = POLICIES.lower()
    statements = [line for line in sql.splitlines() if not line.strip().startswith("--")]
    code = "\n".join(statements)
    assert "auth.uid()" not in code and "foldername" not in code
    assert "as restrictive" in code and "to anon, authenticated" in code
    assert "drop policy if exists" in code
    for bucket in ("recordings", "voice", "thumbs", "captions"):
        assert f"'{bucket}'" in code
    assert code.count("create policy") == 1  # one deny policy, nothing permissive
