"""The purge after the grace period: due accounts only, media first, cascade, Supabase Auth, retries."""

import datetime as dt
import logging
import urllib.request
import uuid

import pytest
from django.core.management import call_command
from django.utils import timezone

from twisters.account import authadmin, deletion
from twisters.account.authadmin import AuthAdminError, SupabaseAuthAdmin
from twisters.media.storage import StorageError
from twisters.models import (
    Attempt,
    AttemptWord,
    DailyActivity,
    Favorite,
    MediaAsset,
    Profile,
    Recording,
    ShareLink,
    StorageLedger,
    UserAchievement,
    UserConsent,
    UserTwisterStats,
    UserWordStat,
)

from .media_helpers import create_recording, saved_recording
from .progress_helpers import at, make_attempt, make_stats, new_profile, twister
from .speak_helpers import SLUG, submit
from .test_media_voice import ready_voice

pytestmark = pytest.mark.django_db
NOW = at(2026, 10, 20, 12, 0)
DUE = NOW - dt.timedelta(hours=1)
LATER = NOW + dt.timedelta(days=1)


class FakeAuthAdmin:
    def __init__(self, fail: Exception | None = None):
        self.deleted: list = []
        self.fail = fail

    def delete_user(self, user_id) -> None:
        if self.fail:
            raise self.fail
        self.deleted.append(user_id)


def pending(profile: Profile, scheduled_for: dt.datetime = DUE) -> Profile:
    Profile.objects.filter(pk=profile.pk).update(
        deletion_requested_at=scheduled_for - dt.timedelta(days=30),
        deletion_scheduled_for=scheduled_for,
    )
    profile.refresh_from_db()
    return profile


def purge(admin=None, now=NOW) -> deletion.PurgeReport:
    return deletion.purge_due(now, admin or FakeAuthAdmin())


# --- who is picked ---------------------------------------------------------------------------------------


def test_only_due_pending_profiles_are_purged():
    due = pending(new_profile())
    not_yet = pending(new_profile(), NOW + dt.timedelta(days=1))
    normal = new_profile()
    admin = FakeAuthAdmin()
    assert purge(admin) == deletion.PurgeReport(purged=1, deferred=0, skipped=0)
    assert not Profile.objects.filter(pk=due.pk).exists()
    assert Profile.objects.filter(pk__in=[not_yet.pk, normal.pk]).count() == 2
    assert admin.deleted == [due.pk]


def test_exactly_at_the_scheduled_moment_is_due():
    p = pending(new_profile(), NOW)
    assert purge().purged == 1 and not Profile.objects.filter(pk=p.pk).exists()


def test_a_cancel_that_raced_the_job_wins():
    p = pending(new_profile())
    Profile.objects.filter(pk=p.pk).update(deletion_requested_at=None, deletion_scheduled_for=None)
    assert deletion._purge_one(p.pk, NOW, FakeAuthAdmin()) == deletion.SKIPPED
    assert Profile.objects.filter(pk=p.pk).exists()


# --- cascade and media -----------------------------------------------------------------------------------


def populate(profile: Profile) -> None:
    tw = twister(SLUG)
    attempt = make_attempt(profile, tw, score=90)
    AttemptWord.objects.create(attempt=attempt, target_word="x", status="correct", credit=1)
    make_stats(profile, tw)
    UserWordStat.objects.create(profile=profile, word_norm="x")
    Favorite.objects.create(profile=profile, twister=tw)
    DailyActivity.objects.create(profile=profile, local_date=dt.date(2026, 9, 1))
    UserConsent.objects.create(profile=profile, type="terms", version="v1")


def test_everything_that_hangs_off_the_profile_goes_with_it(user):
    _, profile = user
    other = new_profile()
    populate(profile)
    populate(other)
    pending(profile)
    assert purge().purged == 1
    for model in (Attempt, UserTwisterStats, UserWordStat, Favorite, DailyActivity, UserConsent):
        assert not model.objects.filter(profile=profile).exists(), model.__name__
        assert model.objects.filter(profile=other).count() >= 1, model.__name__
    assert not AttemptWord.objects.filter(attempt__profile=profile).exists()
    assert not UserAchievement.objects.filter(profile=profile).exists()


def test_stored_objects_are_removed_before_the_profile(cloud_user, storage):
    client, profile = cloud_user
    saved = saved_recording(client, storage)
    create_recording(client)  # an upload that never completed
    voice = ready_voice(client, storage)
    attempt = submit(client).data
    card = client.post(f"/api/v1/attempts/{attempt['id']}/score-card/")
    assert storage.objects and card.status_code == 201
    pending(profile)

    assert purge().purged == 1
    assert not storage.objects
    assert not Profile.objects.filter(pk=profile.pk).exists()
    for model in (Recording, MediaAsset, StorageLedger, ShareLink):
        assert model.objects.count() == 0, model.__name__
    assert saved["id"] and voice


def test_other_peoples_objects_are_left_alone(cloud_user, storage, auth_client):
    client, profile = cloud_user
    saved_recording(client, storage)
    mine = len(storage.objects)
    other = new_profile()
    pending(other)  # a different pending account with nothing stored
    pending(profile)
    purge()
    assert mine > 0 and not storage.objects
    assert not Profile.objects.filter(pk=other.pk).exists()


# --- failures retry --------------------------------------------------------------------------------------


