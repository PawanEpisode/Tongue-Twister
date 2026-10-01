"""Words nailed in a drill leave the weak queue for 'nailed'; a later slip brings them back."""

import pytest

from twisters.models import UserWordStat
from twisters.speak import stats

from .speak_helpers import SWAP, submit

API = "/api/v1"


def drill(client, transcript, **over):
    """Drill "sells" (token 1 of the seeded twister)."""
    return submit(
        client, kind="drill", segment={"start": 1, "end": 2}, transcript=transcript, **over
    )


def queue(client, name="weak", **params):
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return client.get(f"{API}/me/words/{name}/?{qs}").data


@pytest.fixture
def weak(user):
    c, profile = user
    for _ in range(2):
        submit(c, transcript=SWAP)  # "sells" said as "shells", twice
    assert [r["word"] for r in queue(c)["results"]] == ["sells"]
    return c, profile


def test_a_drill_pass_moves_the_word_to_nailed(weak):
    c, _ = weak
    assert drill(c, "sells", stt={"confidence": 0.9}).status_code == 201
    assert queue(c)["results"] == [] and queue(c)["count"] == 0
    nailed = queue(c, "nailed")
    assert nailed["count"] == 1 and nailed["results"][0]["word"] == "sells"


def test_a_close_pass_counts(weak):
    c, _ = weak
    drill(c, "cells", stt={"confidence": 0.9})  # a homophone: close
    assert [r["word"] for r in queue(c, "nailed")["results"]] == ["sells"]


def test_a_shaky_pass_does_not(weak):
    c, _ = weak
    drill(c, "sells", stt={"confidence": 0.5})  # heard, but the recogniser was not sure
    assert queue(c, "nailed")["count"] == 0 and queue(c)["count"] == 1


def test_a_miss_in_a_drill_leaves_it_to_work_on(weak):
    c, _ = weak
    drill(c, "shells", stt={"confidence": 0.9})
    assert queue(c, "nailed")["count"] == 0 and queue(c)["count"] == 1


def test_a_test_attempt_never_nails_a_word(weak):
    c, _ = weak
    submit(c, transcript="she sells seashells by the seashore")
    assert queue(c, "nailed")["count"] == 0


def test_a_later_slip_sends_it_back_to_the_queue(weak):
    c, _ = weak
    drill(c, "sells", stt={"confidence": 0.9})
    submit(c, transcript=SWAP)
    assert queue(c, "nailed")["count"] == 0
    assert [r["word"] for r in queue(c)["results"]] == ["sells"]


def test_rebuilding_stats_keeps_nailed_words_nailed(weak):
    c, profile = weak
    drill(c, "sells", stt={"confidence": 0.9})
    before = UserWordStat.objects.get(profile=profile, word_norm="sells").mastered_at
    stats.rebuild_profile_stats(profile)
    after = UserWordStat.objects.get(profile=profile, word_norm="sells").mastered_at
    assert before is not None and after is not None
    assert [r["word"] for r in queue(c, "nailed")["results"]] == ["sells"]


def test_the_queue_pages_and_reports_its_size(user):
    c, profile = user
    for i in range(5):
        UserWordStat.objects.create(
            profile=profile, word_norm=f"word{i}", seen=2, wrong=1, weakness=0.9 - i / 10
        )
    page = queue(c, limit=2, offset=2)
    assert page["count"] == 5
    assert [r["word"] for r in page["results"]] == ["word2", "word3"]
    assert queue(c, limit=2, offset=4)["results"][0]["word"] == "word4"


@pytest.mark.parametrize("offset", ["-1", "x", "10001"])
def test_offsets_are_validated(user, offset):
    c, _ = user
    for name in ("weak", "nailed"):
        assert c.get(f"{API}/me/words/{name}/?offset={offset}").status_code == 400
