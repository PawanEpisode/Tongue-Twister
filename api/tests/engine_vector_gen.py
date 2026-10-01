"""Builds ``fixtures/engine_vectors.json``: the vectors both engine ports must reproduce (E3-2).

Run ``python -m tests.engine_vector_gen`` from ``api/`` (with ``DJANGO_SETTINGS_MODULE=config.settings_test``) to
rewrite the file. ``test_engine_units.py`` fails when the stored file differs from a fresh build, so the file can
never silently drift from the Python reference. The posteriors come from the synthetic bench (no model, no audio).
"""

import json
import os
from dataclasses import asdict
from pathlib import Path

if __name__ == "__main__":  # the score formula imports models, so Django must be ready first
    import django

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings_test")
    django.setup()

from twisters.speak.engine import assess  # noqa: E402
from twisters.speak.engine.bench import Edit, realise, silence, synthesise
from twisters.speak.engine.ctc import NEG_INF, ctc_log_prob, forced_align
from twisters.speak.engine.decode import edit_align, extra_runs, greedy_decode, word_windows
from twisters.speak.engine.phones import confusables
from twisters.speak.engine.types import Posteriors, Word
from twisters.speak.engine.variants import (
    AccentRule,
    DictPronouncer,
    expand_variants,
    expected_words,
)

PATH = Path(__file__).parent / "fixtures" / "engine_vectors.json"

SELLS = Word("sells", [["S", "EH", "L", "Z"]])
SHELLS = Word("shells", [["SH", "EH", "L", "Z"]])
SHE = Word("she", [["SH", "IY"]])
SEA = Word("sea", [["S", "IY"]])
THE = Word("the", [["DH", "AH"], ["DH", "IY"]])
PAIR = [SELLS, SHELLS]
PHRASE = [SHE, SELLS, SEA, SHELLS]
VOCAB = ["S", "SH", "EH", "L", "Z", "IY", "DH", "AH"]
FOCUS = ["S", "SH"]

# name, words, edits, variant, noise, seed, text_matches, difficulty
CASES = [
    ("clean_pair", PAIR, [], [], 0.0, 1, None, 2),
    ("focus_swap", PAIR, [Edit("sub", 0, 0, "SH")], [], 0.0, 1, None, 2),
    ("focus_deleted", PAIR, [Edit("del", 0, 0)], [], 0.0, 1, None, 2),
    ("one_nonfocus_deleted", PAIR, [Edit("del", 0, 2)], [], 0.0, 1, None, 2),
    ("two_nonfocus_errors", PAIR, [Edit("sub", 0, 1, "IY"), Edit("del", 0, 3)], [], 0.0, 1, None, 2),
    ("slurred", PAIR, [Edit("reduce", 0, 1, value=0.3)], [], 0.0, 1, None, 2),
    ("uncertain_no_text", PAIR, [Edit("blend", 0, 0, "SH", 0.7)], [], 0.0, 1, None, 2),
    ("uncertain_text_differs", PAIR, [Edit("blend", 0, 0, "SH", 0.7)], [], 0.0, 1, [False, True], 2),
    ("uncertain_text_matches", PAIR, [Edit("blend", 0, 0, "SH", 0.7)], [], 0.0, 1, [True, True], 2),
    ("swap_text_autocorrected", PAIR, [Edit("sub", 0, 0, "SH")], [], 0.0, 1, [True, True], 2),
    ("repeated_word_extra", PAIR, [Edit("repeat_word", 1)], [], 0.0, 1, None, 2),
    ("second_half_skipped", PHRASE, [Edit("skip_word", 2), Edit("skip_word", 3)], [], 0.0, 1, None, 2),
    ("only_one_word", PHRASE, [Edit("skip_word", 1), Edit("skip_word", 2), Edit("skip_word", 3)], [], 0.0, 1, None, 2),
    ("clean_phrase_noisy", PHRASE, [], [], 0.6, 5, None, 3),
    ("swap_phrase_noisy", PHRASE, [Edit("sub", 1, 0, "SH")], [], 0.8, 7, None, 3),
    ("second_variant_said", [THE, SELLS], [], [1, 0], 0.0, 1, None, 2),
    ("long_pause", PAIR, [Edit("pause", 0, value=40)], [], 0.0, 1, None, 2),
    ("repeated_target_words", [SHE, SELLS, SHE, SELLS], [], [], 0.0, 1, None, 2),
    ("extra_speech_between", PAIR, [Edit("extra", 0, phones=("AH", "IY", "AH"))], [], 0.0, 1, None, 2),
]  # fmt: skip


