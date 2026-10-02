"""Quality gates (docs/features/13 section 3.7): behaviour, profile control and the shared vectors."""

import json
import math

import pytest

from tests.quality_vector_gen import PATH, build, render
from twisters.speak.engine import quality as q
from twisters.speak.engine.types import Posteriors, ScoringProfile

V = json.loads(PATH.read_text())


def test_fixture_is_current():
    assert json.loads(json.dumps(build())) == V


def by_name(items, name):
    return next(x for x in items if x["name"] == name)


@pytest.mark.parametrize(
    "name,gate",
    [
        ("clean", None),
        ("quiet", q.TOO_QUIET),
        ("noisy", q.TOO_NOISY),
        ("clipped", q.CLIPPING),
        ("low_rate", q.LOW_SAMPLE_RATE),
        ("silence", q.TOO_QUIET),
        ("tiny", q.TOO_SHORT),
        ("hardware_8k_resampled", q.LOW_SAMPLE_RATE),
    ],
)
def test_signal_gate_outcomes(name, gate):
    case = by_name(V["signals"], name)
    spec = case["spec"]
    got = q.signal_gate(render(spec), spec["sample_rate"], capture_rate=spec.get("capture_rate"))
    assert got.gate == gate and got.ok == (gate is None)


def test_continuous_speech_with_no_pauses_is_flagged_noisy_until_calibration_relaxes_it():
    case = by_name(V["signals"], "continuous_speech")
    samples = render(case["spec"])
    assert q.signal_gate(samples, 16000).gate == q.TOO_NOISY
    relaxed = ScoringProfile(gate_min_snr_db=0.0)
    assert q.signal_gate(samples, 16000, relaxed).ok


def test_thresholds_come_from_the_profile():
    case = by_name(V["signals"], "quiet")
    samples = render(case["spec"])
    assert (
        q.signal_gate(samples, 16000, ScoringProfile(gate_min_loud_dbfs=-90.0)).gate != q.TOO_QUIET
    )


def test_the_signal_gate_never_divides_by_zero_or_raises_on_silence():
    got = q.signal_gate([0.0] * 16000, 16000)
    assert got.gate == q.TOO_QUIET and got.loud_dbfs is not None and math.isfinite(got.loud_dbfs)
    assert q.signal_gate([], 16000).gate == q.TOO_SHORT


@pytest.mark.parametrize("case", V["posteriors"], ids=lambda c: c["name"])
def test_posterior_gate_matches_vectors(case):
    post = Posteriors(("<b>", "A", "B", "C", "D"), case["logp"])
    got = q.posterior_gate(post, case["expected_ms"], ScoringProfile(**case.get("profile", {})))
    assert got.gate == case["expect"]["gate"] and got.ok == case["expect"]["ok"]
    for key in ("speech_share", "entropy_share"):
        want = case["expect"][key]
        assert (got.__dict__[key] is None) == (want is None)
        if want is not None:
            assert got.__dict__[key] == pytest.approx(want, abs=1e-9)


def test_the_entropy_gate_only_fires_when_the_profile_allows_it():
    muddy = by_name(V["posteriors"], "confused")
    assert muddy["expect"]["gate"] == q.BACKGROUND_SOUND
    assert by_name(V["posteriors"], "confused_default_profile")["expect"]["gate"] is None


def test_peaky_ctc_reads_are_not_called_too_short():
    case = by_name(V["posteriors"], "full_read")
    assert (
        case["expect"]["gate"] is None
    )  # half the frames are blank between phones: the span, not the count


def test_expected_speech_ms_follows_the_reference_pace():
    assert q.expected_speech_ms(13, 2) == pytest.approx(6000.0)
    assert q.expected_speech_ms(13, 99) == pytest.approx(6000.0)  # unknown level -> Medium


def test_trimming_keeps_the_read_with_padding_and_ignores_leading_silence():
    case = by_name(V["signals"], "padded_read")
    samples = render(case["spec"])
    start, end = q.speech_bounds(samples, 16000)
    assert [start, end] == case["bounds"]
    lead = int(0.8 * 16000)
    assert lead - 0.2 * 16000 <= start <= lead  # padded by 150 ms, give or take a frame
    assert 0 < end <= len(samples)


def test_a_clip_with_no_clear_speech_is_not_trimmed():
    assert q.speech_bounds([0.0] * 16000, 16000) == (0, 16000)
    assert q.speech_bounds([], 16000) == (0, 0)
