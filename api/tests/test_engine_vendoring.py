"""The worker ships a byte-identical copy of the engine (docs/features/13 D37); changing the engine without
re-running ``python worker/scripts/sync_engine.py`` fails here, before it can fail in production."""

import hashlib
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ENGINE = ROOT / "api" / "twisters" / "speak" / "engine"
MANIFEST = ROOT / "worker" / "twister_worker" / "engine" / "VENDORED.json"

pytestmark = pytest.mark.skipif(not MANIFEST.exists(), reason="worker source not in this checkout")


def test_the_worker_copy_is_current():
    files = json.loads(MANIFEST.read_text())["files"]
    stale = [
        name
        for name, digest in files.items()
        if hashlib.sha256((ENGINE / name).read_bytes()).hexdigest() != digest
    ]
    assert not stale, f"run `python worker/scripts/sync_engine.py` ({', '.join(stale)} changed)"


def test_every_vendored_file_exists_in_the_api_engine():
    for name in json.loads(MANIFEST.read_text())["files"]:
        assert (ENGINE / name).exists(), name
