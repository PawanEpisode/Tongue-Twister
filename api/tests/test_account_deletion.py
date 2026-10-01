"""Requesting and cancelling account deletion (D21): confirm gate, grace maths, the pending-account
write block, and everything that must stop the moment the account becomes pending."""

import datetime as dt
import uuid

import pytest
from django.db import IntegrityError, transaction
from django.utils.dateparse import parse_datetime

from twisters.models import FeatureFlag, Profile, ShareLink
from twisters.progress import boards

from .media_helpers import API, error_code, saved_recording
from .progress_helpers import at, freeze_time, make_attempt, new_profile, twister
from .speak_helpers import SLUG, attempt_body, submit

pytestmark = pytest.mark.django_db
NOW = at(2026, 9, 10, 12, 0)
GRACE = dt.timedelta(days=30)


def when(value) -> dt.datetime | None:
    """A response's date as a datetime (DRF renders them as ISO strings)."""
    return parse_datetime(value) if isinstance(value, str) else value


def request_deletion(client, body=None):
    return client.delete(
        f"{API}/me/", {"confirm": "DELETE"} if body is None else body, format="json"
    )


def cancel(client):
    return client.delete(f"{API}/me/deletion/")


@pytest.fixture
def pending(user, monkeypatch):
    """A signed-in user whose deletion was requested at NOW."""
    client, profile = user
    freeze_time(monkeypatch, NOW)
    assert request_deletion(client).status_code == 202
    profile.refresh_from_db()
    return client, profile


# --- requesting ----------------------------------------------------------------------------------------


@pytest.mark.parametrize("body", [{}, {"confirm": ""}, {"confirm": "delete"}, {"confirm": "yes"}])
def test_deletion_needs_the_exact_confirmation(user, body):
    client, profile = user
    r = request_deletion(client, body)
    assert r.status_code == 400 and error_code(r) == "validation_error"
    assert Profile.objects.get(pk=profile.pk).deletion_requested_at is None


def test_a_confirmed_request_is_accepted_with_the_grace_dates(user, monkeypatch):
    client, profile = user
    freeze_time(monkeypatch, NOW)
    r = request_deletion(client)
    assert r.status_code == 202
    assert when(r.data["deletion_requested_at"]) == NOW
    assert when(r.data["deletion_scheduled_for"]) == NOW + GRACE
    row = Profile.objects.get(pk=profile.pk)
    assert (row.deletion_requested_at, row.deletion_scheduled_for) == (NOW, NOW + GRACE)


def test_the_grace_period_is_a_setting(user, monkeypatch, settings):
    client, _ = user
    settings.ACCOUNT_DELETION_GRACE_DAYS = 7
    freeze_time(monkeypatch, NOW)
    assert when(request_deletion(client).data["deletion_scheduled_for"]) == NOW + dt.timedelta(
        days=7
    )


def test_asking_again_while_pending_changes_nothing(pending, monkeypatch):
    client, _ = pending
    freeze_time(monkeypatch, NOW + dt.timedelta(days=5))
    r = request_deletion(client)
    assert r.status_code == 202
    assert (when(r.data["deletion_requested_at"]), when(r.data["deletion_scheduled_for"])) == (
        NOW,
        NOW + GRACE,
    )


def test_the_profile_and_summary_carry_the_scheduled_date(pending):
    client, _ = pending
    for path in ("/me/", "/me/summary/"):
        assert when(client.get(f"{API}{path}").data["deletion_scheduled_for"]) == NOW + GRACE


def test_a_normal_account_reports_no_date(user):
    client, _ = user
    assert client.get(f"{API}/me/").data["deletion_scheduled_for"] is None


def test_deletion_needs_a_signed_in_user(anon):
    assert request_deletion(anon).status_code in (401, 403)
    assert cancel(anon).status_code in (401, 403)


# --- cancelling ----------------------------------------------------------------------------------------


def test_cancelling_restores_the_account(pending):
    client, profile = pending
    r = cancel(client)
    assert r.status_code == 200
    assert r.data == {"deletion_requested_at": None, "deletion_scheduled_for": None}
    assert Profile.objects.get(pk=profile.pk).pending_deletion is False
    assert client.patch(f"{API}/me/", {"hide_from_boards": True}, format="json").status_code == 200


