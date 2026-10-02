"""Postgres refuses `SELECT ... FOR UPDATE` over the nullable side of an outer join; SQLite (the default test
database) does not notice. A lock taken together with `select_related` must therefore say `of=("self",)`."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "twisters"
LOCK_THEN_JOIN = re.compile(r"select_for_update\(\)\s*\.\s*select_related", re.S)


def test_locks_that_join_lock_only_their_own_row():
    offenders = [
        str(path.relative_to(ROOT))
        for path in ROOT.rglob("*.py")
        if "migrations" not in path.parts and LOCK_THEN_JOIN.search(path.read_text())
    ]
    assert offenders == [], (
        f"use select_for_update(of=('self',)) before select_related in: {offenders}"
    )
