"""Practice reminder e-mails (D27): preferences, DST-safe hour selection, one mail a day, the flag, RFC 8058
headers and the idempotent public unsubscribe."""

import datetime as dt
from zoneinfo import ZoneInfo

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from twisters.models import DailyActivity, FeatureFlag, Profile, ReminderPreference
from twisters.reminders import service, tokens

from .progress_helpers import API, new_profile

pytestmark = pytest.mark.django_db
NEW_YORK = ZoneInfo("America/New_York")
KOLKATA = ZoneInfo("Asia/Kolkata")


def local(tz, year, month, day, hour, minute=7) -> dt.datetime:
    return dt.datetime(year, month, day, hour, minute, tzinfo=tz).astimezone(dt.UTC)


@pytest.fixture(autouse=True)
def urls(settings):
    settings.WEB_BASE_URL = "https://web.example"
    settings.API_PUBLIC_URL = "https://api.example"


@pytest.fixture
def flag_on(db):
    FeatureFlag.objects.update_or_create(code="reminders", defaults={"enabled": True})


def person(hour=18, tz="Asia/Kolkata", enabled=True, **over) -> Profile:
    over.setdefault("email", "p@example.com")
    profile = new_profile(timezone=tz, **over)
    ReminderPreference.objects.create(profile=profile, enabled=enabled, hour_local=hour)
    return profile


# --- preferences endpoint -------------------------------------------------------------------------------


def test_defaults_are_off_at_18(user):
    client, _ = user
    body = client.get(f"{API}/me/reminders/").json()
    assert body == {
        "enabled": False,
        "hour_local": 18,
        "timezone": "UTC",
        "timezone_confirmed": False,
    }


def test_put_saves_and_get_reads_back(user):
    client, profile = user
    response = client.put(f"{API}/me/reminders/", {"enabled": True, "hour_local": 7}, format="json")
    assert response.status_code == 200
    assert response.json()["enabled"] is True and response.json()["hour_local"] == 7
    assert client.get(f"{API}/me/reminders/").json()["hour_local"] == 7
    assert ReminderPreference.objects.get(profile=profile).enabled


@pytest.mark.parametrize(
    "body",
    [
        {"enabled": True, "hour_local": 24},
        {"enabled": True, "hour_local": -1},
        {"hour_local": 5},
        {"enabled": True},
    ],
)
def test_put_validates(user, body):
    client, _ = user
    response = client.put(f"{API}/me/reminders/", body, format="json")
    assert response.status_code == 400


def test_endpoint_needs_sign_in_and_works_with_the_flag_off(anon, user):
    assert anon.get(f"{API}/me/reminders/").status_code == 401
    assert user[0].get(f"{API}/me/reminders/").status_code == 200


def test_pending_deletion_cannot_change_but_can_read(user):
    client, profile = user
    from twisters.account import deletion

    deletion.request_deletion(profile)
    assert client.get(f"{API}/me/reminders/").status_code == 200
    put = client.put(f"{API}/me/reminders/", {"enabled": True, "hour_local": 9}, format="json")
    assert put.status_code == 403


# --- hour selection / DST ---------------------------------------------------------------------------------


def test_sends_only_at_the_local_hour(flag_on, mailoutbox):
    person(hour=18)
    service.send_due(local(KOLKATA, 2026, 9, 10, 17, 7))
    service.send_due(local(KOLKATA, 2026, 9, 10, 19, 7))
    assert mailoutbox == []
    report = service.send_due(local(KOLKATA, 2026, 9, 10, 18, 7))
    assert report.sent == 1 and len(mailoutbox) == 1


def test_each_person_is_matched_in_their_own_zone(flag_on, mailoutbox):
    person(hour=9, tz="America/New_York", email="ny@example.com")
    person(hour=9, tz="Asia/Kolkata", email="in@example.com")
    service.send_due(local(NEW_YORK, 2026, 9, 10, 9))
    assert [m.to for m in mailoutbox] == [["ny@example.com"]]


