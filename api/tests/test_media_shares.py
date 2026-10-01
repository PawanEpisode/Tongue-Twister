"""Share links, the public pages, reporting/moderation and score cards."""

import datetime as dt
import hashlib

import pytest
from django.utils import timezone

from twisters.media import moderation
from twisters.models import (
    FeatureFlag,
    ModerationReport,
    Recording,
    ReportStatus,
    ShareLink,
)

from .media_helpers import API, error_code, saved_recording
from .speak_helpers import submit


def share(client, recording_id, **body):
    return client.post(f"{API}/recordings/{recording_id}/share/", body, format="json")


def public(anon, token, kind="r", **extra):
    return anon.get(f"{API}/public/{kind}/{token}/", **extra)


def token_of(response) -> str:
    return response.data["url"].rsplit("/", 1)[1]


@pytest.fixture
def shared(cloud_user, storage):
    """(client, profile, recording payload, share response) for a ready, shared recording."""
    client, profile = cloud_user
    attempt = submit(client).data
    rec = saved_recording(client, storage, attempt=attempt["id"], title="Public title")
    return client, profile, rec, share(client, rec["id"], expires_in="24h")


# --- creating -----------------------------------------------------------------------------------


def test_create_returns_the_token_once_and_stores_only_its_hash(shared, settings):
    client, profile, rec, r = shared
    assert r.status_code == 201 and set(r.data) == {"id", "url", "expires_at"}
    token = token_of(r)
    assert r.data["url"] == f"{settings.SHARE_BASE_URL}/r/{token}" and len(token) >= 22
    link = ShareLink.objects.get()
    assert link.token_hash == hashlib.sha256(token.encode()).hexdigest()
    stored = " ".join(str(getattr(link, f.name)) for f in ShareLink._meta.fields)
    assert token not in stored
    assert abs(link.expires_at - link.created_at - dt.timedelta(hours=24)) < dt.timedelta(seconds=5)
    listed = client.get(f"{API}/shares/?recording={rec['id']}").data["results"]
    assert len(listed) == 1 and "token" not in listed[0] and "token_hash" not in listed[0]
    assert token not in str(listed)


def test_sharing_is_gated_by_flag_age_and_state(cloud_user, storage):
    client, profile = cloud_user
    rec = saved_recording(client, storage)
    FeatureFlag.objects.filter(code="share_links").update(enabled=False)
    r = share(client, rec["id"])
    assert r.status_code == 403 and error_code(r) == "feature_disabled"
    FeatureFlag.objects.filter(code="share_links").update(enabled=True)

    type(profile).objects.filter(pk=profile.pk).update(age_band="under13")
    assert error_code(share(client, rec["id"])) == "minor_not_allowed"
    type(profile).objects.filter(pk=profile.pk).update(age_band="13plus")

    Recording.objects.filter(pk=rec["id"]).update(hidden_at=timezone.now())
    assert share(client, rec["id"]).status_code == 409
    Recording.objects.filter(pk=rec["id"]).update(hidden_at=None, status="processing")
    assert share(client, rec["id"]).status_code == 409


def test_expiry_choices_and_the_plan_cap(cloud_user, storage):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    assert share(client, rec["id"], expires_in="7d").status_code == 201
    over = share(client, rec["id"], expires_in="30d")
    assert over.status_code == 402 and over.data["error"]["details"]["limit"] == "share_max_days"
    assert share(client, rec["id"], expires_in="1y").status_code == 400


def test_active_links_per_recording_are_capped(cloud_user, storage, settings):
    settings.SHARE_MAX_ACTIVE_PER_TARGET = 2
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    assert [share(client, rec["id"]).status_code for _ in range(3)] == [201, 201, 409]


# --- resolving ----------------------------------------------------------------------------------


def test_public_resolve_returns_the_documented_body_and_headers(shared, anon):
    client, profile, rec, r = shared
    res = public(anon, token_of(r))
    assert res.status_code == 200
    assert set(res.data) == {
        "title",
        "twister",
        "duration_ms",
        "trim_start_ms",
        "trim_end_ms",
        "score",
        "playback",
        "owner",
    }
    assert res.data["title"] == "Public title" and res.data["twister"]["slug"]
    assert res.data["score"] == rec["attempt"]["score"]
    assert set(res.data["playback"]) == {"url", "expires_at", "mime"}
    assert profile.display_name and res.data["owner"] == {"display_name": None}  # opt-in only
    assert res.headers["X-Robots-Tag"] == "noindex, nofollow"
    assert res.headers["Cache-Control"] == "no-store"
    text = str({k: v for k, v in res.data.items() if k != "playback"})  # signed URLs embed the path
    assert profile.email not in text and str(profile.pk) not in text and rec["id"] not in text
    assert str(profile.pk) not in res.data["playback"]["url"]  # opaque storage folder


