"""The Accurate-mode evidence report (docs/features/13 §8): does the engine meet the exit gate on a gold set?

    python tools/calibrate/report.py GOLD_DIR [--profile p.json] [--out report.md] [--json report.json] [--check]

Everything is computed offline from stored posteriors, so a threshold change is judged in seconds. `--check` exits
non-zero unless the evidence is sufficient *and* every gate passes; synthetic clips never count as evidence.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from collections import Counter, defaultdict
from collections.abc import Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate import ClipResult, load_profile, score_clip  # noqa: E402
from fairness import breakdown  # noqa: E402
from gold import SCENARIOS, load  # noqa: E402

# The exit gate (docs/features/10 §7, 13 §8).
MIN_SWAP_RECALL = 0.85
MAX_FALSE_ACCUSATION = 0.05
MAX_ACCENT_GAP = 8.0
MAX_MEDIAN_LATENCY_MS = 3000  # per 15 s clip
HARD_LATENCY_MS = 8000
REFERENCE_CLIP_MS = 15_000
# What counts as enough evidence.
MIN_SPEAKERS = 6
MIN_EN_IN_SPEAKERS = 3
MIN_TWISTERS_PER_SPEAKER = 12
MIN_CLIPS_PER_ACCENT = 3


def _rate(n: int, d: int) -> float | None:
    return n / d if d else None


def swap_recall(results: Sequence[ClipResult]) -> dict:
    swaps = [r for r in results if r.clip.scenario == "swap"]
    detected = strict = 0
    table: Counter = Counter()
    for r in swaps:
        w = r.word(r.clip.swap_word) if r.scored else None
        if w is None:
            table["unscorable"] += 1
            continue
        table[f"{w.status}/{w.reason or '-'}"] += 1
        if w.status == "wrong":
            detected += 1
            strict += w.reason == "focus_swap"
    return {
        "clips": len(swaps),
        "detected": detected,
        "recall": _rate(detected, len(swaps)),
        "focus_swap_reason": _rate(strict, len(swaps)),
        "outcomes": dict(sorted(table.items())),
    }


def clean_reads(results: Sequence[ClipResult]) -> dict:
    clean = [r for r in results if r.clip.clean]
    scored = [r for r in clean if r.scored]
    words = sum(len(r.words) for r in scored)
    accused = sum(len(r.accused) for r in scored)
    return {
        "clips": len(clean),
        "scored_clips": len(scored),
        "unscorable_rate": _rate(len(clean) - len(scored), len(clean)),
        "words": words,
        "false_accusation_words": _rate(accused, words),
        "false_accusation_clips": _rate(sum(1 for r in scored if r.accused), len(scored)),
    }


def accent_gap(results: Sequence[ClipResult]) -> dict:
    scores: dict[str, list[int]] = defaultdict(list)
    for r in results:
        if r.clip.clean and r.scored:
            scores[r.clip.speaker.accent].append(r.score)
    means = {a: statistics.fmean(v) for a, v in sorted(scores.items()) if len(v) >= MIN_CLIPS_PER_ACCENT}
    gap = max(means.values()) - min(means.values()) if len(means) >= 2 else None
    return {"mean_clean_score": {a: round(m, 1) for a, m in means.items()}, "gap": None if gap is None else round(gap, 1)}


def latency(results: Sequence[ClipResult]) -> dict:
    per15 = [
        r.clip.latency_ms * REFERENCE_CLIP_MS / r.clip.duration_ms
        for r in results
        if r.clip.latency_ms is not None and r.clip.duration_ms > 0
    ]
    return {
        "clips": len(per15),
        "median_ms_per_15s": None if not per15 else round(statistics.median(per15)),
        "worst_ms_per_15s": None if not per15 else round(max(per15)),
    }


def confusion(results: Sequence[ClipResult], top: int = 12) -> list[dict]:
    pairs: Counter = Counter()
    for r in results:
        pairs.update(r.confusions)
    return [{"target": t, "heard": h, "count": n} for (t, h), n in pairs.most_common(top)]


def evidence(results: Sequence[ClipResult]) -> dict:
    clips = [r.clip for r in results]
    speakers = {c.speaker.id: c.speaker for c in clips}
    en_in = [s for s in speakers.values() if s.accent == "en-IN"]
    per_speaker: dict[str, set[str]] = defaultdict(set)
    for c in clips:
        per_speaker[c.speaker.id].add(c.slug)
    problems: list[str] = []
    if any(c.synthetic for c in clips):
        problems.append("contains synthetic clips (they test the tooling, not the model)")
    if len(speakers) < MIN_SPEAKERS:
        problems.append(f"{len(speakers)} speakers, need at least {MIN_SPEAKERS}")
    if len(en_in) < MIN_EN_IN_SPEAKERS:
        problems.append(f"{len(en_in)} en-IN speakers, need at least {MIN_EN_IN_SPEAKERS}")
    thin = sorted(s for s, slugs in per_speaker.items() if len(slugs) < MIN_TWISTERS_PER_SPEAKER)
    if thin:
        problems.append(f"{len(thin)} speakers read fewer than {MIN_TWISTERS_PER_SPEAKER} twisters")
    missing = [s for s in SCENARIOS if not any(c.scenario == s for c in clips)]
    if missing:
        problems.append("no clips for scenarios: " + ", ".join(missing))
    if not any(not s.native for s in speakers.values()):
        problems.append("no non-native speakers")
    return {"speakers": len(speakers), "en_in_speakers": len(en_in), "sufficient": not problems, "problems": problems}


def build(results: Sequence[ClipResult]) -> dict:
    swap = swap_recall(results)
    clean = clean_reads(results)
    gap = accent_gap(results)
    lat = latency(results)
    fair = breakdown(results)
    ev = evidence(results)

    def gate(name: str, value, target: str, ok: bool | None, fmt: str = "text") -> dict:
        return {"gate": name, "value": value, "target": target, "pass": ok, "fmt": fmt}

    gates = [
        gate("focus-swap recall", swap["recall"], f">= {MIN_SWAP_RECALL:.0%}",
             None if swap["recall"] is None else swap["recall"] >= MIN_SWAP_RECALL, "pct"),
        gate("false accusation (clean reads, per word)", clean["false_accusation_words"], f"<= {MAX_FALSE_ACCUSATION:.0%}",
             None if clean["false_accusation_words"] is None else clean["false_accusation_words"] <= MAX_FALSE_ACCUSATION, "pct"),
        gate("accent gap (mean clean score)", gap["gap"], f"<= {MAX_ACCENT_GAP:g} points",
             None if gap["gap"] is None else gap["gap"] <= MAX_ACCENT_GAP, "points"),
        gate("median latency per 15 s clip", lat["median_ms_per_15s"], f"<= {MAX_MEDIAN_LATENCY_MS} ms (ceiling {HARD_LATENCY_MS})",
             None if lat["median_ms_per_15s"] is None
             else lat["median_ms_per_15s"] <= MAX_MEDIAN_LATENCY_MS and lat["worst_ms_per_15s"] <= HARD_LATENCY_MS, "ms"),
        gate("no group above 1.5x overall false accusation", fair["blocking"] or "none", "none blocking", not fair["blocking"]),
    ]
    passed = ev["sufficient"] and all(g["pass"] is True for g in gates)
    return {
        "clips": len(results),
        "scenarios": dict(Counter(r.clip.scenario for r in results)),
        "evidence": ev,
        "swap": swap,
        "clean": clean,
        "accent": gap,
        "latency": lat,
        "fairness": fair,
        "confusion": confusion(results),
        "gates": gates,
        "pass": passed,
    }


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def render(report: dict, profile_name: str) -> str:
    out = [f"# Accurate-mode evidence report\n", f"Profile: `{profile_name}` · {report['clips']} clips · {report['evidence']['speakers']} speakers\n"]
    ev = report["evidence"]
    out.append("## Evidence\n")
    out.append("Sufficient to decide: **yes**\n" if ev["sufficient"] else "Sufficient to decide: **NO**\n")
    out += [f"- {p}" for p in ev["problems"]]
    out.append("\n## Exit gate\n")
    out.append("| Gate | Value | Target | Result |\n|---|---|---|---|")
    for g in report["gates"]:
        v = g["value"]
        if v is None:
            value = "n/a"
        elif g["fmt"] == "pct":
            value = _pct(v)
        elif g["fmt"] in ("points", "ms"):
            value = f"{v:g} {g['fmt']}"
        else:
            value = "; ".join(v) if isinstance(v, list) else str(v)
        result = "n/a" if g["pass"] is None else ("pass" if g["pass"] else "FAIL")
        out.append(f"| {g['gate']} | {value} | {g['target']} | {result} |")
    out.append(f"\n**Overall: {'PASS' if report['pass'] else 'NOT READY'}**\n")
    s = report["swap"]
    out.append("## Scripted swaps\n")
    out.append(f"{s['detected']} of {s['clips']} detected as wrong ({_pct(s['recall'])}); flagged specifically as a focus swap: {_pct(s['focus_swap_reason'])}.\n")
    out += [f"- {k}: {v}" for k, v in s["outcomes"].items()]
    c = report["clean"]
    out.append("\n## Clean reads\n")
    out.append(f"{c['scored_clips']} of {c['clips']} clips scorable · false accusation {_pct(c['false_accusation_words'])} of words, {_pct(c['false_accusation_clips'])} of clips.\n")
    out.append("## Accents\n")
    out += [f"- {a}: mean clean score {m}" for a, m in report["accent"]["mean_clean_score"].items()]
    out.append(f"- gap: {report['accent']['gap']}\n")
    out.append("## Fairness (clean reads)\n")
    out.append("| Dimension | Group | Speakers | Words | False accusation | Abstention | Status |\n|---|---|---|---|---|---|---|")
    for g in report["fairness"]["groups"]:
        out.append(f"| {g['dimension']} | {g['name']} | {g['speakers']} | {g['words']} | {_pct(g['false_accusation'])} | {_pct(g['abstention'])} | {g['status']} |")
    out.append("\n## Most common substitutions\n")
    out += [f"- {x['target']} heard as {x['heard']}: {x['count']}" for x in report["confusion"]] or ["- none"]
    lat = report["latency"]
    out.append(f"\n## Latency\n\n{lat['clips']} clips with timing · median {lat['median_ms_per_15s']} ms per 15 s · worst {lat['worst_ms_per_15s']} ms\n")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("gold")
    p.add_argument("--profile")
    p.add_argument("--out", help="write the markdown report here")
    p.add_argument("--json", dest="json_out", help="write the machine-readable report here")
    p.add_argument("--check", action="store_true", help="exit 1 unless the evidence is sufficient and every gate passes")
    args = p.parse_args(argv)
    profile = load_profile(args.profile)
    report = build([score_clip(c, profile) for c in load(args.gold)])
    text = render(report, profile.name)
    print(text)
    if args.out:
        Path(args.out).write_text(text)
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2, default=str))
    return 0 if report["pass"] or not args.check else 1


if __name__ == "__main__":
    raise SystemExit(main())
