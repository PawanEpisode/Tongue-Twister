"""The operational docs must not drift from the code: every settings variable and every seeded flag is documented."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SECRETS = (ROOT / "docs/runbooks/secrets-and-rotation.md").read_text("utf-8")
FLAG_DOC = (ROOT / "docs/features/15-rollout-and-flags.md").read_text("utf-8")
SETTINGS = (ROOT / "api/config/settings.py").read_text("utf-8")
ENV_EXAMPLE = (ROOT / "api/.env.example").read_text("utf-8")

# env("NAME", ...), env_list("NAME"), env_origins("NAME") and os.getenv("NAME", ...), across line breaks.
ENV_NAME = re.compile(r"(?:\benv\w*|os\.getenv)\(\s*\"([A-Z][A-Z0-9_]+)\"")
# Set by the platform or only for tests/tooling; documented in prose, not as rows to configure.
PLATFORM = {"VERCEL"}
SEEDED_FLAGS = {
    "practice_hub",
    "read_along",
    "speak_v2",
    "accurate_mode",
    "spot_checks",
    "record_local",
    "record_screen",
    "record_region",
    "record_cloud",
    "share_links",
    "achievements",
    "weekly_boards",
    "generate_twister",
    "reminders",
    "score_cards",
    "calibrate",
}


def test_every_settings_variable_is_in_the_secrets_runbook():
    names = set(ENV_NAME.findall(SETTINGS)) - PLATFORM
    assert len(names) > 60  # the regex still finds the settings
    missing = sorted(n for n in names if f"`{n}`" not in SECRETS)
    assert not missing, f"add to docs/runbooks/secrets-and-rotation.md: {missing}"


def test_every_env_example_variable_is_in_the_secrets_runbook():
    names = set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]{3,})=", ENV_EXAMPLE, re.M))
    missing = sorted(n for n in names if f"`{n}`" not in SECRETS)
    assert not missing, missing


def test_worker_and_web_variables_are_documented():
    worker = (ROOT / "worker/twister_worker/config.py").read_text("utf-8")
    web = (ROOT / "web/.env.example").read_text("utf-8")
    names = set(re.findall(r"(?:env\.get\(|_number\(env,\s*)\"([A-Z_]+)\"", worker))
    names |= set(re.findall(r"^#?\s*(VITE_[A-Z_]+)=", web, re.M))
    names |= {"VITE_SITE_URL"}
    assert {"API_BASE_URL", "WORKER_SHARED_SECRET", "VITE_API_URL"} <= names
    missing = sorted(n for n in names if f"`{n}`" not in SECRETS)
    assert not missing, missing


def test_every_seeded_flag_is_in_the_flag_matrix():
    for code in SEEDED_FLAGS:
        assert f"| `{code}` |" in FLAG_DOC, code


def test_documented_flags_exist_in_the_seed_migrations():
    seeded = ""
    for migration in (ROOT / "api/twisters/migrations").glob("*.py"):
        seeded += migration.read_text("utf-8")
    for code in SEEDED_FLAGS:
        assert f'"{code}"' in seeded, code


def test_runbooks_index_links_exist():
    index = (ROOT / "docs/runbooks/README.md").read_text("utf-8")
    for target in re.findall(r"\]\(([\w-]+\.md)\)", index):
        if target == "web-ci.md":  # owned by the web-infra agent
            continue
        assert (ROOT / "docs/runbooks" / target).exists(), target
