"""The 06c migrations on real data: FK conversion keeps every id, and everything reverses."""

import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

BEFORE = ("twisters", "0006_enable_speak_v2")


def migrate(*targets):
    executor = MigrationExecutor(connection)
    executor.migrate(list(targets))
    return executor.loader.project_state(list(targets)).apps


def latest():
    return [
        key
        for key in MigrationExecutor(connection).loader.graph.leaf_nodes()
        if key[0] == "twisters"
    ]


@pytest.fixture
def at_0006():
    """Roll back to before 06c, hand the test the old schema, then always return to the latest."""
    yield migrate(BEFORE)
    migrate(*latest())


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_asset_ids_survive_the_foreign_key_conversion_both_ways(at_0006):
    old = at_0006
    Profile, Twister, Attempt = (
        old.get_model("twisters", n) for n in ("Profile", "Twister", "Attempt")
    )
    Model, Job = (
        old.get_model("twisters", "AcousticModelVersion"),
        old.get_model("twisters", "ScoringJob"),
    )
    profile = Profile.objects.create(id=uuid.uuid4(), plan_id="free")
    twister = Twister.objects.create(slug="t", text="a b c")
    voice_id, audio_id = uuid.uuid4(), uuid.uuid4()
    attempt = Attempt.objects.create(
        profile=profile,
        twister=twister,
        accuracy=1,
        duration_ms=1000,
        wpm=100,
        score=90,
        voice_asset_id=voice_id,
    )
    model = Model.objects.create(
        name="m",
        base_model="b",
        licence="l",
        quantization="int8",
        size_bytes=1,
        sha256="0" * 64,
        label_map_version="1",
    )
    job = Job.objects.create(
        attempt=attempt, kind="spot_check", model_version=model, audio_asset_id=audio_id
    )
    untouched = Attempt.objects.create(
        profile=profile, twister=twister, accuracy=1, duration_ms=1000, wpm=100, score=80
    )

    new = migrate(*latest())
    Attempt2, Job2, Asset = (
        new.get_model("twisters", n) for n in ("Attempt", "ScoringJob", "MediaAsset")
    )
    assert Attempt2.objects.get(pk=attempt.pk).voice_asset_id == voice_id
    assert Job2.objects.get(pk=job.pk).audio_asset_id == audio_id
    assert Attempt2.objects.get(pk=untouched.pk).voice_asset_id is None
    tomb = Asset.objects.get(pk=voice_id)
    assert tomb.status == "deleted" and tomb.kind == "audio" and tomb.profile_id == profile.pk
    assert Asset.objects.get(pk=audio_id).profile_id == profile.pk
    columns = {
        c.name
        for c in connection.introspection.get_table_description(
            connection.cursor(), "twisters_attempt"
        )
    }
    assert "voice_asset_id" in columns

    old_again = migrate(BEFORE)
    assert (
        old_again.get_model("twisters", "Attempt").objects.get(pk=attempt.pk).voice_asset_id
        == voice_id
    )
    assert (
        old_again.get_model("twisters", "ScoringJob").objects.get(pk=job.pk).audio_asset_id
        == audio_id
    )
    assert "MediaAsset" not in {m.__name__ for m in old_again.get_models()}


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_flags_and_plan_limits_are_seeded_and_reversible(at_0006):
    old = at_0006
    Flag = old.get_model("twisters", "FeatureFlag")
    assert not Flag.objects.get(code="record_local").enabled

    new = migrate(*latest())
    flags = {f.code: f.enabled for f in new.get_model("twisters", "FeatureFlag").objects.all()}
    assert flags["record_local"] and flags["record_screen"] and flags["record_region"]
    assert not flags["record_cloud"] and not flags["share_links"]
    limits = new.get_model("twisters", "Plan").objects.get(code="free").limits
    assert limits["voice_clip_ms_max"] == 60_000 and limits["voice_clip_bytes_max"] == 2_097_152
    assert limits["recordings_max"] == 5 and limits["storage_bytes_max"] == 104_857_600

    back = migrate(("twisters", "0009_asset_foreign_keys"))
    assert not back.get_model("twisters", "FeatureFlag").objects.get(code="record_local").enabled
    plan = back.get_model("twisters", "Plan").objects.get(code="free")
    assert "voice_clip_ms_max" not in plan.limits and plan.limits["recordings_max"] == 5


@pytest.fixture
def at_0010():
    yield migrate(("twisters", "0010_record_flags_and_limits"))
    migrate(*latest())


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_0011_keeps_reminder_flags_and_reverses(at_0010):
    import datetime as dt

    old = at_0010
    Profile, Twister, Asset, Rec = (
        old.get_model("twisters", n) for n in ("Profile", "Twister", "MediaAsset", "Recording")
    )
    profile = Profile.objects.create(id=uuid.uuid4(), plan_id="free", display_name="Real")
    twister = Twister.objects.create(slug="t2", text="a b c")
    asset = Asset.objects.create(
        profile=profile,
        kind="video",
        bucket="recordings",
        path="old/path.webm",
        mime_type="video/webm",
    )
    reminded = dt.datetime(2026, 9, 1, tzinfo=dt.UTC)
    rec = Rec.objects.create(
        profile=profile,
        client_recording_id=uuid.uuid4(),
        twister=twister,
        duration_ms=1000,
        mime_type="video/webm",
        size_bytes=10,
        video_asset=asset,
        expiry_reminded_at=reminded,
    )

    new = migrate(*latest())
    row = new.get_model("twisters", "Recording").objects.get(pk=rec.pk)
    assert row.reminder_sent_at == reminded and row.audio_asset_id is None
    assert new.get_model("twisters", "Profile").objects.get(pk=profile.pk).public_name == ""
    assert new.get_model("twisters", "MediaJob").objects.count() == 0
    assert new.get_model("twisters", "MediaAsset").objects.get(pk=asset.pk).path == "old/path.webm"

    back = migrate(("twisters", "0010_record_flags_and_limits"))
    assert (
        back.get_model("twisters", "Recording").objects.get(pk=rec.pk).expiry_reminded_at
        == reminded
    )
    assert "MediaJob" not in {m.__name__ for m in back.get_models()}
