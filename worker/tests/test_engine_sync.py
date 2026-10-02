"""The vendored engine must be byte-identical to the API's (docs/features/13 D37)."""

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

WORKER = Path(__file__).resolve().parents[1]
ENGINE = WORKER / "twister_worker" / "engine"
SCRIPT = WORKER / "scripts" / "sync_engine.py"


def test_vendored_files_match_their_manifest():
    manifest = json.loads((ENGINE / "VENDORED.json").read_text())["files"]
    assert manifest, "VENDORED.json lists no files"
    for name, digest in manifest.items():
        assert hashlib.sha256((ENGINE / name).read_bytes()).hexdigest() == digest, name


def test_the_vendored_engine_has_no_django_or_api_imports():
    pattern = re.compile(r"^\s*(from|import)\s+(django|twisters|rest_framework)\b", re.MULTILINE)
    for path in ENGINE.glob("*.py"):
        assert not pattern.search(path.read_text()), path.name


@pytest.mark.skipif(not (WORKER.parent / "api").exists(), reason="API source not in this checkout")
def test_the_copy_is_current_with_the_api_source():
    done = subprocess.run([sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True)
    assert done.returncode == 0, done.stdout + done.stderr