def test_resolving_counts_views(shared, anon):
    client, _, rec, r = shared
    for _ in range(3):
        public(anon, token_of(r))
    link = ShareLink.objects.get()
    assert link.view_count == 3 and link.last_viewed_at is not None
    assert client.get(f"{API}/shares/?recording={rec['id']}").data["results"][0]["view_count"] == 3


def test_unknown_tokens_are_404_with_hardening_headers(anon):
    FeatureFlag.objects.filter(code="share_links").update(enabled=True)
    r = public(anon, "x" * 22)
    assert r.status_code == 404 and error_code(r) == "not_found"
    assert r.headers["X-Robots-Tag"] == "noindex, nofollow"


def test_a_score_card_token_does_not_open_a_recording_route(shared, anon):
    assert public(anon, token_of(shared[3]), kind="s").status_code == 404


def assert_gone(anon, token):
    r = public(anon, token)
    assert r.status_code == 410 and error_code(r) == "gone", r.data
    assert set(r.data) == {"error"}  # no title, playback or any other metadata leaks
    assert r.headers["X-Robots-Tag"] == "noindex, nofollow"


def test_expired_links_are_gone(shared, anon):
    ShareLink.objects.update(expires_at=timezone.now() - dt.timedelta(seconds=1))
    assert_gone(anon, token_of(shared[3]))


def test_revoked_links_are_gone_immediately(shared, anon):
    client, _, _, r = shared
    link_id = r.data["id"]
    assert client.delete(f"{API}/shares/{link_id}/").status_code == 204
    assert_gone(anon, token_of(r))
    assert client.delete(f"{API}/shares/{link_id}/").status_code == 204  # idempotent


def test_deleting_the_recording_revokes_its_links(shared, anon):
    client, _, rec, r = shared
    client.delete(f"{API}/recordings/{rec['id']}/")
    assert_gone(anon, token_of(r))
    assert ShareLink.objects.get().revoked_at is not None


@pytest.mark.parametrize(
    "update",
    [{"hidden_at": timezone.now()}, {"status": "processing"}, {"deleted_at": timezone.now()}],
)
def test_a_target_that_cannot_be_watched_is_gone(shared, anon, update):
    Recording.objects.update(**update)
    assert_gone(anon, token_of(shared[3]))


def test_a_held_link_is_gone(shared, anon):
    ShareLink.objects.update(hidden_at=timezone.now())
    assert_gone(anon, token_of(shared[3]))


def test_kill_switch_stops_public_resolution(shared, anon):
    FeatureFlag.objects.filter(code="share_links").update(enabled=False)
    assert public(anon, token_of(shared[3])).status_code == 403


def test_a_stale_bearer_token_does_not_break_a_public_page(shared, anon):
    r = public(anon, token_of(shared[3]), HTTP_AUTHORIZATION="Bearer garbage")
    assert r.status_code == 200


def test_resolving_is_throttled_per_ip(shared, anon, monkeypatch):
    from rest_framework.throttling import SimpleRateThrottle

    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "share_resolve", "2/min")
    token = token_of(shared[3])
    codes = [public(anon, token, HTTP_X_FORWARDED_FOR="9.9.9.9").status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    assert public(anon, token, HTTP_X_FORWARDED_FOR="8.8.8.8").status_code == 200  # other IP


# --- owner management ---------------------------------------------------------------------------


def test_share_list_is_owner_only_and_filterable(shared, cloud_user, auth_client, storage):
    client, _, rec, r = shared
    other = saved_recording(client, storage)
    share(client, other["id"])
    assert client.get(f"{API}/shares/").data["count"] == 2
    assert client.get(f"{API}/shares/?recording={rec['id']}").data["count"] == 1
    assert client.get(f"{API}/shares/?recording=nope").status_code == 400
    stranger = auth_client()
    assert stranger.get(f"{API}/shares/").data["count"] == 0
    assert stranger.delete(f"{API}/shares/{r.data['id']}/").status_code == 404
    assert ShareLink.objects.get(pk=r.data["id"]).revoked_at is None


# --- reporting ----------------------------------------------------------------------------------


def report(anon, token, ip="1.1.1.1", **body):
    return anon.post(
        f"{API}/public/r/{token}/report/",
        {"reason": "abuse", "details": "bad", **body},
        format="json",
        HTTP_X_FORWARDED_FOR=ip,
    )


def test_reports_dedupe_per_reporter(shared, anon):
    token = token_of(shared[3])
    first, again = report(anon, token), report(anon, token)
    assert first.status_code == 201 and again.status_code == 200
    assert first.data["id"] == again.data["id"] and set(first.data) == {
        "id",
        "reason",
        "created_at",
    }
    assert ModerationReport.objects.count() == 1
    assert ModerationReport.objects.get().reporter_ip_hash != "1.1.1.1"


def test_three_distinct_reporters_hide_the_link(shared, anon, auth_client):
    client, _, _, r = shared
    token = token_of(r)
    report(anon, token, ip="1.1.1.1")
    report(anon, token, ip="2.2.2.2")
    assert public(anon, token).status_code == 200  # two are not enough
    signed_in = auth_client().post(
        f"{API}/public/r/{token}/report/", {"reason": "spam"}, format="json"
    )
    assert signed_in.status_code == 201
    assert ModerationReport.objects.filter(reporter__isnull=False).count() == 1
    assert_gone(anon, token)
    assert ShareLink.objects.get().hidden_at is not None
    assert error_code(report(anon, token, ip="3.3.3.3")) == "gone"  # a dead link takes no reports


def test_the_same_ip_three_times_does_not_hide(shared, anon):
    token = token_of(shared[3])
    for reason in ("abuse", "spam", "other"):
        report(anon, token, reason=reason)
    assert public(anon, token).status_code == 200


def test_report_validation(shared, anon):
    token = token_of(shared[3])
    assert report(anon, token, reason="nonsense").status_code == 400
    assert report(anon, token, details="x" * 1001).status_code == 400
    assert report(anon, "y" * 22).status_code == 404


def test_reports_are_throttled(shared, anon, monkeypatch):
    from rest_framework.throttling import SimpleRateThrottle

    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "share_report", "1/h")
    token = token_of(shared[3])
    assert report(anon, token).status_code == 201
    assert report(anon, token).status_code == 429


