"""Pronunciation engine groundwork (E3-2a/E3-2b): pure logic, no model, no audio. See docs/features/17 section A6."""

import json
import math
import re
from pathlib import Path

import pytest

from tests.engine_vector_gen import FOCUS, PAIR, PHRASE, SELLS, VOCAB, build
from twisters.models import PhonemeVerdict, WordReason, WordStatus
from twisters.speak.engine import Posteriors, ScoringProfile, Word, assess
from twisters.speak.engine import types as t
from twisters.speak.engine.bench import Edit, Item, realise, silence, synthesise
from twisters.speak.engine.ctc import NEG_INF, ctc_log_prob, forced_align, logaddexp
from twisters.speak.engine.decode import edit_align, extra_runs, greedy_decode
from twisters.speak.engine.phones import confusables
from twisters.speak.engine.variants import (
    AccentRule,
    DictPronouncer,
    UnpronounceableWords,
    expand_variants,
    expected_words,
)
from twisters.speak.engine.verdict import fuse, phoneme_verdict

FIXTURE = Path(__file__).parent / "fixtures" / "engine_vectors.json"
V = json.loads(FIXTURE.read_text())


def run(words, edits=(), **kw):
    return assess(synthesise(realise(words, edits), VOCAB, **kw), words, FOCUS)


def test_fixture_is_current():
    """The stored vectors are exactly what the Python reference produces today (regenerate on purpose)."""
    assert json.loads(json.dumps(build())) == V


def test_verdict_constants_match_models():
    assert {t.OK, t.WEAK, t.SUBSTITUTED, t.DELETED, t.UNCERTAIN} <= set(PhonemeVerdict.values)
    assert {t.CORRECT, t.NEAR, t.WRONG, t.MISSED, t.EXTRA} == set(WordStatus.values)
    assert {t.FOCUS_SWAP, t.SLURRED} <= set(WordReason.values)


def test_engine_is_not_wired_into_speak_mode():
    # Only the scoring-job payload builder (variants) and the scoring shim may import it (doc 13 §3.4).
    root = Path(__file__).parents[1] / "twisters"
    pattern = re.compile(r"speak\.engine\b|from \.engine|from \.\.speak\.engine\b|import engine\b")
    offenders = [
        str(p.relative_to(root))
        for p in root.rglob("*.py")
        if "engine" not in p.parts
        and p.relative_to(root).as_posix() not in {"speak/jobs.py", "speak/scoring.py"}
        and pattern.search(p.read_text())
    ]
    assert offenders == []


# --- CTC -----------------------------------------------------------------------------------------


def test_logaddexp_handles_negative_infinity():
    assert logaddexp(NEG_INF, -2.0) == -2.0
    assert logaddexp(-2.0, NEG_INF) == -2.0
    assert logaddexp(NEG_INF, NEG_INF) == NEG_INF
    assert logaddexp(math.log(0.25), math.log(0.25)) == pytest.approx(math.log(0.5))


def _brute_force(logp, labels, blank=0):
    """Reference: sum over every frame->token path whose collapse equals ``labels``."""
    frames, size = len(logp), len(logp[0])
    total = 0.0

    def collapse(path):
        out, last = [], None
        for token in path:
            if token != last and token != blank:
                out.append(token)
            last = token
        return out

    def walk(t_, path, acc):
        nonlocal total
        if t_ == frames:
            if collapse(path) == labels:
                total += math.exp(acc)
            return
        for q in range(size):
            walk(t_ + 1, [*path, q], acc + logp[t_][q])

    walk(0, [], 0.0)
    return math.log(total) if total else NEG_INF


@pytest.mark.parametrize("labels", [[1], [1, 2], [1, 1], [2, 1, 2], []])
def test_ctc_forward_matches_brute_force(labels):
    rows = [[0.6, 0.3, 0.1], [0.2, 0.5, 0.3], [0.4, 0.1, 0.5], [0.3, 0.3, 0.4], [0.7, 0.2, 0.1]]
    logp = [[math.log(p) for p in row] for row in rows]
    assert ctc_log_prob(logp, labels) == pytest.approx(_brute_force(logp, labels), abs=1e-9)


