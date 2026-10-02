from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_model as em  # noqa: E402


def opts(tmp_path: Path, **kw) -> em.Options:
    base = {"out": tmp_path / "out", "size_range_mb": (0.0001, 1.0)}
    base.update(kw)
    return em.Options(**base)


def test_sha256_and_names(tmp_path):
    f = tmp_path / "a"
    f.write_bytes(b"abc")
    assert em.sha256_file(f) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    assert em.make_name("w2v-espeak-lv60", "int8", 1) == "w2v-espeak-lv60-int8-r1"


def test_expected_frames_matches_wav2vec2_stride():
    assert em.expected_frames(32_000) == 99


def test_check_size_window():
    assert em.check_size("int8", 300 * em.MB, (200, 500)) == []
    assert em.check_size("int8", 10 * em.MB, (200, 500))
    assert em.check_size("fp32", 0, (900, 1600)) == ["model file is empty"]


def test_check_vocab_and_inference():
    vocab = {"a": 0, "b": 1}
    assert em.check_vocab(vocab, 2) == []
    assert em.check_vocab(vocab, 3)  # count mismatch
    assert em.check_vocab({"a": 0, "b": 0}, 2)  # duplicate ids
    assert em.check_vocab({}, 2)
    n = 32_000
    good = em.Inference(99, 2, True, [0] * 99)
    assert em.check_inference(good, n, vocab) == []
    assert em.check_inference(em.Inference(50, 2, True, []), n, vocab)
    assert em.check_inference(em.Inference(99, 2, False, []), n, vocab)


def test_agreement():
    assert em.agreement([1, 2, 3], [1, 2, 4]) == pytest.approx(2 / 3)
    assert em.agreement([], []) == 0.0


@pytest.mark.parametrize(
    "kw",
    [
        {"label_map_version": "x" * 21},
        {"release": 0},
        {"base_url": "http://x/y"},
        {"base_url": "https://huggingface.co/x"},
        {"size_range_mb": (5, 1)},
        {"opset": 11},
        {"name_prefix": "bad name"},
    ],
)
def test_validate_options_rejects(tmp_path, kw):
    assert em.validate_options(opts(tmp_path, **kw))


def test_validate_options_ok(tmp_path):
    assert em.validate_options(opts(tmp_path, base_url="https://cdn.example.com/models")) == []


def test_full_fake_export_int8(tmp_path):
    o = opts(tmp_path, base_url="https://cdn.example.com/models/", label_map_version="lm1")
    manifest = em.run_export(o, em.FakeBackend(), log=lambda *_: None)
    out = o.out_dir
    assert sorted(p.name for p in out.iterdir()) == [
        "SHA256SUMS",
        "label_map.json",
        "manifest.json",
        "vocab.json",
        "w2v-espeak-lv60-int8-r1.onnx",
    ]
    model = manifest["model"]
    assert set(em.MODEL_KEYS) <= set(model)
    assert model["quantization"] == "int8"
    assert model["download_url"] == "https://cdn.example.com/models/w2v-espeak-lv60-int8-r1/w2v-espeak-lv60-int8-r1.onnx"
    assert model["sha256"] == em.sha256_file(out / "w2v-espeak-lv60-int8-r1.onnx")
    assert json.loads((out / "manifest.json").read_text())["model"] == model
    assert manifest["export"]["checks"]["int8"]["ratio_to_fp32"] < 0.5
    assert em.verify_directory(out) == []
    # sha256sum -c format
    line = (out / "SHA256SUMS").read_text().splitlines()[0]
    assert line == f"{model['sha256']}  w2v-espeak-lv60-int8-r1.onnx"
    assert not list(o.out.glob(".export-*"))  # temp dir cleaned


def test_fp32_only_and_keep_fp32(tmp_path):
    m = em.run_export(opts(tmp_path, quantize="none"), em.FakeBackend(), log=lambda *_: None)
    assert m["model"]["quantization"] == "fp32" and m["model"]["name"].endswith("fp32-r1")
    o = opts(tmp_path, keep_fp32=True, release=2)
    m = em.run_export(o, em.FakeBackend(), log=lambda *_: None)
    assert [f["role"] for f in m["files"]] == ["model", "vocab", "label_map", "fp32-intermediate"]
    assert (o.out_dir / "w2v-espeak-lv60-fp32-r2.onnx").exists()