def _round(x: float | None) -> float | None:
    return None if x is None else round(x, 3)


def _assessment(a) -> dict:
    return {
        "unscorable": a.unscorable,
        "extras": a.extras,
        "accuracy": a.accuracy,
        "speed": a.speed,
        "fluency": a.fluency,
        "score": a.score,
        "focus_gated": a.focus_gated,
        "long_pause_ms": a.long_pause_ms,
        "duration_ms": a.duration_ms,
        "words": [
            {
                "index": w.index,
                "text": w.text,
                "status": w.status,
                "reason": w.reason,
                "uncertain": w.uncertain,
                "variant": w.variant,
                "start": w.start,
                "end": w.end,
                "phonemes": [
                    {
                        "t": p.target,
                        "heard": p.heard,
                        "verdict": p.verdict,
                        "start": p.start,
                        "end": p.end,
                        "delta": _round(p.delta),
                        "lpp": _round(p.lpp),
                        "lpr": _round(p.lpr),
                        "focus": p.focus,
                    }
                    for p in w.phonemes
                ],
            }
            for w in a.words
        ],
    }


def _word(w: Word) -> dict:
    return {"text": w.text, "variants": w.variants}


def _ctc_cases() -> list[dict]:
    vocab = ["S", "SH", "EH"]
    base = synthesise(realise([Word("x", [["S", "EH"]])]), vocab, lead=1, tail=1)
    double = synthesise(realise([Word("x", [["EH", "EH"]])]), vocab, lead=1, tail=1)
    short = Posteriors(base.vocab, base.logp[:2])
    cases = []
    for name, post, labels in [
        ("two_labels", base, ["S", "EH"]),
        ("wrong_label", base, ["SH", "EH"]),
        ("repeated_label_needs_blank", double, ["EH", "EH"]),
        ("too_short", short, ["S", "EH", "SH"]),
        ("empty_labels", base, []),
    ]:
        ids = [post.index()[p] for p in labels]
        lp = ctc_log_prob(post.logp, ids)
        spans = forced_align(post.logp, ids)
        cases.append(
            {
                "name": name,
                "vocab": list(post.vocab),
                "logp": post.logp,
                "labels": labels,
                "log_prob": None if lp == NEG_INF else round(lp, 4),
                "spans": None if spans is None else [list(s) for s in spans],
            }
        )
    return cases


def _decode_cases() -> list[dict]:
    pairs = [
        (["S", "EH", "L", "Z"], ["S", "EH", "L", "Z"]),
        (["S", "EH", "L", "Z"], ["SH", "EH", "L", "Z"]),
        (["S", "EH", "L", "Z"], ["S", "EH", "Z"]),
        (["S", "EH", "L", "Z"], ["S", "EH", "L", "L", "Z"]),
        (["S", "EH", "L", "Z", "SH", "EH", "L", "Z"], ["S", "EH", "L", "Z"]),
        (["S", "IY"], []),
        ([], ["S", "IY", "S"]),
    ]
    out = []
    for exp, heard in pairs:
        rows = edit_align(exp, heard)
        out.append(
            {
                "expected": exp,
                "heard": heard,
                "rows": [list(r) for r in rows],
                "extra_runs": extra_runs(rows, 3),
            }
        )
    return out


