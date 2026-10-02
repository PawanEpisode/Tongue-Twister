import copy
import json
import struct

import pytest

import make_synthetic_gold as gen
from gold import GoldError, decode_posteriors, encode_posteriors, load, parse_clip

VECTOR = json.loads((__import__("pathlib").Path(__file__).parent.parent / "fixtures" / "f16_vector.json").read_text())


def one() -> dict:
    return copy.deepcopy(gen.build(1, 1)[2])  # a swap clip


def test_posteriors_round_trip_within_half_precision():
    rows = [[-0.0001, -3.2, -12.5], [-0.7, -0.7, -0.7]]
    back = decode_posteriors(encode_posteriors(rows), 2, 3)
    for a, b in zip(rows, back, strict=True):
        for x, y in zip(a, b, strict=True):
            assert abs(x - y) <= max(abs(x) * 1e-3, 1e-3)


def test_encoding_matches_the_shared_vector_the_web_page_must_reproduce():
    # web/src/lib/calibrate/clip.test.ts pins the same file: both ends must write identical bytes
    assert encode_posteriors([VECTOR["values"]]) == VECTOR["base64"]
    assert list(struct.unpack(f"<{len(VECTOR['values'])}e", __import__("base64").b64decode(VECTOR["base64"]))) == VECTOR["decoded"]


def test_extreme_values_are_clamped_not_lost_to_inf():
    back = decode_posteriors(encode_posteriors([[-1e9, 5.0]]), 1, 2)[0]
    assert back == [-60.0, 0.0]


def test_a_good_clip_parses_with_its_labels():
    c = parse_clip(one())
    assert c.scenario == "swap" and c.swap_word is not None and c.synthetic
    assert c.vocab[0] == "<b>" and len(c.logp) == c.duration_ms // 20
    assert not c.clean


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda d: d.update(schema=2), "schema"),
        (lambda d: d.update(consent=False), "consent"),
        (lambda d: d.pop("consent"), "consent"),
        (lambda d: d["speaker"].update(accent="fr-FR"), "accent"),
        (lambda d: d["speaker"].update(age_band="9"), "age band"),
        (lambda d: d["speaker"].update(device_class="toaster"), "device class"),
        (lambda d: d.update(scenario="shout"), "scenario"),
        (lambda d: d.update(swap_word=None), "swap_word"),
        (lambda d: d.update(swap_word=99), "swap_word"),
        (lambda d: d["twister"]["words"].clear(), "no words"),
        (lambda d: d["twister"]["words"][0].update(variants=[]), "pronunciation"),
        (lambda d: d["posteriors"].update(vocab=["S", "SH"]), "blank"),
        (lambda d: d["posteriors"].update(frames=1), "values"),
        (lambda d: d["posteriors"].update(logp_f16="!!"), ""),
    ],
)
def test_bad_clips_are_refused_with_a_reason(mutate, message):
    d = one()
    mutate(d)
    with pytest.raises((GoldError, ValueError)) as err:
        parse_clip(d)
    assert message in str(err.value)


def test_only_swap_clips_carry_a_swap_word():
    d = copy.deepcopy(gen.build(1, 1)[0])  # clean
    d["swap_word"] = 0
    with pytest.raises(GoldError, match="only swap"):
        parse_clip(d)


def test_load_reads_directories_and_bundles_and_rejects_duplicates(tmp_path):
    clips = gen.build(1, 1)
    for c in clips[:2]:
        (tmp_path / f"{c['id']}.json").write_text(json.dumps(c))
    (tmp_path / "bundle.json").write_text(json.dumps({"clips": clips[2:]}))
    assert len(load(tmp_path)) == 4
    (tmp_path / "again.json").write_text(json.dumps(clips[0]))
    with pytest.raises(GoldError, match="duplicate"):
        load(tmp_path)


def test_load_errors_name_the_file(tmp_path):
    (tmp_path / "broken.json").write_text("{nope")
    with pytest.raises(GoldError, match="broken.json"):
        load(tmp_path)
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(GoldError, match="no clips"):
        load(empty)