def test_spring_forward_gap_sends_in_the_next_hour_not_never(flag_on, mailoutbox):
    # 2026-03-08: New York jumps 02:00 -> 03:00, so 02:xx does not exist.
    person(hour=2, tz="America/New_York")
    service.send_due(local(NEW_YORK, 2026, 3, 8, 1, 7))
    assert mailoutbox == []
    service.send_due(local(NEW_YORK, 2026, 3, 8, 3, 7))
    assert len(mailoutbox) == 1


def test_a_normal_day_does_not_double_send_in_the_following_hour(flag_on, mailoutbox):
    person(hour=2, tz="America/New_York")
    service.send_due(local(NEW_YORK, 2026, 3, 9, 3, 7))
    assert mailoutbox == []


def test_autumn_overlap_hour_happens_twice_but_mails_once(flag_on, mailoutbox):
    # 2026-11-01: New York 01:xx happens twice (EDT then EST).
    person(hour=1, tz="America/New_York")
    first = dt.datetime(2026, 11, 1, 1, 7, tzinfo=NEW_YORK, fold=0).astimezone(dt.UTC)
    second = dt.datetime(2026, 11, 1, 1, 7, tzinfo=NEW_YORK, fold=1).astimezone(dt.UTC)
    assert second - first == dt.timedelta(hours=1)
    service.send_due(first)
    service.send_due(second)
    assert len(mailoutbox) == 1


def test_hour_exists_helper():
    profile = new_profile(timezone="America/New_York")
    assert not service.hour_exists(profile, dt.date(2026, 3, 8), 2)
    assert service.hour_exists(profile, dt.date(2026, 3, 8), 3)
    assert service.hour_exists(profile, dt.date(2026, 11, 1), 1)


def test_night_owl_uses_the_wall_clock_hour_but_the_streak_day(flag_on, mailoutbox):
    # 01:07 local is hour 1 on the wall clock; the streak day is still yesterday for a night owl.
    owl = person(hour=1, tz="Asia/Kolkata", night_owl=True)
    moment = local(KOLKATA, 2026, 9, 11, 1, 7)
    DailyActivity.objects.create(profile=owl, local_date=dt.date(2026, 9, 10), attempts=2)
    assert service.send_due(moment).sent == 0  # practised on the streak day (the 10th)
    DailyActivity.objects.all().delete()
    assert service.send_due(moment).sent == 1
    assert ReminderPreference.objects.get(profile=owl).last_sent_on == dt.date(2026, 9, 10)


# --- who is skipped ---------------------------------------------------------------------------------------


def test_flag_off_or_missing_sends_nothing(mailoutbox):
    person()
    FeatureFlag.objects.filter(code="reminders").delete()
    assert service.send_due(local(KOLKATA, 2026, 9, 10, 18)).flag_off
    FeatureFlag.objects.create(code="reminders", enabled=False)
    assert service.send_due(local(KOLKATA, 2026, 9, 10, 18)).flag_off
    assert mailoutbox == []


def test_flag_allow_list_limits_who_gets_mail(mailoutbox):
    chosen = person(email="a@example.com")
    person(email="b@example.com")
    FeatureFlag.objects.update_or_create(
        code="reminders",
        defaults={"enabled": True, "rollout_pct": 0, "allow_list": [str(chosen.pk)]},
    )
    service.send_due(local(KOLKATA, 2026, 9, 10, 18))
    assert [m.to for m in mailoutbox] == [["a@example.com"]]


