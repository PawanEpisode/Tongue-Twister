import json

import make_synthetic_gold as gen
import tune_thresholds as tune
from gold import parse_clip


def clips(synthetic=True):
    return [parse_clip(dict(d, synthetic=synthetic)) for d in gen.build(4, 3)]


def test_tuning_never_makes_the_objective_worse():
    cs = clips()
    start = tune.DEFAULT_PROFILE
    before = tune.measure(cs, start)
    best, after, trail = tune.tune(cs, start, cap=0.04)
    assert tune.key(after, 0.04) >= tune.key(before, 0.04)
    assert after["false_accusation"] <= 0.04
    assert trail[0][0] == "start"


def test_precision_comes_first_when_the_cap_cannot_be_met():
    cs = clips()
    # an impossible cap: any accusation is too many, so the tuner must still pick the least-accusing setting
    best, after, _ = tune.tune(cs, tune.DEFAULT_PROFILE, cap=-1.0)
    assert after["false_accusation"] <= tune.measure(cs, tune.DEFAULT_PROFILE)["false_accusation"]


def test_a_too_eager_profile_is_pulled_back_within_the_cap(monkeypatch):
    from dataclasses import replace

    # noisy speakers make a trigger-happy profile accuse correct reads (the default stays quiet)
    monkeypatch.setattr(gen, "SPEAKERS", [(*s[:5], 2.0) for s in gen.SPEAKERS])
    eager = replace(tune.DEFAULT_PROFILE, tau_sub=0.2, tau_del=0.2, tau_uncertain=0.1)
    cs = clips()
    before = tune.measure(cs, eager)
    _best, after, _ = tune.tune(cs, eager, cap=0.04)
    assert before["false_accusation"] > 0.04 >= after["false_accusation"]


def test_cli_refuses_synthetic_clips_and_writes_a_profile_otherwise(tmp_path, capsys):
    gold = tmp_path / "g"
    gen.main([str(gold), "--speakers", "2", "--twisters", "2"])
    assert tune.main([str(gold)]) == 2
    out = tmp_path / "profile.json"
    assert tune.main([str(gold), "--allow-synthetic", "--out", str(out)]) == 0
    data = json.loads(out.read_text())
    assert set(data["thresholds"]) == set(tune.GRID) and data["code"] == "sp-tuned"