def _window_case() -> dict:
    words = [SELLS, SHELLS]
    post = synthesise(realise(words), VOCAB)
    segs = greedy_decode(post.logp)
    flat = ["S", "EH", "L", "Z", "SH", "EH", "L", "Z"]
    word_of = [0, 0, 0, 0, 1, 1, 1, 1]
    rows = edit_align(flat, [post.vocab[s[0]] for s in segs])
    windows = word_windows(rows, word_of, segs, 2, post.frames, 7)
    return {
        "vocab": list(post.vocab),
        "logp": post.logp,
        "segments": [list(s) for s in segs],
        "windows": [None if w is None else list(w) for w in windows],
    }


def _variant_cases() -> dict:
    rules = [
        AccentRule("TH", "T", protects=("TH", "T", "F")),
        AccentRule("DH", "D", protects=("DH", "D")),
        AccentRule("V", "W", protects=("V", "W")),
    ]
    expand = []
    for variants, focus in [
        ([["TH", "IH", "N"]], []),
        ([["TH", "IH", "N"]], ["TH"]),
        ([["DH", "AH"], ["DH", "IY"]], []),
        ([["V", "EH", "L", "V", "IH", "T"]], []),
        ([["V", "EH", "L", "V", "IH", "T"]], ["W"]),
    ]:
        expand.append(
            {"variants": variants, "focus": focus, "out": expand_variants(variants, rules, focus)}
        )
    table = {"she": [["SH", "IY"]], "sells": [["S", "EH", "L", "Z"]], "ten": [["T", "EH", "N"]]}
    lex = DictPronouncer(table)
    texts = []
    for text in ["She sells!", "10 sells", "She sells wuzzy", ""]:
        try:
            out = [_word(w) for w in expected_words(text, lex, rules=rules, focus=[])]
            texts.append({"text": text, "words": out, "missing": None})
        except ValueError as exc:
            texts.append({"text": text, "words": None, "missing": sorted(exc.words)})
    return {
        "rules": [asdict(r) for r in rules],
        "expand": expand,
        "table": table,
        "expected_words": texts,
    }


def build() -> dict:
    assess_cases = []
    for name, words, edits, variant, noise, seed, matches, difficulty in CASES:
        post = synthesise(realise(words, edits, variant), VOCAB, noise=noise, seed=seed)
        result = assess(post, words, FOCUS, text_matches=matches, difficulty=difficulty)
        assess_cases.append(
            {
                "name": name,
                "words": [_word(w) for w in words],
                "focus": FOCUS,
                "text_matches": matches,
                "difficulty": difficulty,
                "vocab": list(post.vocab),
                "logp": post.logp,
                "expect": _assessment(result),
            }
        )
    quiet = silence(60, VOCAB)
    assess_cases.append(
        {
            "name": "silence",
            "words": [_word(w) for w in PAIR],
            "focus": FOCUS,
            "text_matches": None,
            "difficulty": 2,
            "vocab": list(quiet.vocab),
            "logp": quiet.logp,
            "expect": _assessment(assess(quiet, PAIR, FOCUS)),
        }
    )
    vocab = ["<b>", *VOCAB, "T", "F", "D", "UW"]
    conf = [
        {"phone": p, "focus": f, "out": confusables(p, f, vocab)}
        for p, f in [("S", []), ("S", ["S", "SH"]), ("TH", ["TH", "F"]), ("EH", []), ("XX", ["S"])]
    ]
    return {
        "ctc": _ctc_cases(),
        "decode": _decode_cases(),
        "windows": _window_case(),
        "confusables": {"vocab": vocab, "cases": conf},
        "variants": _variant_cases(),
        "assess": assess_cases,
    }


if __name__ == "__main__":
    PATH.write_text(json.dumps(build(), indent=None, separators=(",", ":")) + "\n")
    print(f"wrote {PATH} ({PATH.stat().st_size} bytes)")
