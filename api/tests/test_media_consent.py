"""Consent log, age band and the gates that depend on them (spec 13 §1)."""

import pytest

from twisters.models import AgeBand, ConsentType, UserConsent

from .media_helpers import API, create_recording, error_code
from .speak_helpers import submit

CONSENTS = f"{API}/me/consents/"


def grant(client, type="recording_upload", version="v1"):
    return client.post(CONSENTS, {"type": type, "version": version}, format="json")


def test_grant_is_idempotent_and_hashes_the_ip(user):
    client, profile = user
    first = grant(client)
    again = grant(client)
    assert first.status_code == 201 and again.status_code == 200
    assert again.headers["Idempotent-Replay"] == "true"
    assert first.data["type"] == "recording_upload" and first.data["current"] is True
    row = UserConsent.objects.get(profile=profile)
    assert len(row.ip_hash) == 64 and "127.0.0.1" not in row.ip_hash
    assert UserConsent.objects.filter(profile=profile).count() == 1


@pytest.mark.parametrize(
    "body",
    [{"type": "recording_upload", "version": "v9"}, {"type": "nope", "version": "v1"}, {}],
)
def test_unknown_type_or_version_is_a_validation_error(user, body):
    client, _ = user
    r = client.post(CONSENTS, body, format="json")
    assert r.status_code == 400 and error_code(r) == "validation_error"


def test_a_new_version_retires_the_old_row_but_keeps_the_log(user, settings):
    client, profile = user
    grant(client)
    settings.CONSENT_VERSIONS = {**settings.CONSENT_VERSIONS, "recording_upload": "v2"}
    listed = client.get(CONSENTS).data
    assert listed["results"][0]["current"] is False
    assert listed["current_versions"]["recording_upload"] == "v2"
    assert grant(client, version="v2").status_code == 201
    rows = UserConsent.objects.filter(profile=profile).order_by("granted_at")
    assert [r.version for r in rows] == ["v1", "v2"]
    assert rows[0].revoked_at is not None and rows[1].revoked_at is None


def test_revoke_stamps_the_row_and_reports_the_purge_time(user):
    client, profile = user
    grant(client)
    r = client.delete(f"{CONSENTS}recording_upload/")
    assert r.status_code == 200 and r.data["revoked_at"] and r.data["purge_at"]
    assert UserConsent.objects.get(profile=profile).revoked_at is not None
    assert client.get(CONSENTS).data["results"] == []
    again = client.delete(f"{CONSENTS}recording_upload/")
    assert again.status_code == 200 and again.data["revoked_at"] is None


def test_revoking_an_unknown_type_is_404(user):
    assert user[0].delete(f"{CONSENTS}bogus/").status_code == 404


def test_consents_need_a_login(anon):
    assert anon.get(CONSENTS).status_code == 401


def test_age_band_can_be_set_once(user):
    client, _ = user
    assert client.get(f"{API}/me/").data["age_band"] == "unknown"
    assert client.patch(f"{API}/me/", {"age_band": "13plus"}, format="json").status_code == 200
    assert client.patch(f"{API}/me/", {"age_band": "13plus"}, format="json").status_code == 200
    r = client.patch(f"{API}/me/", {"age_band": "under13"}, format="json")
    assert r.status_code == 409 and error_code(r) == "conflict"
    assert client.get(f"{API}/me/").data["age_band"] == "13plus"


def test_age_band_rejects_unknown_values(user):
    assert user[0].patch(f"{API}/me/", {"age_band": "teen"}, format="json").status_code == 400


def test_cloud_gates_run_in_order_flag_age_consent(user):
    client, profile = user
    r = create_recording(client)
    assert r.status_code == 403 and error_code(r) == "feature_disabled"

    from twisters.models import FeatureFlag

    FeatureFlag.objects.filter(code="record_cloud").update(enabled=True)
    assert error_code(create_recording(client)) == "age_required"

    type(profile).objects.filter(pk=profile.pk).update(age_band=AgeBand.UNDER13)
    r = create_recording(client)
    assert r.status_code == 403 and error_code(r) == "minor_not_allowed"

    type(profile).objects.filter(pk=profile.pk).update(age_band=AgeBand.ADULT)
    r = create_recording(client)
    assert r.status_code == 403 and error_code(r) == "consent_required"

    grant(client)
    assert create_recording(client).status_code == 201


def test_an_outdated_consent_version_is_not_enough(cloud_user, settings):
    client, _ = cloud_user
    settings.CONSENT_VERSIONS = {**settings.CONSENT_VERSIONS, "recording_upload": "v2"}
    assert error_code(create_recording(client)) == "consent_required"


def test_audio_donation_needs_model_improvement_consent(user):
    client, _ = user
    attempt = submit(client).data["id"]
    url = f"{API}/attempts/{attempt}/words/0/feedback/"
    body = {"judged_correct": True, "donated_audio": True}
    assert error_code(client.post(url, body, format="json")) == "consent_required"
    grant(client, "model_improvement")
    r = client.post(url, body, format="json")
    assert r.status_code == 201 and r.data["donated_audio"] is True


def test_minors_cannot_donate_audio(user):
    client, profile = user
    grant(client, "model_improvement")
    type(profile).objects.filter(pk=profile.pk).update(age_band=AgeBand.UNDER13)
    attempt = submit(client).data["id"]
    r = client.post(
        f"{API}/attempts/{attempt}/words/0/feedback/",
        {"judged_correct": True, "donated_audio": True},
        format="json",
    )
    assert r.status_code == 403 and error_code(r) == "minor_not_allowed"


def test_consent_types_match_the_erd():
    assert set(ConsentType.values) == {
        "recording_upload",
        "voice_storage",
        "voice_processing",
        "model_improvement",
        "terms",
        "marketing",
    }