def test_disabled_pending_deletion_no_email_and_unconfirmed_zone_are_skipped(flag_on, mailoutbox):
    person(enabled=False, email="off@example.com")
    gone = person(email="gone@example.com")
    Profile.objects.filter(pk=gone.pk).update(
        deletion_requested_at=dt.datetime(2026, 9, 1, tzinfo=dt.UTC),
        deletion_scheduled_for=dt.datetime(2026, 10, 1, tzinfo=dt.UTC),
    )
    person(email="")
    person(tz="UTC", hour=12, email="utc@example.com")
    assert service.send_due(local(KOLKATA, 2026, 9, 10, 18)).sent == 0
    assert service.send_due(dt.datetime(2026, 9, 10, 12, 7, tzinfo=dt.UTC)).sent == 0
    assert mailoutbox == []


def test_someone_who_practised_today_is_not_nagged(flag_on, mailoutbox):
    a = person(email="a@example.com")
    person(email="b@example.com")
    DailyActivity.objects.create(profile=a, local_date=dt.date(2026, 9, 10), attempts=1)
    service.send_due(local(KOLKATA, 2026, 9, 10, 18))
    assert [m.to for m in mailoutbox] == [["b@example.com"]]


def test_practice_on_another_day_does_not_count(flag_on, mailoutbox):
    a = person()
    DailyActivity.objects.create(profile=a, local_date=dt.date(2026, 9, 9), attempts=3)
    assert service.send_due(local(KOLKATA, 2026, 9, 10, 18)).sent == 1


# --- one a day, failures ----------------------------------------------------------------------------------


def test_max_one_mail_per_person_per_day_and_one_again_tomorrow(flag_on, mailoutbox):
    person()
    service.send_due(local(KOLKATA, 2026, 9, 10, 18, 7))
    service.send_due(local(KOLKATA, 2026, 9, 10, 18, 52))  # a re-run in the same hour
    assert len(mailoutbox) == 1
    service.send_due(local(KOLKATA, 2026, 9, 11, 18, 7))
    assert len(mailoutbox) == 2


def test_delivery_failure_hands_the_claim_back(flag_on, mailoutbox, monkeypatch):
    profile = person()
    moment = local(KOLKATA, 2026, 9, 10, 18)

    def boom(self, *a, **k):
        raise OSError("smtp down")

    monkeypatch.setattr("django.core.mail.EmailMultiAlternatives.send", boom)
    report = service.send_due(moment)
    assert (report.sent, report.failed) == (0, 1)
    assert ReminderPreference.objects.get(profile=profile).last_sent_on is None
    monkeypatch.undo()
    assert service.send_due(moment).sent == 1


def test_unsubscribed_between_selection_and_claim_wins(flag_on, mailoutbox):
    profile = person()
    row = ReminderPreference.objects.get(profile=profile)
    ReminderPreference.objects.filter(pk=profile.pk).update(enabled=False)
    assert not service._claim(row.profile, dt.date(2026, 9, 10))


# --- the message ------------------------------------------------------------------------------------------


def test_message_has_text_html_and_rfc8058_headers(flag_on, mailoutbox, settings):
    profile = person(display_name="Asha <b>")
    service.send_due(local(KOLKATA, 2026, 9, 10, 18))
    msg = mailoutbox[0]
    token = tokens.make_token(profile.pk)
    assert msg.to == ["p@example.com"] and msg.from_email == settings.DEFAULT_FROM_EMAIL
    assert (
        msg.extra_headers["List-Unsubscribe"]
        == f"<https://api.example/api/v1/public/unsubscribe/{token}/>"
    )
    assert msg.extra_headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert f"https://web.example/unsubscribe/{token}" in msg.body
    html = msg.alternatives[0][0]
    assert f"https://web.example/unsubscribe/{token}" in html
    assert "Asha &lt;b&gt;" in html and "Asha <b>" in msg.body


def test_streak_changes_the_subject(flag_on, mailoutbox):
    person(current_streak=4, last_activity_date=dt.date(2026, 9, 9))
    service.send_due(local(KOLKATA, 2026, 9, 10, 18))
    assert mailoutbox[0].subject == service.SUBJECT_STREAK and "4-day streak" in mailoutbox[0].body


