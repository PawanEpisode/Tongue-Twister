"""Expiry reminder e-mails: batching, idempotency, opt-outs of nothing, failure handling."""

import datetime as dt
import uuid

import pytest
from django.core import mail
from django.core.management import call_command
from django.utils import timezone

from twisters.media import reminders
from twisters.models import Profile, Recording

from .media_helpers import saved_recording


def expire_in(days: float, *recording_ids) -> None:
    Recording.objects.filter(pk__in=recording_ids).update(
        expires_at=timezone.now() + dt.timedelta(days=days)
    )


@pytest.fixture
def takes(cloud_user, storage):
    client, profile = cloud_user
    a = saved_recording(client, storage, title="First <b>take</b> & more")
    b = saved_recording(client, storage, title="Second")
    return profile, a["id"], b["id"]


def test_one_email_covers_every_take_expiring_soon(takes, settings, mailoutbox):
    profile, a, b = takes
    expire_in(2, a, b)
    assert reminders.remind_expiring() == 2
    assert len(mailoutbox) == 1
    msg = mailoutbox[0]
    assert msg.to == [profile.email] and msg.from_email == settings.DEFAULT_FROM_EMAIL
    assert "expire soon" in msg.subject
    assert f"{settings.WEB_BASE_URL}/recordings" in msg.body
    assert "First <b>take</b> & more" in msg.body  # plain text is not HTML-escaped
    html = msg.alternatives[0][0]
    assert "First &lt;b&gt;take&lt;/b&gt; &amp; more" in html and "<b>take</b>" not in html
    assert "Second" in msg.body


def test_a_single_take_gets_the_singular_subject(cloud_user, storage, mailoutbox):
    rec = saved_recording(cloud_user[0], storage)
    expire_in(1, rec["id"])
    reminders.remind_expiring()
    assert mailoutbox[0].subject == reminders.SUBJECT_ONE


def test_reminders_are_sent_once(takes, mailoutbox):
    _, a, b = takes
    expire_in(2, a, b)
    assert reminders.remind_expiring() == 2
    assert reminders.remind_expiring() == 0
    assert len(mailoutbox) == 1
    assert Recording.objects.filter(reminder_sent_at__isnull=False).count() == 2


def test_a_take_that_expires_later_gets_its_own_email(takes, mailoutbox):
    _, a, b = takes
    expire_in(2, a)
    reminders.remind_expiring()
    expire_in(2, b)
    assert reminders.remind_expiring() == 1
    assert len(mailoutbox) == 2 and "Second" in mailoutbox[1].body


def test_far_off_expired_deleted_and_unready_takes_get_nothing(takes, mailoutbox):
    _, a, b = takes
    expire_in(10, a)  # outside the window
    Recording.objects.filter(pk=b).update(
        expires_at=timezone.now() + dt.timedelta(days=1), deleted_at=timezone.now()
    )
    assert reminders.remind_expiring() == 0
    Recording.objects.filter(pk=b).update(deleted_at=None, status="failed")
    assert reminders.remind_expiring() == 0
    Recording.objects.filter(pk=b).update(status="ready", expires_at=timezone.now())
    assert reminders.remind_expiring() == 0 and not mailoutbox  # already expired


def test_no_email_address_means_skipped_and_not_marked(takes, mailoutbox):
    profile, a, b = takes
    expire_in(2, a, b)
    Profile.objects.filter(pk=profile.pk).update(email="")
    assert reminders.remind_expiring() == 0 and not mailoutbox
    assert not Recording.objects.filter(reminder_sent_at__isnull=False).exists()
    Profile.objects.filter(pk=profile.pk).update(email="later@example.com")
    assert reminders.remind_expiring() == 2 and mailoutbox[0].to == ["later@example.com"]


def test_each_user_gets_their_own_email(takes, mailoutbox, auth_client, storage):
    profile, a, b = takes
    expire_in(2, a, b)
    sub = str(uuid.uuid4())
    other = auth_client(sub)
    other.get("/api/v1/me/")
    other_profile = Profile.objects.get(pk=sub)
    Profile.objects.filter(pk=sub).update(email="other@example.com")
    from twisters.models import AgeBand, ConsentType, UserConsent

    Profile.objects.filter(pk=sub).update(age_band=AgeBand.ADULT)
    UserConsent.objects.create(
        profile=other_profile, type=ConsentType.RECORDING_UPLOAD, version="v1"
    )
    mine = saved_recording(other, storage)
    expire_in(1, mine["id"])
    assert reminders.remind_expiring() == 3
    assert sorted(m.to[0] for m in mailoutbox) == sorted(["other@example.com", profile.email])


def test_a_delivery_failure_releases_the_claim_so_the_next_run_retries(
    takes, mailoutbox, monkeypatch
):
    _, a, b = takes
    expire_in(2, a, b)

    def boom(*_a, **_k):
        raise OSError("smtp down")

    monkeypatch.setattr(reminders, "send_expiry_reminder", boom)
    assert reminders.remind_expiring() == 0
    assert not Recording.objects.filter(reminder_sent_at__isnull=False).exists()
    monkeypatch.undo()
    assert reminders.remind_expiring() == 2 and len(mail.outbox) == 1


def test_the_email_carries_no_signed_urls_or_tokens(takes, mailoutbox):
    _, a, b = takes
    expire_in(2, a, b)
    reminders.remind_expiring()
    text = mailoutbox[0].body + mailoutbox[0].alternatives[0][0]
    assert "memory://" not in text and "token" not in text.lower()


def test_the_hourly_command_sends_them(takes, mailoutbox, capsys):
    _, a, b = takes
    expire_in(2, a, b)
    call_command("expire_recordings")
    assert "reminded=2" in capsys.readouterr().out and len(mailoutbox) == 1
