"""Deterministic *synthetic* gold clips, for testing the calibration tools themselves.

Posteriors come from the engine's synthetic bench (no model, no audio), so these clips exercise the loader, the
report, the tuner and the regression test. They say nothing about how accurate any acoustic model is, and every
clip is marked ``"synthetic": true`` so the report and the tuner refuse to treat them as evidence.

    python tools/calibrate/make_synthetic_gold.py OUT_DIR [--speakers 4] [--twisters 3]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import evaluate  # noqa: F401,E402  (puts api/ on sys.path)
from gold import SCHEMA, encode_posteriors  # noqa: E402
from twisters.speak.engine.bench import Edit, Item, realise, synthesise  # noqa: E402
from twisters.speak.engine.types import Word  # noqa: E402
from twisters.speak.engine.variants import AccentRule, expand_variants  # noqa: E402

# slug, focus phones, difficulty, [(word, ARPAbet variants)], swap (focus phone -> what a swap sounds like)
TWISTERS = [
    ("sells-shells", ["S", "SH"], 2, [("she", [["SH", "IY"]]), ("sells", [["S", "EH", "L", "Z"]]), ("sea", [["S", "IY"]]), ("shells", [["SH", "EH", "L", "Z"]])], {"S": "SH", "SH": "S"}),
    ("peter-piper", ["P"], 2, [("peter", [["P", "IY", "T", "ER"]]), ("piper", [["P", "AY", "P", "ER"]]), ("picked", [["P", "IH", "K", "T"]]), ("pecks", [["P", "EH", "K", "S"]])], {"P": "B"}),
    ("red-lorry", ["R", "L"], 3, [("red", [["R", "EH", "D"]]), ("lorry", [["L", "AO", "R", "IY"]]), ("yellow", [["Y", "EH", "L", "OW"]]), ("lorry", [["L", "AO", "R", "IY"]])], {"R": "L", "L": "R"}),
    ("three-free", ["TH", "F"], 2, [("three", [["TH", "R", "IY"]]), ("free", [["F", "R", "IY"]]), ("throws", [["TH", "R", "OW", "Z"]])], {"TH": "F", "F": "TH"}),
    ("betty-butter", ["B"], 2, [("betty", [["B", "EH", "T", "IY"]]), ("bought", [["B", "AO", "T"]]), ("bitter", [["B", "IH", "T", "ER"]]), ("butter", [["B", "AH", "T", "ER"]])], {"B": "P"}),
]
SPEAKERS = [
    ("S01", "en-IN", "25-34", True, "laptop", 0.15),
    ("S02", "en-IN", "18-24", True, "phone", 0.2),
    ("S03", "en-US", "35-49", True, "laptop", 0.1),
    ("S04", "en-GB", "18-24", True, "desktop", 0.12),
    ("S05", "en-IN", "50+", False, "phone", 0.25),
    ("S06", "en-AU", "25-34", True, "tablet", 0.1),
]
# What an en-IN speaker may realise differently; the accent pack accepts it (the scorer must not accuse).
INDIAN_RULES = [AccentRule("TH", "T", protects=("TH", "T")), AccentRule("Z", "S", protects=("Z", "S")), AccentRule("W", "V", protects=("W", "V"))]
SCENARIOS = ("clean", "fast", "swap", "slur")


def clip(speaker, twister, scenario, seed: int) -> dict:
    sid, accent, age, native, device, noise = speaker
    slug, focus, difficulty, entries, swaps = twister
    rules = INDIAN_RULES if accent == "en-IN" else []
    words = [Word(text, expand_variants(variants, rules, focus)) for text, variants in entries]
    vocab = sorted({p for w in words for v in w.variants for p in v} | set(swaps.values()))
    edits: list[Edit] = []
    swap_word = None
    if scenario == "swap":
        for wi, w in enumerate(words):
            pos = next((i for i, p in enumerate(w.variants[0]) if p in swaps), None)
            if pos is not None:
                edits.append(Edit("sub", wi, pos, swaps[w.variants[0][pos]]))
                swap_word = wi
                break
    elif scenario == "slur":
        for wi in (0, len(words) - 1):
            pos = next((i for i, p in enumerate(words[wi].variants[0]) if p not in focus), None)
            if pos is not None:
                edits.append(Edit("reduce", wi, pos, value=0.3))
    items = realise(words, edits)
    if scenario == "fast":
        items = [Item(i.phone, 1, i.peak, i.mix, i.share) if i.phone else Item("", 1) for i in items]
    post = synthesise(items, vocab, noise=noise, seed=seed)
    return {
        "schema": SCHEMA,
        "id": f"{sid}-{slug}-{scenario}",
        "consent": True,
        "synthetic": True,
        "speaker": {"id": sid, "accent": accent, "age_band": age, "native": native, "device_class": device},
        "scenario": scenario,
        "swap_word": swap_word,
        "twister": {
            "slug": slug,
            "focus": focus,
            "difficulty": difficulty,
            "words": [{"text": w.text, "variants": w.variants} for w in words],
        },
        "posteriors": {"vocab": list(post.vocab), "frames": post.frames, "logp_f16": encode_posteriors(post.logp)},
        "duration_ms": post.frames * 20,
    }


def build(speakers: int = 4, twisters: int = 3) -> list[dict]:
    out = []
    for si, s in enumerate(SPEAKERS[:speakers]):
        for ti, t in enumerate(TWISTERS[:twisters]):
            for ci, scenario in enumerate(SCENARIOS):
                out.append(clip(s, t, scenario, seed=1 + si * 97 + ti * 31 + ci * 7))
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("out")
    p.add_argument("--speakers", type=int, default=4)
    p.add_argument("--twisters", type=int, default=3)
    args = p.parse_args(argv)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for c in build(args.speakers, args.twisters):
        (out / f"{c['id']}.json").write_text(json.dumps(c, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
