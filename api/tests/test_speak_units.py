"""Pure Speak & Score logic. The JSON vectors are shared with the web client's tests."""

import json
from pathlib import Path

import pytest

from twisters.speak import lexicon, scoring
from twisters.speak.alignment import SpokenToken, align, merge_split_compounds
from twisters.speak.normalise import equivalents, homophones, spell_number, tokenise
from twisters.speak.pipeline import evaluate
from twisters.speak.similarity import classify, single_edit_span

VECTORS = json.loads((Path(__file__).parent / "fixtures" / "speak_vectors.json").read_text())


@pytest.mark.parametrize("case", VECTORS["normalise"], ids=lambda c: c["in"][:30])
def test_normalise_vectors(case):
    assert tokenise(case["in"]) == case["out"]


@pytest.mark.parametrize("case", VECTORS["classify"], ids=lambda c: f"{c['target']}>{c['spoken']}")
def test_classify_vectors(case):
    match = classify(
        case["target"], case["spoken"], case.get("focus", []), case.get("accepted", [])
    )
    assert (match.status, match.reason) == (case["status"], case["reason"])


@pytest.mark.parametrize("case", VECTORS["align"], ids=lambda c: c["spoken"][:30] or "silence")
def test_alignment_vectors(case):
    targets = tokenise(case["target"])
    spoken = merge_split_compounds(targets, tokenise(case["spoken"]))
    rows = align(targets, spoken, focus=case.get("focus", []))
    assert [[r.target_index, r.spoken_index, r.status, r.reason] for r in rows] == case["rows"]


@pytest.mark.parametrize("case", VECTORS["score"], ids=lambda c: c["spoken"][:30])
def test_score_vectors(case):
    ev = evaluate(
        case["target"],
        case["spoken"],
        duration_ms=case["duration_ms"],
        long_pause_ms=case["long_pause_ms"],
        difficulty=case["difficulty"],
        focus_sounds=case["focus"],
    )
    s, want = ev.score, case["expect"]
    assert s.score == want["score"]
    assert s.counts == want["counts"]
    assert s.focus_gated == want["focus_gated"]
    for key in ("accuracy", "speed", "fluency", "completeness", "wpm"):
        assert getattr(s, key) == pytest.approx(want[key], abs=1e-3)


# --- properties the PRD promises --------------------------------------------------------------


def test_one_spoken_word_is_never_assigned_to_two_targets():
    """PRD 03 §11: the alignment never reuses a spoken word."""
    for case in VECTORS["align"]:
        rows = align(
            tokenise(case["target"]),
            merge_split_compounds(tokenise(case["target"]), tokenise(case["spoken"])),
        )
        used = [r.spoken_index for r in rows if r.spoken_index is not None]
        assert len(used) == len(set(used))


def test_alignment_is_deterministic_and_covers_every_target_once():
    targets = tokenise("red lorry yellow lorry red lorry")
    spoken = [SpokenToken(w, i) for i, w in enumerate(tokenise("lorry red yellow red lorry lorry"))]
    first, second = align(targets, spoken), align(targets, spoken)
    assert first == second
    assert sorted(r.target_index for r in first if r.target_index is not None) == list(
        range(len(targets))
    )


def test_focus_swap_caps_the_score_below_pass():
    ev = evaluate(
        "She sells seashells by the seashore",
        "she shells seashells by the seashore",
        duration_ms=3000,
        focus_sounds=["s", "sh"],
    )
    assert ev.score.score == scoring.FOCUS_SCORE_CAP and ev.score.focus_gated


def test_focus_swap_needs_a_focus_sound():
    ev = evaluate(
        "She sells seashells by the seashore",
        "she shells seashells by the seashore",
        duration_ms=3000,
        focus_sounds=["p"],
    )
    assert not ev.score.focus_gated


def test_speed_is_ignored_when_accuracy_is_low():
    ev = evaluate("one two three four five", "one x y z q", duration_ms=500, difficulty=1)
    assert ev.score.speed == 0.0


def test_extra_penalty_is_capped():
    ev = evaluate("one", "one " + "two " * 30, duration_ms=60_000)
    assert ev.score.accuracy == pytest.approx(0.5)


def test_accuracy_never_negative():
    assert evaluate("one two", "x " * 20, duration_ms=10_000).score.accuracy == 0.0


def test_silence_scores_zero_accuracy():
    ev = evaluate("one two", "", duration_ms=1000)
    assert ev.spoken_words == 0 and ev.score.accuracy == 0.0


def test_score_is_bounded():
    best = evaluate("go", "go", duration_ms=500)
    assert 0 <= best.score.score <= 100


# --- building blocks ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "a,b,span",
    [
        ("sells", "shells", (1, 1)),
        ("she", "see", (1, 2)),
        ("sells", "sell", (4, 5)),
        ("peck", "pack", (1, 2)),
        ("same", "same", None),
        ("abc", "abcde", None),
    ],
)
def test_single_edit_span(a, b, span):
    assert single_edit_span(a, b) == span


def test_spell_number_covers_the_edges():
    assert spell_number(0) == ["zero"]
    assert spell_number(100) == ["one", "hundred"]
    assert spell_number(999_999)[-1] == "nine"
    assert spell_number(1_000_000) == ["one", "zero", "zero", "zero", "zero", "zero", "zero"]


def test_data_files_are_consistent():
    data = equivalents()
    assert all(k != v for k, v in data["spelling"].items())
    for group in data["homophones"]:
        assert len(group) == len(set(group)) >= 2
    assert "sells" in homophones("cells") and homophones("zzz") == frozenset({"zzz"})


def test_merge_only_joins_words_the_twister_contains():
    assert [t.text for t in merge_split_compounds(["seashore"], ["the", "sea", "shore"])] == [
        "the",
        "seashore",
    ]
    assert [t.text for t in merge_split_compounds(["sea", "shore"], ["sea", "shore"])] == [
        "sea",
        "shore",
    ]


def test_lexicon_resolves_common_and_derived_words():
    assert lexicon.lookup("peter") and lexicon.lookup("pickled") and lexicon.lookup("canopies")
    assert lexicon.format_variant(lexicon.lookup("sells")[0]) == "S EH L Z"
    assert lexicon.lookup("qzxv") == []