def test_ctc_infeasible_and_empty():
    logp = [[math.log(0.5), math.log(0.5)]] * 2
    assert ctc_log_prob(logp, [1, 1, 1]) == NEG_INF
    assert forced_align(logp, [1, 1, 1]) is None
    assert ctc_log_prob([], []) == 0.0
    assert ctc_log_prob([], [1]) == NEG_INF
    assert forced_align(logp, []) == []


@pytest.mark.parametrize("case", V["ctc"], ids=lambda c: c["name"])
def test_ctc_vectors(case):
    post = Posteriors(tuple(case["vocab"]), case["logp"])
    ids = [post.index()[p] for p in case["labels"]]
    lp = ctc_log_prob(post.logp, ids)
    assert (None if lp == NEG_INF else round(lp, 4)) == case["log_prob"]
    spans = forced_align(post.logp, ids)
    assert (None if spans is None else [list(s) for s in spans]) == case["spans"]


def test_forced_align_is_monotonic_and_covers_every_label():
    words = [*PHRASE, *PHRASE]
    post = synthesise(realise(words), VOCAB)
    ids = [post.index()[p] for w in words for p in w.variants[0]]
    spans = forced_align(post.logp, ids)
    assert spans is not None and len(spans) == len(ids)
    for (a, b), (c, _) in zip(spans, spans[1:], strict=False):
        assert a < b <= c


# --- decode / windows ----------------------------------------------------------------------------


@pytest.mark.parametrize("case", V["decode"])
def test_edit_align_vectors(case):
    rows = edit_align(case["expected"], case["heard"])
    assert [list(r) for r in rows] == case["rows"]
    assert extra_runs(rows, 3) == case["extra_runs"]


def test_edit_align_credits_first_repetition():
    rows = edit_align(["S", "EH", "S", "EH"], ["S", "EH"])
    assert rows[:2] == [(0, 0), (1, 1)]
    assert rows[2:] == [(2, None), (3, None)]


def test_greedy_decode_collapses_repeats_but_not_across_blanks():
    lp = [[math.log(p) for p in row] for row in ([0.1, 0.9], [0.1, 0.9], [0.9, 0.1], [0.1, 0.9])]
    assert greedy_decode(lp) == [(1, 0, 2), (1, 3, 4)]


def test_windows_vector_never_overlap():
    w = V["windows"]["windows"]
    assert w[0][1] <= w[1][0]


# --- phones / variants ---------------------------------------------------------------------------


@pytest.mark.parametrize("case", V["confusables"]["cases"], ids=lambda c: c["phone"])
def test_confusables_vectors(case):
    assert confusables(case["phone"], case["focus"], V["confusables"]["vocab"]) == case["out"]


def test_confusables_exclude_self_and_unknown_labels():
    out = confusables("S", ["S", "SH", "XX"], ["<b>", "S", "SH"])
    assert out == ["SH"]


def test_protected_contrast_switches_the_rule_off():
    rules = [AccentRule("TH", "T", protects=("TH", "T", "F"))]
    assert expand_variants([["TH", "IH", "N"]], rules, []) == [["TH", "IH", "N"], ["T", "IH", "N"]]
    assert expand_variants([["TH", "IH", "N"]], rules, ["F"]) == [["TH", "IH", "N"]]


def test_expand_variants_dedupes_and_caps():
    rules = [AccentRule("A", "B"), AccentRule("B", "A")]
    out = expand_variants([["A", "B"]], rules, [])
    assert out == [["A", "B"], ["B", "B"], ["A", "A"]]
    many = [AccentRule("A", str(i)) for i in range(20)]
    assert len(expand_variants([["A"]], many, [])) == 8


@pytest.mark.parametrize("case", V["variants"]["expand"])
def test_expand_vectors(case):
    rules = [AccentRule(**r) for r in V["variants"]["rules"]]
    rules = [AccentRule(r.src, r.dst, tuple(r.protects)) for r in rules]
    assert expand_variants(case["variants"], rules, case["focus"]) == case["out"]