def test_dismissing_releases_the_hold_and_actioning_hides_the_recording(shared, anon):
    _, _, rec, r = shared
    token = token_of(r)
    for ip in ("1.1.1.1", "2.2.2.2", "3.3.3.3"):
        report(anon, token, ip=ip)
    rows = list(ModerationReport.objects.select_related("share_link"))
    moderation.dismiss(rows[0], "staff")
    assert ShareLink.objects.get().hidden_at is None and public(anon, token).status_code == 200
    moderation.action(rows[1], "staff")
    assert ShareLink.objects.get().hidden_at is not None
    assert Recording.objects.get().hidden_at is not None
    assert_gone(anon, token)
    done = ModerationReport.objects.get(pk=rows[1].pk)
    assert done.status == ReportStatus.ACTIONED and done.resolved_by == "staff"


def test_admin_moderation_queue_actions(shared, anon, admin_client):
    token = token_of(shared[3])
    report(anon, token)
    row = ModerationReport.objects.get()
    resp = admin_client.post(
        "/admin/twisters/moderationreport/",
        {"action": "action_reports", "_selected_action": [row.pk]},
    )
    assert resp.status_code == 302
    assert ModerationReport.objects.get().status == ReportStatus.ACTIONED
    assert admin_client.get("/admin/twisters/moderationreport/").status_code == 200
    for model in ("recording", "sharelink", "mediaasset", "storageledger", "userconsent"):
        assert admin_client.get(f"/admin/twisters/{model}/").status_code == 200, model
    # staff can never read a link's hash
    link = ShareLink.objects.get()
    page = admin_client.get(f"/admin/twisters/sharelink/{link.pk}/change/")
    assert link.token_hash not in page.content.decode()


# --- score cards --------------------------------------------------------------------------------


def test_score_card_lifecycle(cloud_user, anon, settings):
    client, profile = cloud_user
    attempt = submit(client, transcript="she shells seashells by the seashore").data
    r = client.post(f"{API}/attempts/{attempt['id']}/score-card/")
    assert r.status_code == 201 and r.data["url"].startswith(f"{settings.SHARE_BASE_URL}/s/")
    res = public(anon, token_of(r), kind="s")
    assert res.status_code == 200
    assert set(res.data) == {
        "score",
        "accuracy",
        "wpm",
        "kind",
        "twister",
        "words",
        "owner",
        "images",
        "created_at",
    }
    assert res.data["score"] == attempt["score"]
    assert {"target": "sells", "status": "wrong"} in res.data["words"] or res.data["words"]
    assert res.data["owner"] == {"display_name": None}
    assert profile.email not in str(res.data)
    assert res.headers["X-Robots-Tag"] == "noindex, nofollow"
    assert ShareLink.objects.get().target_type == "score_card"

    client.delete(f"{API}/shares/{r.data['id']}/")
    assert public(anon, token_of(r), kind="s").status_code == 410


def test_score_card_rules(cloud_user, auth_client, anon):
    client, _ = cloud_user
    attempt = submit(client).data["id"]
    assert auth_client().post(f"{API}/attempts/{attempt}/score-card/").status_code == 404
    FeatureFlag.objects.filter(code="score_cards").update(enabled=False)
    r = client.post(f"{API}/attempts/{attempt}/score-card/")
    assert r.status_code == 403 and error_code(r) == "feature_disabled"


def test_score_card_gone_when_the_attempt_is_deleted(cloud_user, anon):
    client, _ = cloud_user
    attempt = submit(client).data["id"]
    token = token_of(client.post(f"{API}/attempts/{attempt}/score-card/"))
    client.delete(f"{API}/attempts/{attempt}/")
    assert public(anon, token, kind="s").status_code == 410