def test_refuses_existing_output_without_force(tmp_path):
    o = opts(tmp_path)
    em.run_export(o, em.FakeBackend(), log=lambda *_: None)
    with pytest.raises(em.ExportError, match="not empty"):
        em.run_export(o, em.FakeBackend(), log=lambda *_: None)
    o.force = True
    em.run_export(o, em.FakeBackend(), log=lambda *_: None)


def test_quantisation_that_does_not_shrink_fails_and_leaves_nothing(tmp_path):
    o = opts(tmp_path)
    with pytest.raises(em.ExportError, match="quantisation probably did not apply"):
        em.run_export(o, em.FakeBackend(int8_ratio=0.9), log=lambda *_: None)
    assert not o.out_dir.exists()
    assert not list(o.out.glob(".export-*"))


def test_wrong_size_fails(tmp_path):
    with pytest.raises(em.ExportError, match="outside the expected"):
        em.run_export(opts(tmp_path, size_range_mb=(500, 900)), em.FakeBackend(), log=lambda *_: None)


def test_vocab_mismatch_fails(tmp_path):
    class Bad(em.FakeBackend):
        def infer(self, path, samples):
            inf = super().infer(path, samples)
            inf.vocab_size += 5
            return inf

    with pytest.raises(em.ExportError, match="vocab"):
        em.run_export(opts(tmp_path), Bad(), log=lambda *_: None)


def test_external_data_refused(tmp_path):
    class Split(em.FakeBackend):
        def export_fp32(self, dest, opset):
            super().export_fp32(dest, opset)
            (dest.parent / "model.onnx_data").write_bytes(b"x")

    with pytest.raises(em.ExportError, match="external-data"):
        em.run_export(opts(tmp_path), Split(), log=lambda *_: None)


def test_missing_dependencies_reported(tmp_path):
    class NoDeps(em.FakeBackend):
        def missing_dependencies(self):
            return ["torch"]

    with pytest.raises(em.ExportError, match="pip install"):
        em.run_export(opts(tmp_path), NoDeps(), log=lambda *_: None)


def test_verify_detects_tampering(tmp_path):
    o = opts(tmp_path)
    em.run_export(o, em.FakeBackend(), log=lambda *_: None)
    model = o.out_dir / "w2v-espeak-lv60-int8-r1.onnx"
    model.write_bytes(model.read_bytes()[:-1] + b"\x01")
    assert any("checksum" in p for p in em.verify_directory(o.out_dir))
    model.unlink()
    assert any("missing" in p for p in em.verify_directory(o.out_dir))
    assert em.verify_directory(tmp_path / "nope")


def test_validate_manifest_catches_bad_fields():
    assert em.validate_manifest({})
    good = {
        "schema": 1,
        "model": {k: "x" for k in em.MODEL_KEYS} | {"quantization": "int8", "sha256": "a" * 64, "name": "n", "size_bytes": 1},
        "files": [{"role": "model", "sha256": "a" * 64, "size_bytes": 1}],
    }
    assert em.validate_manifest(good) == []
    good["model"]["sha256"] = "zz"
    assert em.validate_manifest(good)


def test_cli_dry_run_writes_nothing(tmp_path, capsys):
    out = tmp_path / "o"
    rc = em.main(["--dry-run", "--backend", "fake", "--out", str(out)])
    text = capsys.readouterr().out
    assert rc == 0 and "DRY RUN" in text and "w2v-espeak-lv60-int8-r1" in text and "OK" in text
    assert not out.exists()


def test_cli_dry_run_hf_without_packages_does_not_import_them(tmp_path, capsys):
    rc = em.main(["--dry-run", "--out", str(tmp_path / "o")])  # real backend, but dry
    text = capsys.readouterr().out
    assert rc == 0 and "packages:" in text and "--hf-revision" in text


def test_cli_dry_run_flags_problems(tmp_path, capsys):
    rc = em.main(["--dry-run", "--backend", "fake", "--out", str(tmp_path), "--base-url", "http://x"])
    assert rc == 1 and "PROBLEM" in capsys.readouterr().out


def test_cli_export_and_verify(tmp_path, capsys):
    out = str(tmp_path / "o")
    assert em.main(["--backend", "fake", "--out", out]) == 0
    assert "sha256" in capsys.readouterr().out
    assert em.main(["--verify", str(Path(out) / "w2v-espeak-lv60-int8-r1")]) == 0
    assert em.main(["--backend", "fake", "--out", out]) == 1  # exists
    assert "not empty" in capsys.readouterr().err


def test_synthetic_samples_deterministic():
    a = em.synthetic_samples(0.1)
    assert a == em.synthetic_samples(0.1) and len(a) == 1600
