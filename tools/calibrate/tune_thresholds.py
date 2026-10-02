"""Threshold tuning on a gold set (docs/features/13 §3.8, doc 10 §4.6: precision first).

    python tools/calibrate/tune_thresholds.py GOLD_DIR [--out profile.json] [--max-false-accusation 0.04]

Coordinate descent over the four verdict thresholds, each round re-scoring every stored clip: among settings whose
false-accusation rate is within the cap, take the one that catches the most scripted swaps (ties: fewer false
accusations, then a smaller accent gap). If no setting is within the cap, take the one that accuses least. The
result is a profile JSON ready for `publish_acoustic_model --bootstrap-profile`/the admin, plus a before/after table.
Tuning on synthetic clips is refused (it would only fit the generator).
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate import DEFAULT_PROFILE, load_profile, score_clip  # noqa: E402
from gold import Clip, load  # noqa: E402
from report import accent_gap, clean_reads, swap_recall  # noqa: E402

GRID: dict[str, list[float]] = {
    "tau_sub": [2.0, 2.5, 3.0, 3.5, 4.0, 5.0],
    "tau_del": [2.5, 3.0, 4.0, 5.0],
    "tau_uncertain": [0.5, 1.0, 1.5, 2.0],
    "tau_weak": [-1.5, -1.2, -0.9, -0.6],
}
ROUNDS = 2


def measure(clips: list[Clip], profile) -> dict:
    results = [score_clip(c, profile) for c in clips]
    swap = swap_recall(results)
    clean = clean_reads(results)
    return {
        "recall": swap["recall"] or 0.0,
        "false_accusation": clean["false_accusation_words"] or 0.0,
        "accent_gap": accent_gap(results)["gap"] or 0.0,
    }


def key(m: dict, cap: float) -> tuple:
    feasible = m["false_accusation"] <= cap
    # feasible settings rank by recall; infeasible ones by how little they accuse (precision first)
    return (feasible, m["recall"] if feasible else -m["false_accusation"], -m["false_accusation"], -m["accent_gap"])


def tune(clips: list[Clip], start=DEFAULT_PROFILE, cap: float = 0.04) -> tuple:
    best = start
    best_m = measure(clips, best)
    trail = [("start", None, best_m)]
    for _ in range(ROUNDS):
        improved = False
        for name, values in GRID.items():
            for v in values:
                if getattr(best, name) == v:
                    continue
                cand = replace(best, **{name: v})
                m = measure(clips, cand)
                if key(m, cap) > key(best_m, cap):
                    best, best_m, improved = cand, m, True
                    trail.append((name, v, m))
        if not improved:
            break
    return best, best_m, trail


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("gold")
    p.add_argument("--profile", help="start from this profile (default: engine defaults)")
    p.add_argument("--out", help="write the tuned profile JSON here")
    p.add_argument("--code", default="sp-tuned", help="profile code to put in the output")
    p.add_argument("--max-false-accusation", type=float, default=0.04, help="cap on the clean-read word accusation rate")
    p.add_argument("--allow-synthetic", action="store_true", help="tooling tests only")
    args = p.parse_args(argv)

    clips = load(args.gold)
    if any(c.synthetic for c in clips) and not args.allow_synthetic:
        print("refusing to tune on synthetic clips (they would only fit the generator); use --allow-synthetic for tests", file=sys.stderr)
        return 2
    start = load_profile(args.profile)
    before = measure(clips, start)
    best, after, trail = tune(clips, start, args.max_false_accusation)
    for name, value, m in trail[1:]:
        print(f"  {name} -> {value}: recall {m['recall']:.1%}, false accusation {m['false_accusation']:.1%}")
    print(f"before: recall {before['recall']:.1%}, false accusation {before['false_accusation']:.1%}, accent gap {before['accent_gap']}")
    print(f"after:  recall {after['recall']:.1%}, false accusation {after['false_accusation']:.1%}, accent gap {after['accent_gap']}")
    if after["false_accusation"] > args.max_false_accusation:
        print("warning: no setting stays within the false-accusation cap; this set may need better data or a better model", file=sys.stderr)
    if args.out:
        thresholds = {k: getattr(best, k) for k in GRID}
        Path(args.out).write_text(json.dumps({"code": args.code, "thresholds": thresholds}, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
