"""Migrations, management commands and the rebuild-equals-incremental guarantee."""

import uuid

import pytest
from django.core.management import CommandError, call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

from twisters.models import (
    Attempt,
    ScoringJob,
    Twister,
    UserPhonemeStat,
    UserTwisterStats,
    UserWordStat,
    Verification,
)
from twisters.speak import stats

from .speak_helpers import GOOD, SLUG, SWAP, submit
from .test_speak_trust import device_body, model  # noqa: F401  (model is a fixture)

# --- migrations ----------------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_migration_backfills_public_ids_and_survives_a_round_trip():
    executor = MigrationExecutor(connection)
    executor.migrate([("twisters", "0004_metronome_volume")])
    old = executor.loader.project_state([("twisters", "0004_metronome_volume")]).apps
    profile = old.get_model("twisters", "Profile").objects.create(id=uuid.uuid4(), email="m@x.co")
    twister = old.get_model("twisters", "Twister").objects.create(
        slug="legacy", text="peter piper", difficulty=1
    )
    Old = old.get_model("twisters", "Attempt")
    ids = [
        Old.objects.create(
            profile=profile,
            twister=twister,
            transcript="peter piper",
            accuracy=1,
            wpm=100,
            score=90,
            duration_ms=2000,
        ).pk
        for _ in range(3)
    ]

    executor = MigrationExecutor(connection)
    executor.migrate([("twisters", "0006_enable_speak_v2")])
    new = executor.loader.project_state([("twisters", "0006_enable_speak_v2")]).apps
    rows = list(new.get_model("twisters", "Attempt").objects.filter(pk__in=ids))
    assert len({r.public_id for r in rows}) == 3 and all(r.public_id for r in rows)
    assert all(r.score_version == 1 for r in rows)  # legacy rows keep their original scoring

    executor = MigrationExecutor(connection)
    executor.migrate([("twisters", "0004_metronome_volume")])  # reversible
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())  # leave the schema current for other tests


# --- build_pronunciations -------------------------------------------------------------------------


def test_every_seeded_twister_has_a_pronunciation(seeded):
    call_command("build_pronunciations")
    call_command("build_pronunciations", "--check")
    for twister in Twister.objects.filter(is_published=True):
        assert twister.phonemes and all(twister.phonemes.values())
    first = Twister.objects.get(slug=SLUG)
    version = first.phoneme_version
    call_command("build_pronunciations")  # idempotent: nothing changed, nothing bumped
    first.refresh_from_db()
    assert first.phoneme_version == version


def test_unknown_word_fails_the_build_and_check_writes_nothing(seeded):
    Twister.objects.create(slug="nonsense", text="Qzxwvk flurbs", difficulty=1, is_published=True)
    with pytest.raises(CommandError, match="nonsense"):
        call_command("build_pronunciations", "--check")
    assert Twister.objects.get(slug="nonsense").phonemes == {}


# --- stats: rebuild == incremental ----------------------------------------------------------------


def snapshot(profile):
    words = {
        r.word_norm: (r.seen, r.correct, r.near, r.wrong, r.missed, round(r.weakness, 3))
        for r in UserWordStat.objects.filter(profile=profile)
    }
    phonemes = {
        r.phoneme_pair: (r.occurrences, r.errors)
        for r in UserPhonemeStat.objects.filter(profile=profile)
    }
    t = UserTwisterStats.objects.get(profile=profile, twister__slug=SLUG)
    return words, phonemes, (t.attempts_count, t.test_attempts_count, t.best_test_score)


def test_reconcile_rebuilds_exactly_what_the_incremental_path_built(user, model):  # noqa: F811
    c, profile = user
    submit(c, transcript=SWAP)
    submit(c, transcript=GOOD)
    submit(c, transcript="she sells")
    submit(c, **device_body(transcript=GOOD))
    before = snapshot(profile)
    assert before[0]  # something was recorded

    UserWordStat.objects.all().delete()
    UserPhonemeStat.objects.all().delete()
    UserTwisterStats.objects.all().delete()
    call_command("reconcile_speak_stats")
    assert snapshot(profile) == before
    call_command("reconcile_speak_stats", "--profile", str(profile.pk))
    assert snapshot(profile) == before  # idempotent


def test_flagged_and_deleted_attempts_leave_the_stats(user):
    c, profile = user
    r = submit(c, transcript=SWAP)
    keep = submit(c, transcript=GOOD)
    assert keep.status_code == 201
    assert c.delete(f"/api/v1/attempts/{r.data['id']}/").status_code == 204
    stats.rebuild_profile_stats(profile)
    assert UserWordStat.objects.get(profile=profile, word_norm="sells").wrong == 0
    Attempt.objects.filter(pk=keep.data["id"]).update(flagged=True)  # e.g. a worker disagreement
    stats.rebuild_profile_stats(profile)
    assert not UserWordStat.objects.filter(profile=profile, seen__gt=0).exists()


# --- sweeper --------------------------------------------------------------------------------------


def test_sweeper_gives_up_instead_of_crashing_when_no_model_exists(user, settings):
    c, profile = user
    attempt = Attempt.objects.get(pk=submit(c).data["id"])
    old = timezone.now() - timezone.timedelta(minutes=settings.PENDING_RETRY_AFTER_MIN + 1)
    Attempt.objects.filter(pk=attempt.pk).update(
        verification_status=Verification.PENDING, created_at=old
    )
    call_command("sweep_pending_attempts")
    attempt.refresh_from_db()
    assert attempt.verification_status == Verification.FAILED
    assert not ScoringJob.objects.exists()


# --- accepted variants ----------------------------------------------------------------------------


def test_global_and_per_twister_accepted_variants_both_count(user):
    from twisters.models import TwisterPronunciation

    c, _ = user
    twister = Twister.objects.get(slug=SLUG)
    TwisterPronunciation.objects.create(word="sells", accepted_variants=["cells"])  # global
    TwisterPronunciation.objects.create(
        twister=twister, word="seashore", accepted_variants=["seashores"]
    )
    r = submit(c, transcript="she cells seashells by the seashores", include="words")
    assert r.data["score"] >= 90
    assert {w["status"] for w in r.data["words"]} == {"correct"}