def test_no_streak_gets_the_plain_subject(flag_on, mailoutbox):
    person()
    service.send_due(local(KOLKATA, 2026, 9, 10, 18))
    assert mailoutbox[0].subject == service.SUBJECT


def test_missing_public_urls_refuse_to_send(flag_on, settings):
    settings.API_PUBLIC_URL = ""
    with pytest.raises(CommandError):
        call_command("send_reminders")


def test_command_runs_and_reports(flag_on, mailoutbox, capsys):
    call_command("send_reminders")
    assert "considered=0" in capsys.readouterr().out


def test_command_says_so_when_the_flag_is_off(capsys):
    FeatureFlag.objects.filter(code="reminders").update(enabled=False)
    call_command("send_reminders")
    assert "flag is off" in capsys.readouterr().out


# --- tokens and the public endpoint -----------------------------------------------------------------------


def test_token_round_trip_and_tampering():
    profile = new_profile()
    token = tokens.make_token(profile.pk)
    assert tokens.read_token(token) == profile.pk
    assert tokens.read_token(token[:-2] + "xx") is None
    assert tokens.read_token("garbage") is None
    assert tokens.read_token("") is None
    other = tokens.make_token(new_profile().pk)
    assert tokens.read_token(token.split(".")[0] + "." + other.split(".")[1]) is None
    assert "/" not in token and ":" not in token


def test_token_from_another_salt_is_refused():
    from django.core import signing

    foreign = signing.Signer(salt="something.else", sep=".").sign_object(
        {"p": str(new_profile().pk)}
    )
    assert tokens.read_token(foreign) is None


@pytest.mark.parametrize("method", ["get", "post"])
def test_unsubscribe_is_idempotent_anonymous_and_not_cached(anon, method):
    profile = person()
    url = f"{API}/public/unsubscribe/{tokens.make_token(profile.pk)}/"
    for _ in range(2):
        response = getattr(anon, method)(url)
        assert response.status_code == 200 and response.json() == {"unsubscribed": True}
        assert response["Cache-Control"] == "no-store"
    assert not ReminderPreference.objects.get(profile=profile).enabled


def test_one_click_post_body_is_accepted(anon):
    profile = person()
    url = f"{API}/public/unsubscribe/{tokens.make_token(profile.pk)}/"
    response = anon.post(
        url, "List-Unsubscribe=One-Click", content_type="application/x-www-form-urlencoded"
    )
    assert response.status_code == 200
    assert not ReminderPreference.objects.get(profile=profile).enabled


def test_unsubscribe_keeps_the_hour_and_only_touches_that_person(anon):
    a, b = person(hour=7), person(hour=8)
    anon.post(f"{API}/public/unsubscribe/{tokens.make_token(a.pk)}/")
    assert ReminderPreference.objects.get(profile=a).hour_local == 7
    assert ReminderPreference.objects.get(profile=b).enabled


def test_bad_token_is_404_and_valid_token_for_a_missing_account_is_200(anon):
    assert anon.post(f"{API}/public/unsubscribe/not-a-token/").status_code == 404
    ghost = tokens.make_token(new_profile().pk)
    Profile.objects.all().delete()
    assert anon.post(f"{API}/public/unsubscribe/{ghost}/").json() == {"unsubscribed": True}


def test_unsubscribe_works_for_an_account_pending_deletion(anon):
    profile = person()
    Profile.objects.filter(pk=profile.pk).update(
        deletion_requested_at=dt.datetime(2026, 9, 1, tzinfo=dt.UTC),
        deletion_scheduled_for=dt.datetime(2026, 10, 1, tzinfo=dt.UTC),
    )
    assert (
        anon.post(f"{API}/public/unsubscribe/{tokens.make_token(profile.pk)}/").status_code == 200
    )
    assert not ReminderPreference.objects.get(profile=profile).enabled


def test_a_row_is_removed_with_its_profile():
    profile = person()
    profile.delete()
    assert not ReminderPreference.objects.exists()