def test_a_storage_failure_keeps_the_account_pending_and_the_next_run_finishes(cloud_user, storage):
    client, profile = cloud_user
    saved_recording(client, storage)
    pending(profile)
    healthy = storage.delete

    def refuse(bucket, path):
        raise StorageError("delete failed")

    storage.delete = refuse  # a lasting outage, not a one-off blip
    admin = FakeAuthAdmin()
    assert purge(admin) == deletion.PurgeReport(purged=0, deferred=1, skipped=0)
    assert Profile.objects.get(pk=profile.pk).pending_deletion
    assert admin.deleted == []

    storage.delete = healthy
    assert purge(admin).purged == 1
    assert not storage.objects and admin.deleted == [profile.pk]


def test_a_supabase_failure_rolls_the_delete_back_and_retries(user):
    _, profile = user
    populate(profile)
    pending(profile)
    flaky = FakeAuthAdmin(fail=AuthAdminError("delete_user failed (500)"))
    assert purge(flaky).deferred == 1
    assert Profile.objects.filter(pk=profile.pk).exists()
    assert Attempt.objects.filter(profile=profile).exists()  # nothing was lost with the failed call
    working = FakeAuthAdmin()
    assert purge(working).purged == 1 and working.deleted == [profile.pk]


def test_an_unexpected_error_in_one_account_does_not_stop_the_others(monkeypatch):
    bad, good = pending(new_profile()), pending(new_profile())
    real = deletion._purge_one

    def explode_for_bad(profile_id, now, admin):
        if profile_id == bad.pk:
            raise RuntimeError("boom")
        return real(profile_id, now, admin)

    monkeypatch.setattr(deletion, "_purge_one", explode_for_bad)
    assert purge() == deletion.PurgeReport(purged=1, deferred=1, skipped=0)
    assert (
        Profile.objects.filter(pk=bad.pk).exists()
        and not Profile.objects.filter(pk=good.pk).exists()
    )


# --- the command -----------------------------------------------------------------------------------------


def test_the_command_is_idempotent(capsys):
    pending(new_profile(), timezone.now() - dt.timedelta(hours=1))
    call_command("purge_deleted_accounts")
    assert "purged=1, deferred=0, skipped=0" in capsys.readouterr().out
    call_command("purge_deleted_accounts")
    assert "purged=0, deferred=0, skipped=0" in capsys.readouterr().out


def test_the_command_without_a_service_key_still_deletes_the_local_data(caplog):
    p = pending(new_profile(), timezone.now() - dt.timedelta(hours=1))
    with caplog.at_level(logging.WARNING):
        call_command("purge_deleted_accounts")
    assert not Profile.objects.filter(pk=p.pk).exists()
    assert "authadmin.skipped" in caplog.text


# --- the Supabase Auth adapter ---------------------------------------------------------------------------


class Recorder:
    def __init__(self, status: int):
        self.status = status
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request) -> int:
        self.requests.append(request)
        return self.status


KEY = "service-role-key-123"
USER = uuid.UUID("11111111-2222-3333-4444-555555555555")


@pytest.mark.parametrize("status", [200, 204, 404])
def test_deleted_or_already_gone_counts_as_success(status):
    transport = Recorder(status)
    SupabaseAuthAdmin("https://x.supabase.co/", KEY, transport).delete_user(USER)
    (request,) = transport.requests
    assert request.get_method() == "DELETE"
    assert request.full_url == f"https://x.supabase.co/auth/v1/admin/users/{USER}"
    assert request.get_header("Authorization") == f"Bearer {KEY}"
    assert request.get_header("Apikey") == KEY


@pytest.mark.parametrize("status", [400, 401, 403, 429, 500, 503])
def test_any_other_status_is_an_error_that_never_mentions_the_key(status, caplog):
    admin = SupabaseAuthAdmin("https://x.supabase.co", KEY, Recorder(status))
    with caplog.at_level(logging.DEBUG), pytest.raises(AuthAdminError) as caught:
        admin.delete_user(USER)
    assert str(status) in str(caught.value)
    assert KEY not in str(caught.value) and KEY not in caplog.text


def test_a_network_failure_is_an_auth_admin_error():
    def down(request):
        raise AuthAdminError("network error")

    with pytest.raises(AuthAdminError):
        SupabaseAuthAdmin("https://x.supabase.co", KEY, down).delete_user(USER)


def test_the_factory_needs_both_url_and_key(settings):
    settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY = "https://x.supabase.co", ""
    assert isinstance(authadmin.get_auth_admin(), authadmin.UnconfiguredAuthAdmin)
    settings.SUPABASE_SERVICE_ROLE_KEY = KEY
    assert isinstance(authadmin.get_auth_admin(), SupabaseAuthAdmin)
    settings.SUPABASE_URL = ""
    assert isinstance(authadmin.get_auth_admin(), authadmin.UnconfiguredAuthAdmin)


def test_the_unconfigured_adapter_only_warns(caplog):
    with caplog.at_level(logging.WARNING):
        authadmin.UnconfiguredAuthAdmin().delete_user(USER)
    assert "authadmin.skipped" in caplog.text and str(USER) not in caplog.text


# --- ops wiring --------------------------------------------------------------------------------------------


def test_the_workflow_allows_and_schedules_the_purge_job():
    from pathlib import Path

    text = (
        Path(__file__).resolve().parents[2] / ".github/workflows/manage-command.yml"
    ).read_text()
    allowed = next(line for line in text.splitlines() if line.strip().startswith("ALLOWED="))
    assert "purge_deleted_accounts" in allowed
    assert 'cron: "53 * * * *"' in text and "purge_deleted_accounts ;;" in text
