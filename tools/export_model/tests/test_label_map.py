from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_model as em  # noqa: E402
import label_map as lm  # noqa: E402

# A representative slice of the espeak-IPA vocabulary of facebook/wav2vec2-lv-60-espeak-cv-ft (the real file
# is ~390 labels; HF is not reachable from CI, so this stand-in exercises every rule family).
ESPEAK = [
    "<pad>", "<s>", "</s>", "<unk>", "|",
    "p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "m", "n", "ŋ", "l", "ɹ", "j", "w",
    "tʃ", "dʒ", "ɾ", "ʔ", "ɫ", "ɚ", "ə", "ɐ", "ɜː", "ɜ",
    "i", "iː", "ɪ", "e", "ɛ", "æ", "a", "ɑ", "ɑː", "ɒ", "ɔ", "ɔː", "o", "ʊ", "u", "uː", "ʌ",
    "aɪ", "aʊ", "eɪ", "oʊ", "əʊ", "ɔɪ", "ɪə", "ʊə", "eə", "ˈ", "ˌ", "t͡ʃ", "ã", "pʰ", "ʲ",
]  # fmt: skip
VOCAB = {label: i for i, label in enumerate(dict.fromkeys(ESPEAK))}


def test_normalise_strips_marks_and_keeps_the_phone():
    assert lm.normalise("ˈaɪ") == "aɪ"
    assert lm.normalise("t͡ʃ") == "tʃ"
    assert lm.normalise("ã") == "a"
    assert lm.normalise("iː") == "i"
    assert lm.normalise("pʰ") == "p"
    assert lm.normalise("ˈ") == ""


def test_the_shipped_rules_are_internally_consistent():
    rules = lm.load_rules()
    assert rules["classes"][0] == "<b>" and "DX" in rules["classes"]
    assert set(rules["map"].values()) <= set(rules["classes"])
    assert not set(rules["map"]) & set(rules["drop"])


def test_a_realistic_vocab_maps_completely_and_covers_every_class():
    built = lm.build(VOCAB, version="lm1")
    assert lm.check(built, VOCAB) == []
    assert built["map"]["ʃ"] == "SH" and built["map"]["ɾ"] == "DX" and built["map"]["ɜː"] == "ER"
    assert built["map"]["t͡ʃ"] == "CH" and built["map"]["aɪ"] == "AY" and built["map"]["ã"] == "AE"
    assert "ʔ" in built["drop"] and "|" in built["drop"] and "ˈ" in built["drop"] and "ɪə" in built["drop"]
    assert "<pad>" not in built["map"] and built["blank"] == "<pad>"
    assert built["vocab"][0] == "<pad>" and len(built["vocab"]) == len(VOCAB)
    assert set(built["map"].values()) >= set(built["classes"][1:]) - {"DX"}


def test_the_flap_is_its_own_class_not_r():
    built = lm.build(VOCAB, version="lm1")
    assert built["map"]["ɾ"] == "DX" and built["map"]["ɹ"] == "R"  # D40


def test_an_unknown_label_stops_the_build_and_names_it():
    vocab = {**VOCAB, "ǃ": len(VOCAB)}
    with pytest.raises(lm.LabelMapError, match="ǃ"):
        lm.build(vocab, version="lm1")


def test_overrides_resolve_unknown_labels_and_are_validated():
    vocab = {**VOCAB, "ǃ": len(VOCAB), "ǀ": len(VOCAB) + 1}
    built = lm.build(vocab, version="lm1", overrides={"map": {"ǃ": "K"}, "drop": ["ǀ"]})
    assert built["map"]["ǃ"] == "K" and "ǀ" in built["drop"]
    with pytest.raises(lm.LabelMapError, match="unknown classes"):
        lm.build(VOCAB, version="lm1", overrides={"map": {"p": "NOPE"}})


def test_overrides_win_over_rules_and_change_the_provenance_hash():
    base = lm.build(VOCAB, version="lm1")
    changed = lm.build(VOCAB, version="lm1", overrides={"map": {"ɾ": "T"}})
    assert changed["map"]["ɾ"] == "T"
    assert base["sources"]["rules_sha256"] != changed["sources"]["rules_sha256"]


def test_a_vocab_that_cannot_reach_a_sound_is_refused():
    tiny = {"<pad>": 0, "a": 1, "b": 2}
    with pytest.raises(lm.LabelMapError, match="could never be heard"):
        lm.build(tiny, version="lm1")
    assert lm.build(tiny, version="lm1", require_coverage=False)["map"] == {"a": "AE", "b": "B"}


def test_vocab_ids_must_be_contiguous_and_the_blank_present():
    with pytest.raises(lm.LabelMapError, match="0..n-1"):
        lm.build({"<pad>": 0, "a": 2}, version="lm1", require_coverage=False)
    with pytest.raises(lm.LabelMapError, match="blank"):
        lm.build({"a": 0, "b": 1}, version="lm1", require_coverage=False)


def test_check_detects_a_map_that_belongs_to_another_vocab():
    built = lm.build(VOCAB, version="lm1")
    other = {**VOCAB}
    other["p"], other["b"] = other["b"], other["p"]
    assert lm.check(built, other)
    broken = json.loads(json.dumps(built))
    broken["map"]["p"] = "QQ"
    assert any("not in classes" in p for p in lm.check(broken, VOCAB))


def test_cli_round_trip(tmp_path, capsys):
    (tmp_path / "vocab.json").write_text(json.dumps(VOCAB, ensure_ascii=False), "utf-8")
    out = tmp_path / "label_map.json"
    assert lm.main(["--vocab", str(tmp_path / "vocab.json"), "--out", str(out), "--version", "lm7"]) == 0
    assert json.loads(out.read_text("utf-8"))["version"] == "lm7"
    assert lm.main(["--check", str(tmp_path)]) == 0
    (tmp_path / "vocab.json").write_text(json.dumps({**VOCAB, "zz": 999}), "utf-8")
    assert lm.main(["--check", str(tmp_path)]) == 1
    (tmp_path / "vocab.json").write_text(json.dumps({**VOCAB, "ǃ": len(VOCAB)}, ensure_ascii=False), "utf-8")
    assert lm.main(["--vocab", str(tmp_path / "vocab.json"), "--out", str(out)]) == 1
    assert "ǃ" in capsys.readouterr().err


def test_export_writes_lists_and_verifies_the_label_map(tmp_path):
    opts = em.Options(out=tmp_path / "out", size_range_mb=(0.0001, 1.0), label_map_version="lm1")
    manifest = em.run_export(opts, em.FakeBackend())
    out_dir = opts.out_dir
    assert (out_dir / "label_map.json").is_file()
    assert manifest["label_map"]["version"] == "lm1" == manifest["model"]["label_map_version"]
    assert {f["role"] for f in manifest["files"]} >= {"model", "vocab", "label_map"}
    assert em.verify_directory(out_dir) == []
    (out_dir / "label_map.json").write_text("{}", "utf-8")
    assert em.verify_directory(out_dir)  # checksum and consistency both fail


def test_export_stops_on_an_unmappable_vocab(tmp_path):
    class Odd(em.FakeBackend):
        def prepare(self, model_id, revision):
            info = super().prepare(model_id, revision)
            info.vocab = {**info.vocab, "ǃ": len(info.vocab)}
            return info

        def __init__(self):
            super().__init__(vocab_size=9)

    opts = em.Options(out=tmp_path / "out", size_range_mb=(0.0001, 1.0))
    with pytest.raises(em.ExportError, match="label map"):
        em.run_export(opts, Odd())
    assert not opts.out_dir.exists()
