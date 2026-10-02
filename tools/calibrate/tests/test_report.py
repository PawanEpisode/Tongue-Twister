import json
from dataclasses import replace

import pytest

import fairness
import make_synthetic_gold as gen
import report
from evaluate import ClipResult, WordOutcome, load_profile, profile_from, score_clip
from gold import parse_clip


def results(speakers=6, twisters=5, synthetic=False, profile=None):
    clips = []
    for d in gen.build(speakers, twisters):
        d = dict(d, synthetic=synthetic)
        clips.append(parse_clip(d))
    return [score_clip(c, profile) if profile else score_clip(c) for c in clips]


def with_latency(rs, per_second_ms):
    """Give every clip a measured latency of `per_second_ms` per second of audio."""
    return [
        ClipResult(
            r.clip.__class__(**{**r.clip.__dict__, "latency_ms": int(r.clip.duration_ms * per_second_ms / 1000)}),
            r.unscorable,
            r.score,
            r.words,
            r.confusions,
        )
        for r in rs
    ]


@pytest.fixture(scope="module")
def full():
    return results()


def test_scripted_swaps_are_caught_and_clean_reads_are_not_accused(full):
    swap = report.swap_recall(full)
    clean = report.clean_reads(full)
    assert swap["clips"] == 30 and swap["recall"] >= 0.9
    assert clean["false_accusation_words"] == 0.0
    assert clean["scored_clips"] == clean["clips"]  # nothing abstained at clip level


def test_accent_variants_are_accepted_for_indian_speakers(full):
    # en-IN speakers realise some phones differently; the expanded variants must keep them from being accused
    en_in = [r for r in full if r.clip.speaker.accent == "en-IN" and r.clip.clean]
    assert en_in and all(not r.accused for r in en_in)


def test_the_confusion_table_names_the_swaps(full):
    pairs = {(c["target"], c["heard"]) for c in report.confusion(full)}
    assert {("S", "SH"), ("P", "B")} & pairs


def test_synthetic_clips_are_never_enough_evidence():
    r = report.build(results(synthetic=True))
    assert r["evidence"]["sufficient"] is False
    assert any("synthetic" in p for p in r["evidence"]["problems"])
    assert r["pass"] is False


def test_too_little_data_is_reported_with_the_reasons(full):
    ev = report.evidence(full)
    assert ev["sufficient"] is False
    text = " ".join(ev["problems"])
    assert "twisters" in text  # 5 per speaker, need 12


def test_a_complete_set_that_meets_every_gate_passes(full, monkeypatch):
    monkeypatch.setattr(report, "MIN_TWISTERS_PER_SPEAKER", 5)
    monkeypatch.setattr(fairness, "MIN_WORDS", 20)
    rep = report.build(full)
    # latency has no data in synthetic clips, so that gate is "n/a" and blocks: say so rather than pass silently
    assert [g["pass"] for g in rep["gates"]].count(None) == 1
    assert rep["pass"] is False
    timed = with_latency(full, 100)  # 0.1 s of compute per second of audio: 1.5 s per 15 s clip
    assert report.build(timed)["pass"] is True


def test_each_gate_fails_on_its_own(full, monkeypatch):
    monkeypatch.setattr(report, "MIN_TWISTERS_PER_SPEAKER", 5)
    monkeypatch.setattr(fairness, "MIN_WORDS", 20)
    timed = with_latency(full, 100)  # 0.1 s of compute per second of audio: 1.5 s per 15 s clip
    assert report.build(timed)["pass"] is True
    # a missed swap
    missed = [
        replace(r, words=[WordOutcome(w.index, "correct", "", False) for w in r.words]) if r.clip.scenario == "swap" else r
        for r in timed
    ]
    rep = report.build(missed)
    assert rep["swap"]["recall"] == 0 and not rep["pass"]
    # accusations on clean reads
    accused = [
        replace(r, words=[WordOutcome(w.index, "wrong", "substituted", False) for w in r.words]) if r.clip.clean else r for r in timed
    ]
    rep = report.build(accused)
    assert rep["clean"]["false_accusation_words"] == 1.0 and not rep["pass"]
    # slow device
    assert not report.build(with_latency(full, 400))["pass"]  # 6 s per 15 s: over the median target
    assert not report.build(with_latency(full, 700))["pass"]  # over the hard ceiling too


def test_fairness_blocks_a_group_that_is_accused_more_and_flags_thin_groups(full, monkeypatch):
    monkeypatch.setattr(fairness, "MIN_WORDS", 20)
    skewed = [
        replace(r, words=[WordOutcome(w.index, "wrong", "substituted", False) if i == 0 else w for i, w in enumerate(r.words)])
        if r.clip.speaker.accent == "en-IN" and r.clip.clean
        else r
        for r in full
    ]
    out = fairness.breakdown(skewed)
    flagged = {(g["dimension"], g["name"]) for g in out["groups"] if g["status"] == "above_limit"}
    assert ("accent", "en-IN") in flagged
    monkeypatch.setattr(fairness, "MIN_WORDS", 100)
    thin = fairness.breakdown(full)  # groups under 100 words are reported as unmeasured, and block
    statuses = {(g["dimension"], g["name"]): g["status"] for g in thin["groups"]}
    assert statuses[("accent", "en-US")] == "insufficient_data" and thin["blocking"]


def test_profile_loading_ignores_junk_and_keeps_defaults():
    p = profile_from({"tau_sub": 2.5, "pad_frames": 9.7, "bogus": 1, "tau_del": "x", "tau_weak": True}, "t")
    assert p.tau_sub == 2.5 and p.pad_frames == 9 and p.tau_del == 3.0 and p.tau_weak == -0.9 and p.name == "t"


def test_cli_writes_reports_and_check_fails_without_evidence(tmp_path, capsys):
    gold = tmp_path / "gold"
    gen.main([str(gold), "--speakers", "2", "--twisters", "2"])
    md, js = tmp_path / "r.md", tmp_path / "r.json"
    code = report.main([str(gold), "--out", str(md), "--json", str(js), "--check"])
    assert code == 1
    assert "Exit gate" in md.read_text() and json.loads(js.read_text())["pass"] is False
    assert report.main([str(gold)]) == 0  # without --check the report is informational
    prof = tmp_path / "p.json"
    prof.write_text(json.dumps({"code": "x", "thresholds": {"tau_sub": 2.0}}))
    assert load_profile(prof).tau_sub == 2.0