def test_expected_words_blocks_on_unknown_words():
    lex = DictPronouncer(V["variants"]["table"])
    with pytest.raises(UnpronounceableWords) as err:
        expected_words("She sells wuzzy", lex)
    assert err.value.words == ["wuzzy"]
    words = expected_words("10 sells", lex)
    assert [w.text for w in words] == ["ten", "sells"]
    assert expected_words("", lex) == []


# --- verdicts and fusion -------------------------------------------------------------------------


def test_phoneme_verdict_bands():
    p = ScoringProfile()
    assert phoneme_verdict(p, -0.1, None, None) == (t.OK, False)
    assert phoneme_verdict(p, -2.0, None, None) == (t.WEAK, False)
    assert phoneme_verdict(p, -0.1, -1.5, 2.0) == (t.UNCERTAIN, False)
    assert phoneme_verdict(p, -0.1, -3.0, None) == (t.SUBSTITUTED, False)
    assert phoneme_verdict(p, -0.1, None, -3.0) == (t.DELETED, True)
    assert phoneme_verdict(p, -0.1, -5.0, -5.0) == (t.SUBSTITUTED, False)  # tie: substitution
    assert phoneme_verdict(p, -0.1, -5.0, -6.0) == (t.DELETED, True)
    assert phoneme_verdict(p, -0.1, -0.9, 4.0) == (t.OK, False)


def test_fusion_never_forgives_an_acoustic_error():
    assert fuse(t.WRONG, t.FOCUS_SWAP, False, True) == (t.WRONG, t.FOCUS_SWAP)
    assert fuse(t.NEAR, "", False, True) == (t.NEAR, "")
    assert fuse(t.CORRECT, "", True, True) == (t.CORRECT, "")
    assert fuse(t.CORRECT, "", True, False) == (t.NEAR, "uncertain")
    assert fuse(t.CORRECT, "", False, False) == (t.CORRECT, "")  # acoustics win over the text layer
    assert fuse(t.MISSED, "", False, True) == (t.MISSED, "")
    assert fuse(t.CORRECT, "", True, None) == (t.CORRECT, "")


# --- assessment: stored vectors ------------------------------------------------------------------


def _flat(a):
    return json.loads(
        json.dumps(__import__("tests.engine_vector_gen", fromlist=["_assessment"])._assessment(a))
    )


@pytest.mark.parametrize("case", V["assess"], ids=lambda c: c["name"])
def test_assess_vectors(case):
    post = Posteriors(tuple(case["vocab"]), case["logp"])
    words = [Word(w["text"], w["variants"]) for w in case["words"]]
    result = assess(
        post, words, case["focus"], text_matches=case["text_matches"], difficulty=case["difficulty"]
    )
    assert _flat(result) == case["expect"]


# --- assessment: behaviour, asserted independently of the vectors -------------------------------


def statuses(a):
    return [(w.status, w.reason) for w in a.words]


def test_clean_read_is_perfect_and_quiet():
    a = run(PAIR)
    assert statuses(a) == [("correct", ""), ("correct", "")]
    assert (a.score, a.extras, a.focus_gated, a.unscorable) == (100, 0, False, None)
    assert all(p.verdict == "ok" for w in a.words for p in w.phonemes)


def test_focus_swap_is_found_and_names_what_was_heard():
    a = run(PAIR, [Edit("sub", 0, 0, "SH")])
    assert statuses(a)[0] == ("wrong", "focus_swap")
    first = a.words[0].phonemes[0]
    assert (first.verdict, first.heard, first.focus) == ("substituted", "SH", True)
    assert first.delta is not None and first.delta < -3


def test_focus_deletion_is_a_focus_swap_too():
    a = run(PAIR, [Edit("del", 0, 0)])
    assert statuses(a)[0] == ("wrong", "focus_swap")
    assert a.words[0].phonemes[0].verdict == "deleted"


def test_focus_gate_caps_at_79():
    long = [*PHRASE, *PHRASE, *PHRASE]
    a = assess(
        synthesise(realise(long, [Edit("sub", 1, 0, "SH")]), VOCAB), long, FOCUS, difficulty=2
    )
    assert a.focus_gated is True and a.score == 79


