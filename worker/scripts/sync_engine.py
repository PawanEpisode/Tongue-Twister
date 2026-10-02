#!/usr/bin/env python3
"""Vendor the pronunciation engine from the API into the worker (docs/features/13 D37).

The engine is pure Python with no Django, so the worker ships a byte-identical copy rather than a second
implementation. ``VENDORED.json`` records the sha-256 of every copied file; the worker test
``test_engine_sync`` and the API test ``test_engine_vendoring`` both fail when the copy drifts.

    python worker/scripts/sync_engine.py          # copy + write the manifest
    python worker/scripts/sync_engine.py --check  # exit 1 if the copy is stale (CI)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "api" / "twisters" / "speak" / "engine"
DST = ROOT / "worker" / "twister_worker" / "engine"
# `variants` (needs the lexicon) and `bench` (synthetic test audio) stay API-side: the API sends the worker
# every accepted pronunciation already expanded.
FILES = (
    "__init__",
    "types",
    "phones",
    "ctc",
    "decode",
    "gop",
    "verdict",
    "score",
    "quality",
    "assess",
)
MANIFEST = "VENDORED.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expected() -> dict[str, str]:
    return {f"{name}.py": digest(SRC / f"{name}.py") for name in FILES}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    want = expected()
    if args.check:
        have = json.loads((DST / MANIFEST).read_text()) if (DST / MANIFEST).exists() else {}
        files = have.get("files", {})
        stale = [n for n, h in want.items() if files.get(n) != h or not (DST / n).exists()]
        stale += [n for n, h in files.items() if (DST / n).exists() and digest(DST / n) != h]
        if stale:
            print("engine copy is stale: " + ", ".join(sorted(set(stale))))  # noqa: T201
            print("run: python worker/scripts/sync_engine.py")  # noqa: T201
            return 1
        return 0
    DST.mkdir(parents=True, exist_ok=True)
    for name in want:
        shutil.copyfile(SRC / name, DST / name)
    (DST / MANIFEST).write_text(json.dumps({"files": want}, indent=2, sort_keys=True) + "\n")
    print(f"vendored {len(want)} engine files")  # noqa: T201
    return 0


if __name__ == "__main__":
    sys.exit(main())
