"""The model benchmark: statistics, gating and the CLI, with a fake session and a fake clock (no onnxruntime
needed), plus one real-onnxruntime run against the tiny test model when the library is installed."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import benchmark as bm

TINY = HERE.parents[2] / "web" / "e2e" / "fixtures" / "tiny-ctc.onnx"


class FakeInput:
    name = "input_values"


class FakeSession:
    """Takes `ms_per_second` of (fake) time per second of audio."""

    def __init__(self, clock: FakeClock, ms_per_second: float):
        self.clock, self.ms_per_second = clock, ms_per_second
        self.calls = 0

    def get_inputs(self):
        return [FakeInput()]

    def run(self, _outputs, feeds):
        samples = feeds["input_values"]
        n = len(samples[0])
        self.calls += 1
        self.clock.advance(n / bm.SAMPLE_RATE * self.ms_per_second / 1000)


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def advance(self, s: float):
        self.t += s


def factory(ms_per_second: float):
    clock = FakeClock()
    sessions: list[FakeSession] = []

    def make(_threads: int):
        clock.advance(0.25)  # a quarter second to "load"
        sessions.append(FakeSession(clock, ms_per_second))
        return sessions[-1]

    return make, clock, sessions


def run_fake(ms_per_second: float, **kw):
    make, clock, sessions = factory(ms_per_second)
    out = bm.measure(
        make,
        threads=kw.pop("threads", 1),
        seconds_list=kw.pop("seconds_list", [1.0, 3.0]),
        runs=kw.pop("runs", 3),
        warmup=kw.pop("warmup", 1),
        to_input=lambda samples: {"input_values": [samples]},
        clock=clock,
    )
    return out, sessions


# --- statistics ---------------------------------------------------------------------------------------


def test_percentile_interpolates_and_handles_one_value():
    assert bm.percentile([5.0], 95) == 5.0
    assert bm.percentile([1, 2, 3, 4], 50) == 2.5
    assert bm.percentile([1, 2, 3, 4, 100], 95) == pytest.approx(80.8)


def test_summarise_reports_per_second_cost_and_realtime_factor():
    row = bm.summarise(5.0, [900.0, 1000.0, 1100.0])
    assert row["median_ms"] == 1000.0 and row["worst_ms"] == 1100.0
    assert row["per_second_ms"] == 200.0 and row["realtime_factor"] == 0.2


def test_the_synthetic_clip_is_deterministic_speechlike_and_the_right_length():
    a, b = bm.synthetic_clip(1.0), bm.synthetic_clip(1.0)
    assert a == b and len(a) == bm.SAMPLE_RATE
    assert max(abs(x) for x in a) > 0.1 and min(abs(x) for x in a) < 0.01  # bursts over a quiet floor


def test_normalise_gives_zero_mean_unit_variance():
    out = bm.normalise(bm.synthetic_clip(0.5))
    mean = sum(out) / len(out)
    var = sum((x - mean) ** 2 for x in out) / len(out)
    assert abs(mean) < 1e-6 and var == pytest.approx(1.0, abs=1e-3)


# --- measuring ------------------------------------------------------------------------------------------


def test_load_time_warmup_and_timed_runs_are_separate():
    out, sessions = run_fake(100.0)
    assert out["load_ms"] == 250.0
    assert sessions[0].calls == 2 * (1 + 3)  # two clip lengths x (1 warm-up + 3 timed)
    one, three = out["rows"]
    assert one["median_ms"] == pytest.approx(100.0, abs=1) and three["median_ms"] == pytest.approx(300.0, abs=1)
    assert one["per_second_ms"] == pytest.approx(three["per_second_ms"], abs=1)


def test_fifteen_seconds_is_estimated_from_the_per_second_cost_when_not_measured():
    out, _ = run_fake(100.0)
    est = out["estimate_15s"]
    assert est["measured"] is False and est["median_ms"] == pytest.approx(1500.0, rel=0.02)


def test_fifteen_seconds_is_used_directly_when_it_was_measured():
    out, _ = run_fake(100.0, seconds_list=[3.0, 15.0], runs=2)
    assert out["estimate_15s"]["measured"] is True
    assert out["estimate_15s"]["median_ms"] == out["rows"][1]["median_ms"]


@pytest.mark.parametrize(
    ("ms_per_second", "median_ok", "worst_ok"),
    [(100.0, True, True), (250.0, False, True), (600.0, False, False)],
)
def test_the_exit_gate_is_3s_median_and_8s_worst_per_15s(ms_per_second, median_ok, worst_ok):
    out, _ = run_fake(ms_per_second, seconds_list=[15.0], runs=2)
    assert out["gate"] == {"median_ok": median_ok, "worst_ok": worst_ok}


def test_every_thread_count_is_measured_with_its_own_session():
    make, clock, _ = factory(100.0)
    seen = []
    report = bm.run(
        Path(__file__),  # any real file: only its size and hash are read
        threads=[1, 4],
        seconds=[1.0],
        runs=1,
        warmup=0,
        make_session=lambda t: (seen.append(t), make(t))[1],
        clock=clock,
    )
    assert seen == [1, 1, 4]  # one probe for the input name, then one session per thread count
    assert [r["threads"] for r in report["results"]] == [1, 4]
    assert report["model"]["size_bytes"] > 0 and len(report["model"]["sha256"]) == 64
    assert report["input"] == "input_values" and report["peak_rss_mb"] > 0


def test_a_model_with_several_inputs_is_refused():
    class Two:
        def get_inputs(self):
            return [FakeInput(), FakeInput()]

    with pytest.raises(SystemExit):
        bm.run(Path(__file__), threads=[1], seconds=[1.0], runs=1, warmup=0, make_session=lambda _t: Two())


# --- report and CLI ---------------------------------------------------------------------------------------


def report_for(ms_per_second: float):
    make, clock, _ = factory(ms_per_second)
    return bm.run(
        Path(__file__), threads=[1], seconds=[3.0, 15.0], runs=1, warmup=0, make_session=make, clock=clock
    )


def test_the_table_names_the_model_the_gate_and_the_browser_caveat():
    text = bm.render(report_for(100.0))
    assert "test_benchmark.py" in text and "15 s clip (measured)" in text and "[ok <= 3000]" in text
    assert "2-4x slower" in text
    assert "[FAIL <= 3000]" in bm.render(report_for(400.0))


def test_passes_requires_every_thread_count_to_pass():
    assert bm.passes(report_for(100.0)) is True
    assert bm.passes(report_for(400.0)) is False


@pytest.mark.parametrize("bad", ["", "0", "-1", "a"])
def test_argument_parsers_reject_nonsense(bad):
    with pytest.raises((Exception,)):
        bm.parse_ints(bad)


def test_argument_parsers_accept_lists():
    assert bm.parse_ints("1, 2,4") == [1, 2, 4] and bm.parse_floats("3,8.5") == [3.0, 8.5]


def test_the_cli_rejects_a_missing_file_and_bad_counts(tmp_path, capsys):
    with pytest.raises(SystemExit):
        bm.main([str(tmp_path / "nope.onnx")])
    model = tmp_path / "m.onnx"
    model.write_bytes(b"x")
    with pytest.raises(SystemExit):
        bm.main([str(model), "--runs", "0"])


# --- real onnxruntime (skipped where it is not installed) -----------------------------------------------


@pytest.mark.skipif(not TINY.exists(), reason="tiny test model not present")
def test_a_real_onnxruntime_run_over_the_tiny_model(tmp_path, capsys):
    pytest.importorskip("onnxruntime")
    pytest.importorskip("numpy")
    out = tmp_path / "bench.json"
    code = bm.main([str(TINY), "--threads", "1", "--seconds", "1,3", "--runs", "2", "--json", str(out), "--check"])
    assert code == 0  # a four-class conv is far inside the gate
    data = json.loads(out.read_text())
    assert data["input"] == "input_values" and data["results"][0]["rows"][1]["seconds"] == 3.0
    assert data["environment"]["onnxruntime"] and "15 s clip" in capsys.readouterr().out