def test_non_focus_error_is_near_and_two_are_wrong():
    assert statuses(run(PAIR, [Edit("del", 0, 2)]))[0] == ("near", "")
    two = run(PAIR, [Edit("sub", 0, 1, "IY"), Edit("del", 0, 3)])
    assert statuses(two)[0] == ("wrong", "")
    assert two.focus_gated is False


def test_slurred_phone_is_weak_not_wrong():
    a = run(PAIR, [Edit("reduce", 0, 1, value=0.3)])
    assert statuses(a)[0] == ("near", "slurred")
    assert [p.verdict for p in a.words[0].phonemes] == ["ok", "weak", "ok", "ok"]


def test_ambiguous_phone_abstains_and_costs_nothing():
    a = run(PAIR, [Edit("blend", 0, 0, "SH", 0.7)])
    assert a.words[0].phonemes[0].verdict == "uncertain" and a.words[0].uncertain
    assert (a.words[0].status, a.score) == ("correct", 100)


def test_text_layer_cannot_hide_a_swap():
    post = synthesise(realise(PAIR, [Edit("sub", 0, 0, "SH")]), VOCAB)
    a = assess(post, PAIR, FOCUS, text_matches=[True, True])
    assert statuses(a)[0] == ("wrong", "focus_swap")


def test_repetition_credits_the_first_pass_and_counts_extra_speech():
    a = run(PAIR, [Edit("repeat_word", 1)])
    assert a.extras == 1 and statuses(a) == [("correct", ""), ("correct", "")]
    assert a.words[0].end <= a.words[1].start


def test_repeated_target_words_get_separate_windows():
    words = [Word("she", [["SH", "IY"]]), SELLS, Word("she", [["SH", "IY"]]), SELLS]
    a = run(words)
    spans = [(w.start, w.end) for w in a.words]
    assert all(x[1] <= y[0] for x, y in zip(spans, spans[1:], strict=False))
    assert [w.status for w in a.words] == ["correct"] * 4


def test_partial_read_is_scored_honestly_and_too_little_is_refused():
    half = run(PHRASE, [Edit("skip_word", 2), Edit("skip_word", 3)])
    assert [w.status for w in half.words] == ["correct", "correct", "missed", "missed"]
    assert half.unscorable is None and half.score < 60
    one = run(PHRASE, [Edit("skip_word", 1), Edit("skip_word", 2), Edit("skip_word", 3)])
    assert one.unscorable == "could_not_follow" and one.score == 0


def test_silence_and_empty_input_abstain():
    assert assess(silence(80, VOCAB), PAIR, FOCUS).unscorable == "no_speech"
    assert assess(Posteriors(("<b>", "S"), []), PAIR, FOCUS).unscorable == "no_speech"
    assert assess(synthesise(realise(PAIR), VOCAB), [], FOCUS).unscorable == "no_speech"


def test_mostly_blank_audio_is_nothing_recognised():
    items = [Item("S"), Item("", 200)]
    a = assess(synthesise(items, VOCAB, lead=0, tail=0), PAIR, FOCUS)
    assert a.unscorable == "nothing_recognised"


def test_the_best_variant_is_chosen():
    words = [Word("the", [["DH", "AH"], ["DH", "IY"]]), SELLS]
    a = assess(synthesise(realise(words, variant=[1, 0]), VOCAB), words, FOCUS)
    assert (a.words[0].variant, a.words[0].status) == (1, "correct")


def test_long_pause_hurts_fluency_only():
    a = run(PAIR, [Edit("pause", 0, value=40)])
    assert a.fluency < 1 and a.long_pause_ms >= 800
    assert [w.status for w in a.words] == ["correct", "correct"]


def test_unknown_phone_in_every_variant_is_a_configuration_error():
    with pytest.raises(ValueError, match="vocabulary"):
        assess(synthesise(realise(PAIR), VOCAB), [Word("x", [["QQ"]])], FOCUS)


def test_text_matches_may_be_shorter_than_the_word_list():
    post = synthesise(realise(PAIR, [Edit("blend", 0, 0, "SH", 0.7)]), VOCAB)
    assert assess(post, PAIR, FOCUS, text_matches=[False]).words[0].status == "near"


# --- properties ----------------------------------------------------------------------------------