def test_cancelling_is_allowed_after_the_date_until_the_purge_runs(pending, monkeypatch):
    client, _ = pending
    freeze_time(monkeypatch, NOW + GRACE + dt.timedelta(days=3))
    assert cancel(client).status_code == 200


def test_cancelling_a_normal_account_is_a_harmless_no_op(user):
    client, _ = user
    r = cancel(client)
    assert r.status_code == 200 and r.data["deletion_scheduled_for"] is None


def test_a_cancelled_account_can_ask_again_with_fresh_dates(pending, monkeypatch):
    client, _ = pending
    cancel(client)
    later = NOW + dt.timedelta(days=2)
    freeze_time(monkeypatch, later)
    assert when(request_deletion(client).data["deletion_requested_at"]) == later


# --- the write block -----------------------------------------------------------------------------------


def blocked(response) -> bool:
    return response.status_code == 403 and error_code(response) == "account_pending_deletion"


WRITES = [
    ("post", "/attempts/", lambda: attempt_body()),
    ("patch", "/me/", lambda: {"night_owl": True}),
    ("put", f"/me/favorites/{SLUG}/", lambda: {}),
    ("post", f"/twisters/{SLUG}/favorite/", lambda: {}),
    ("patch", "/me/preferences/", lambda: {"wpm": 100}),
    ("post", "/me/consents/", lambda: {"type": "terms", "version": "v1"}),
    ("post", "/me/achievements/seen/", lambda: {}),
    ("post", "/recordings/", lambda: {}),
    ("post", "/voice/", lambda: {}),
    ("post", "/sessions/", lambda: {}),
    ("post", "/sync/guest/", lambda: {}),
]


@pytest.mark.parametrize("method,path,body", WRITES, ids=[f"{m} {p}" for m, p, _ in WRITES])
def test_a_pending_account_cannot_write(pending, method, path, body):
    client, _ = pending
    r = getattr(client, method)(f"{API}{path}", body(), format="json")
    assert blocked(r), (r.status_code, r.data)
    assert when(r.data["error"]["details"]["scheduled_for"]) == NOW + GRACE


@pytest.mark.parametrize(
    "path",
    [
        "/me/",
        "/me/summary/",
        "/me/achievements/",
        "/me/stats/",
        "/me/favorites/",
        "/twisters/",
        "/flags/",
    ],
)
def test_a_pending_account_can_still_read(pending, path):
    client, _ = pending
    assert client.get(f"{API}{path}").status_code == 200


def test_a_pending_account_can_export_and_cancel(pending):
    client, _ = pending
    assert client.get(f"{API}/me/export/").status_code == 200
    assert cancel(client).status_code == 200


def test_the_block_is_lifted_by_cancelling(pending):
    client, _ = pending
    assert blocked(client.post(f"{API}/attempts/", attempt_body(), format="json"))
    cancel(client)
    assert client.post(f"{API}/attempts/", attempt_body(), format="json").status_code == 201


def test_other_accounts_are_not_affected(pending, auth_client):
    other = auth_client()
    assert other.patch(f"{API}/me/", {"night_owl": True}, format="json").status_code == 200


# --- what stops at once --------------------------------------------------------------------------------


def test_share_links_are_revoked_and_public_pages_answer_410(cloud_user, storage, anon):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    attempt = submit(client).data
    take = client.post(f"{API}/recordings/{rec['id']}/share/", {"expires_in": "24h"}, format="json")
    card = client.post(f"{API}/attempts/{attempt['id']}/score-card/")
    tokens = {
        "r": take.data["url"].rsplit("/", 1)[1],
        "s": card.data["url"].rsplit("/", 1)[1],
    }
    assert all(anon.get(f"{API}/public/{k}/{t}/").status_code == 200 for k, t in tokens.items())

    assert request_deletion(client).status_code == 202
    assert not ShareLink.objects.filter(revoked_at__isnull=True).exists()
    assert all(anon.get(f"{API}/public/{k}/{t}/").status_code == 410 for k, t in tokens.items())
    assert anon.get(f"{API}/public/s/{tokens['s']}/image.png").status_code == 410

    cancel(client)  # revoked links stay revoked: the owner mints new ones
    assert anon.get(f"{API}/public/s/{tokens['s']}/").status_code == 410


