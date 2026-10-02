"""Per-group error rates (docs/features/13 §3.8): false accusation and abstention by accent, age band, device class.

A false accusation is a word the engine called *wrong* in a read that was correct by construction (clean/fast
scenarios). Any group whose rate exceeds 1.5x the overall rate blocks enabling Accurate mode, but only once the
group has enough words to mean something: below `MIN_WORDS` it is reported as insufficient data, which also blocks
(an unmeasured group is not a safe group).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from evaluate import ClipResult

FACTOR = 1.5
MIN_WORDS = 100

GROUPS: dict[str, Callable[[ClipResult], str]] = {
    "accent": lambda r: r.clip.speaker.accent,
    "age_band": lambda r: r.clip.speaker.age_band,
    "device_class": lambda r: r.clip.speaker.device_class,
    "native": lambda r: "native" if r.clip.speaker.native else "non-native",
}


@dataclass(frozen=True)
class Group:
    dimension: str
    name: str
    clips: int
    words: int
    accused: int
    abstained: int
    unscorable: int
    speakers: int

    @property
    def false_accusation(self) -> float | None:
        return self.accused / self.words if self.words else None

    @property
    def abstention(self) -> float | None:
        return self.abstained / self.words if self.words else None


def tally(results: Sequence[ClipResult], dimension: str, key: Callable[[ClipResult], str]) -> list[Group]:
    """Clean reads only: those are the ones where an accusation is known to be wrong."""
    acc: dict[str, dict] = defaultdict(
        lambda: {"clips": 0, "words": 0, "accused": 0, "abstained": 0, "unscorable": 0, "speakers": set()}
    )
    for r in results:
        if not r.clip.clean:
            continue
        g = acc[key(r)]
        g["clips"] += 1
        g["speakers"].add(r.clip.speaker.id)
        if not r.scored:
            g["unscorable"] += 1
            continue
        g["words"] += len(r.words)
        g["accused"] += len(r.accused)
        g["abstained"] += len(r.abstained)
    return [
        Group(dimension, name, v["clips"], v["words"], v["accused"], v["abstained"], v["unscorable"], len(v["speakers"]))
        for name, v in sorted(acc.items())
    ]


def overall(results: Sequence[ClipResult]) -> Group:
    return tally(results, "overall", lambda _r: "all")[0] if any(r.clip.clean for r in results) else Group(
        "overall", "all", 0, 0, 0, 0, 0, 0
    )


def breakdown(results: Sequence[ClipResult]) -> dict:
    """{overall, groups: [...], verdicts: [{dimension, name, status}], blocking: [...]}"""
    base = overall(results)
    rate = base.false_accusation
    groups: list[dict] = []
    blocking: list[str] = []
    for dimension, key in GROUPS.items():
        for g in tally(results, dimension, key):
            if g.words < MIN_WORDS:
                status = "insufficient_data"
            elif rate is None:
                status = "insufficient_data"
            elif rate == 0:
                status = "ok" if g.accused == 0 else "above_limit"
            else:
                status = "above_limit" if g.false_accusation > FACTOR * rate else "ok"
            if status != "ok":
                blocking.append(f"{dimension}={g.name}: {status.replace('_', ' ')}")
            groups.append(
                {
                    "dimension": dimension,
                    "name": g.name,
                    "clips": g.clips,
                    "speakers": g.speakers,
                    "words": g.words,
                    "false_accusation": g.false_accusation,
                    "abstention": g.abstention,
                    "unscorable": g.unscorable,
                    "status": status,
                }
            )
    return {
        "overall": {
            "clips": base.clips,
            "words": base.words,
            "false_accusation": rate,
            "abstention": base.abstention,
        },
        "limit": f"{FACTOR}x overall, at least {MIN_WORDS} words per group",
        "groups": groups,
        "blocking": blocking,
    }


def main(argv: list[str] | None = None) -> int:
    import argparse

    from evaluate import load_profile, score_clip
    from gold import load

    p = argparse.ArgumentParser(description="Per-group false-accusation and abstention rates for a gold set.")
    p.add_argument("gold", help="directory or file of gold clips")
    p.add_argument("--profile", help="scoring profile JSON (thresholds); default: engine defaults")
    args = p.parse_args(argv)
    profile = load_profile(args.profile)
    results = [score_clip(c, profile) for c in load(args.gold)]
    out = breakdown(results)
    pct = lambda x: "n/a" if x is None else f"{100 * x:.1f}%"  # noqa: E731
    print(f"overall: false accusation {pct(out['overall']['false_accusation'])} over {out['overall']['words']} words")
    for g in out["groups"]:
        print(
            f"  {g['dimension']:<13} {g['name']:<11} FA {pct(g['false_accusation']):>6}  abstain {pct(g['abstention']):>6}"
            f"  ({g['words']} words, {g['speakers']} speakers)  {g['status']}"
        )
    return 1 if out["blocking"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