def test_same_input_same_output():
    post = synthesise(realise(PHRASE, [Edit("sub", 1, 0, "SH")]), VOCAB, noise=0.5, seed=3)
    assert assess(post, PHRASE, FOCUS) == assess(post, PHRASE, FOCUS)


@pytest.mark.parametrize("noise", [0.2, 0.5, 0.8, 1.0])
def test_noise_never_turns_a_swap_into_ok(noise):
    for seed in range(1, 11):
        post = synthesise(realise(PHRASE, [Edit("sub", 1, 0, "SH")]), VOCAB, noise=noise, seed=seed)
        a = assess(post, PHRASE, FOCUS)
        assert a.words[1].phonemes[0].verdict != "ok", (noise, seed)
        assert a.words[1].status != "correct", (noise, seed)


def test_clean_reads_are_not_accused_under_noise():
    for seed in range(1, 21):
        a = assess(synthesise(realise(PHRASE), VOCAB, noise=0.6, seed=seed), PHRASE, FOCUS)
        assert a.focus_gated is False
        assert all(w.status in ("correct", "near") for w in a.words), seed
        assert not any(p.verdict in ("substituted", "deleted") for w in a.words for p in w.phonemes)


def test_spans_are_monotonic_across_the_attempt():
    a = run([*PHRASE, *PHRASE], noise=0.4)
    edges = [(p.start, p.end) for w in a.words for p in w.phonemes]
    assert all(x[0] < x[1] <= y[0] for x, y in zip(edges, edges[1:], strict=False))


# --- bench ---------------------------------------------------------------------------------------


def test_bench_is_deterministic_and_normalised():
    a = synthesise(realise(PAIR), VOCAB, noise=0.5, seed=9)
    b = synthesise(realise(PAIR), VOCAB, noise=0.5, seed=9)
    c = synthesise(realise(PAIR), VOCAB, noise=0.5, seed=10)
    assert a == b and a != c
    assert a.vocab[0] == "<b>"
    for row in a.logp:
        assert sum(math.exp(x) for x in row) == pytest.approx(1.0, abs=2e-3)


def test_bench_edits_change_the_realised_sounds():
    plain = realise(PAIR)
    assert [i.phone for i in realise(PAIR, [Edit("del", 0, 2)]) if i.phone][:3] == ["S", "EH", "Z"]
    assert (
        len([i for i in realise(PAIR, [Edit("repeat_word", 1)]) if i.phone])
        == len([i for i in plain if i.phone]) + 4
    )
    assert realise(PAIR, [Edit("skip_word", 0)])[0].phone == "SH"


# --- vendoring guarantees (docs/features/13 D37) -----------------------------------------------------


def test_score_constants_match_the_django_enums():
    from twisters.speak.engine import score as s

    assert set(s.STATUSES) == {x.value for x in WordStatus}
    assert s.FOCUS_SWAP == WordReason.FOCUS_SWAP.value
    assert {k: v for k, v in s.CREDIT.items()} == {
        WordStatus.CORRECT.value: 1.0,
        WordStatus.NEAR.value: 0.6,
        WordStatus.WRONG.value: 0.0,
        WordStatus.MISSED.value: 0.0,
        WordStatus.EXTRA.value: -0.15,
    }


def test_the_engine_package_does_not_import_django():
    import subprocess
    import sys

    code = (
        "import sys; import twisters.speak.engine, twisters.speak.engine.score;"
        "sys.exit(1 if any(m == 'django' or m.startswith('django.') for m in sys.modules) else 0)"
    )
    root = Path(__file__).parents[1]
    done = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True)
    assert done.returncode == 0, done.stderr


def test_a_long_read_is_scored_within_the_cpu_budget():
    """Perf guard (docs/features/13 §3.1): the neighbourhood-local tests keep a 64-word read fast."""
    import time

    words = PHRASE * 16
    vocab = sorted({p for w in words for v in w.variants for p in v})
    post = synthesise(realise(words, [Edit("sub", 1, 0, "SH")]), vocab, noise=0.3)
    started = time.perf_counter()
    result = assess(post, words, focus={"S", "SH"})
    assert time.perf_counter() - started < 2.0
    assert not result.unscorable