def test_a_pending_profile_leaves_the_boards(user, monkeypatch):
    client, profile = user
    tw = twister(SLUG)
    other = new_profile()
    make_attempt(profile, tw, score=95)
    make_attempt(other, tw, score=90)
    assert {r["score"] for r in boards.twister_board(tw)} == {95, 90}
    freeze_time(monkeypatch, NOW)
    request_deletion(client)
    assert [r["score"] for r in boards.twister_board(tw)] == [90]
    cancel(client)
    assert {r["score"] for r in boards.twister_board(tw)} == {95, 90}


def test_a_pending_profile_leaves_the_weekly_board(user, monkeypatch):
    client, profile = user
    FeatureFlag.objects.filter(code="weekly_boards").update(enabled=True)
    tw = twister(SLUG)
    now = at(2026, 9, 10, 12, 0)
    make_attempt(profile, tw, score=95, when=at(2026, 9, 9, 9, 0))
    boards.rebuild_week(boards.week_start(now), tw)
    freeze_time(monkeypatch, now)
    assert boards.weekly_board(None, tw, now)["top"][0]["score"] == 95
    request_deletion(client)
    assert boards.weekly_board(None, tw, now)["top"] == []


def test_pending_profiles_are_not_sent_expiry_reminders(cloud_user, storage, mailoutbox):
    from twisters.media import reminders
    from twisters.models import Recording

    client, profile = cloud_user
    rec = saved_recording(client, storage)
    soon = at(2026, 9, 10, 12) + dt.timedelta(days=1)
    Recording.objects.filter(pk=rec["id"]).update(expires_at=soon)
    Profile.objects.filter(pk=profile.pk).update(
        deletion_requested_at=at(2026, 9, 9), deletion_scheduled_for=at(2026, 10, 9)
    )
    assert reminders.remind_expiring(at(2026, 9, 10, 12)) == 0 and not mailoutbox


# --- the queryset helper and the constraint --------------------------------------------------------------


def test_active_and_pending_querysets_partition_profiles():
    live = new_profile()
    gone = new_profile(deletion_requested_at=NOW, deletion_scheduled_for=NOW + GRACE)
    assert list(Profile.objects.active()) == [live]
    assert list(Profile.objects.pending_deletion()) == [gone]


@pytest.mark.parametrize(
    "requested,scheduled",
    [(NOW, NOW - dt.timedelta(seconds=1)), (NOW, None), (None, NOW)],
    ids=["scheduled before requested", "only requested", "only scheduled"],
)
def test_the_database_rejects_an_incoherent_deletion_window(requested, scheduled):
    with pytest.raises(IntegrityError), transaction.atomic():
        Profile.objects.create(
            id=uuid.uuid4(), deletion_requested_at=requested, deletion_scheduled_for=scheduled
        )


def test_a_zero_length_window_is_allowed():
    Profile.objects.create(id=uuid.uuid4(), deletion_requested_at=NOW, deletion_scheduled_for=NOW)


# --- staff ---------------------------------------------------------------------------------------------------


def test_staff_can_cancel_a_pending_deletion_from_the_admin(admin_client):
    p = new_profile(deletion_requested_at=NOW, deletion_scheduled_for=NOW + GRACE)
    quiet = new_profile()
    r = admin_client.post(
        "/admin/twisters/profile/",
        {"action": "cancel_deletion", "_selected_action": [p.pk, quiet.pk]},
    )
    assert r.status_code == 302
    assert not Profile.objects.pending_deletion().exists()
    assert admin_client.get("/admin/twisters/profile/?deletion=pending").status_code == 200
    assert admin_client.get(f"/admin/twisters/profile/{p.pk}/change/").status_code == 200
