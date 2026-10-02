"""Re-scores the committed gold clips with the current engine and compares every verdict to the frozen results.

This is the regression net the stored posteriors exist for (docs/features/10 §7): a change to the engine, the
profile defaults or the label handling that moves any verdict, or any score, fails here and has to be accepted on
purpose. The committed clips are *synthetic* (they test the machinery); when real gold clips are collected, point
GOLD_DIR at them and freeze their results the same way.

    UPDATE_GOLD=1 python -m pytest tools/calibrate/tests/test_gold_regression.py   # accept new results
"""

import json
import os
from pathlib import Path

import pytest

import report
from evaluate import score_clip
from gold import load

HERE = Path(__file__).resolve().parent.parent
GOLD = Path(os.environ.get("GOLD_DIR", HERE / "fixtures" / "synthetic"))
EXPECTED = HERE / "fixtures" / "expected_synthetic.json"


def snapshot() -> dict:
    results = [score_clip(c) for c in load(GOLD)]
    clips = {
        r.clip.id: {
            "unscorable": r.unscorable,
            "score": r.score,
            "words": [[w.index, w.status, w.reason, w.uncertain] for w in r.words],
        }
        for r in results
    }
    summary = report.build(results)
    return {
        "clips": clips,
        "summary": {
            "swap_recall": summary["swap"]["recall"],
            "false_accusation_words": summary["clean"]["false_accusation_words"],
            "accent_gap": summary["accent"]["gap"],
        },
    }


def test_every_verdict_and_score_matches_the_frozen_results():
    now = snapshot()
    if os.environ.get("UPDATE_GOLD"):
        EXPECTED.write_text(json.dumps(now, indent=1, sort_keys=True) + "\n")
        pytest.skip("frozen results rewritten")
    frozen = json.loads(EXPECTED.read_text())
    assert now["clips"].keys() == frozen["clips"].keys(), "the clip set changed"
    changed = sorted(cid for cid, v in now["clips"].items() if v != frozen["clips"][cid])
    assert not changed, f"verdicts moved for {len(changed)} clips, e.g. {changed[:3]}"
    assert now["summary"] == frozen["summary"]


def test_the_frozen_results_are_not_vacuous():
    frozen = json.loads(EXPECTED.read_text())
    statuses = {w[1] for v in frozen["clips"].values() for w in v["words"]}
    assert {"correct", "wrong"} <= statuses  # clean words and caught swaps are both present
    assert any(v["score"] is not None for v in frozen["clips"].values())
