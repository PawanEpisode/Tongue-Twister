from twister_worker.jobs.captions import build_vtt, escape_cue_text, format_timestamp, run
from twister_worker.models import Word


def w(text, start, end, status="correct"):
    return Word(text, start, end, status)


def cues(vtt: str) -> list[tuple[str, str]]:
    blocks = [b for b in vtt.split("\n\n")[1:] if b.strip()]
    return [tuple(b.strip().split("\n")) for b in blocks]  # type: ignore[misc]


def test_basic_document():
    vtt = build_vtt([w("Peter", 100, 400), w("Piper", 400, 800)], 5000)
    assert vtt == "WEBVTT\n\n00:00:00.100 --> 00:00:00.800\nPeter Piper\n"


def test_nothing_to_caption():
    assert build_vtt(None) is None
    assert build_vtt([]) is None
    assert build_vtt([w("  ", 0, 10)]) is None
    assert build_vtt([w("a", None, None), w("b", None, None)]) is None


def test_timestamp_format():
    assert format_timestamp(3_723_456) == "01:02:03.456"
    assert format_timestamp(-5) == "00:00:00.000"


def test_zero_length_word_gets_minimum_duration():
    vtt = build_vtt([w("a", 500, 500), w("b", 2000, 2400)], 10_000)
    assert "00:00:00.500 --> 00:00:00.620\na" in vtt  # minimum 120 ms; the 1.4 s gap splits the cue


def test_overlaps_are_trimmed_and_monotonic():
    vtt = build_vtt([w("a", 0, 900), w("b", 500, 1200), w("c", 400, 800)], 10_000)
    (start, end), text = vtt.split("\n")[2].split(" --> "), vtt.split("\n")[3]
    assert start == "00:00:00.000" and text == "a b c"
    assert end >= start


def test_missing_timings_are_interpolated_between_neighbours():
    words = [w("one", 0, 500), w("two", None, None), w("three", None, None), w("four", 1500, 2000)]
    vtt = build_vtt(words, 10_000)
    assert "one two three four" in vtt and "00:00:00.000 --> 00:00:02.000" in vtt


def test_leading_and_trailing_untimed_words_are_kept():
    vtt = build_vtt([w("x", None, None), w("y", 1000, 1500), w("z", None, None)], 10_000)
    assert vtt is not None and "x y z" in vtt.replace("\n", " ")
    assert vtt.startswith("WEBVTT")


def test_one_sided_timing_is_used():
    vtt = build_vtt([w("a", 1000, None), w("b", None, 2000)], 10_000)
    assert vtt is not None and "a b" in vtt


def test_clamped_to_duration():
    vtt = build_vtt([w("a", 0, 500), w("b", 900, 5000), w("c", 6000, 7000)], 1000)
    assert "00:00:01.000" in vtt and "00:00:05" not in vtt and "c" not in vtt


def test_cue_split_on_word_count_gap_and_sentence_end():
    many = [w(f"w{i}", i * 300, i * 300 + 250) for i in range(9)]
    assert len(cues(build_vtt(many, None))) == 2
    gap = [w("a", 0, 200), w("b", 5000, 5200)]
    assert len(cues(build_vtt(gap, None))) == 2
    sentence = [w("Hi.", 0, 200), w("There", 250, 500)]
    assert len(cues(build_vtt(sentence, None))) == 2


def test_escaping_and_whitespace():
    assert escape_cue_text("a <b> & c\n d --> e") == "a &lt;b&gt; &amp; c d --&gt; e"
    vtt = build_vtt([w("<i>Hi</i>", 0, 300), w("a\n\nb", 300, 600)], None)
    assert "&lt;i&gt;Hi&lt;/i&gt; a b" in vtt
    assert "<i>" not in vtt


def test_empty_cue_blocks_never_contain_blank_lines():
    vtt = build_vtt([w("a\n\nb", 0, 300)], None)
    body = vtt.split("\n\n")
    assert body[1] == "00:00:00.000 --> 00:00:00.300\na b\n"  # no blank line inside a cue


def test_unicode_survives(tmp_path):
    dest = tmp_path / "c.vtt"
    assert run([w("café", 0, 400)], None, dest) is True
    assert "café" in dest.read_text(encoding="utf-8")
    assert run([], None, tmp_path / "none.vtt") is False
    assert not (tmp_path / "none.vtt").exists()
