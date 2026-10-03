import json
import uuid

import jwt
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from tests.conftest import SECRET
from twisters import emailpolicy
from twisters.models import Profile


def client_for(email: str, sub: str | None = None) -> APIClient:
    token = jwt.encode(
        {"sub": sub or str(uuid.uuid4()), "aud": "authenticated", "email": email},
        SECRET,
        algorithm="HS256",
    )
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


@pytest.mark.parametrize(
    "email",
    ["a@b.co", "First.Last+tag@Example.com", "x@mail.example.co.uk", "  pad@gmail.com  ", ""],
)
def test_allows_real_addresses_and_missing_email(email):
    assert emailpolicy.signup_problem(email) is None


@pytest.mark.parametrize(
    "email",
    [
        "nope",
        "@x.com",
        "a@",
        "a@b",
        "a@b..com",
        "a@-b.com",
        "a b@x.com",
        "a@x.c",
        "a@" + "b" * 64 + ".com",
    ],
)
def test_rejects_malformed(email):
    assert emailpolicy.signup_problem(email) == "invalid"


@pytest.mark.parametrize(
    "email", ["a@mailinator.com", "A@MAILINATOR.COM", "a@sub.yopmail.com", "a@mailinator.com."]
)
def test_rejects_disposable_and_subdomains(email):
    assert emailpolicy.signup_problem(email) in {"disposable", "invalid"}
    assert emailpolicy.signup_problem(email) is not None


def test_does_not_flag_lookalike_domains():
    assert emailpolicy.signup_problem("a@notmailinator.com") is None


@pytest.mark.django_db
def test_new_disposable_account_is_refused_and_no_profile_created():
    sub = str(uuid.uuid4())
    r = client_for("bot@mailinator.com", sub).get("/api/v1/me/")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "email_not_allowed"
    assert not Profile.objects.filter(pk=sub).exists()


@pytest.mark.django_db
def test_existing_profile_is_never_locked_out():
    sub = str(uuid.uuid4())
    Profile.objects.create(id=sub, email="old@mailinator.com", display_name="old")
    assert client_for("old@mailinator.com", sub).get("/api/v1/me/").status_code == 200


@pytest.mark.django_db
def test_normal_new_account_still_works():
    sub = str(uuid.uuid4())
    assert client_for("new@gmail.com", sub).get("/api/v1/me/").status_code == 200
    assert Profile.objects.get(pk=sub).email == "new@gmail.com"


# --- one account per inbox ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "canonical"),
    [
        ("J.Doe+news@Gmail.com", "jdoe@gmail.com"),
        ("jdoe@googlemail.com", "jdoe@gmail.com"),
        ("a.b+c@outlook.com", "a.b@outlook.com"),  # dots count outside Gmail
        ("a+b@icloud.com", "a@icloud.com"),
        ("first.last+x@company.io", "first.last+x@company.io"),  # unknown domain: left alone
        ("+tag@gmail.com", ""),
        ("nope", ""),
        ("", ""),
    ],
)
def test_canonical_email(raw, canonical):
    assert emailpolicy.canonical_email(raw) == canonical


class FakeAuthAdmin:
    def __init__(self, fail=False):
        self.deleted, self.fail = [], fail

    def delete_user(self, user_id):
        if self.fail:
            from twisters.account.authadmin import AuthAdminError

            raise AuthAdminError("boom")
        self.deleted.append(str(user_id))


@pytest.fixture
def auth_admin(monkeypatch):
    fake = FakeAuthAdmin()
    monkeypatch.setattr("twisters.signup_guard.get_auth_admin", lambda: fake)
    return fake


@pytest.mark.django_db
def test_second_account_from_an_alias_is_refused_and_its_login_removed(auth_admin):
    first = str(uuid.uuid4())
    assert client_for("Jane.Doe@gmail.com", first).get("/api/v1/me/").status_code == 200
    assert Profile.objects.get(pk=first).canonical_email == "janedoe@gmail.com"

    second = str(uuid.uuid4())
    r = client_for("janedoe+spam1@gmail.com", second).get("/api/v1/me/")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "email_alias_exists"
    assert not Profile.objects.filter(pk=second).exists()
    assert auth_admin.deleted == [second]


@pytest.mark.django_db
def test_same_person_signing_in_again_is_not_an_alias(auth_admin):
    sub = str(uuid.uuid4())
    assert client_for("jane@gmail.com", sub).get("/api/v1/me/").status_code == 200
    assert client_for("jane+x@gmail.com", sub).get("/api/v1/me/").status_code == 200
    assert auth_admin.deleted == []


@pytest.mark.django_db
def test_refused_disposable_signup_removes_its_login(auth_admin):
    sub = str(uuid.uuid4())
    assert client_for("x@mailinator.com", sub).get("/api/v1/me/").status_code == 403
    assert auth_admin.deleted == [sub]


@pytest.mark.django_db
def test_a_failing_supabase_cleanup_never_changes_the_refusal(monkeypatch):
    monkeypatch.setattr("twisters.signup_guard.get_auth_admin", lambda: FakeAuthAdmin(fail=True))
    r = client_for("x@mailinator.com").get("/api/v1/me/")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "email_not_allowed"


@pytest.mark.django_db
def test_accounts_without_an_email_never_collide(auth_admin):
    for _ in range(2):
        assert client_for("", str(uuid.uuid4())).get("/api/v1/me/").status_code == 200


def test_disposable_list_is_lowercase_and_unique():
    raw = json.loads(emailpolicy._DATA.read_text())["domains"]
    assert raw == sorted(set(d.lower() for d in raw))


# --- the person changed their email at Supabase ---------------------------------------------------------


@pytest.mark.django_db
def test_a_changed_email_is_recorded_with_its_canonical_form(auth_admin):
    sub = str(uuid.uuid4())
    client_for("old@gmail.com", sub).get("/api/v1/me/")
    assert client_for("New.Name+x@gmail.com", sub).get("/api/v1/me/").status_code == 200
    p = Profile.objects.get(pk=sub)
    assert (p.email, p.canonical_email) == ("New.Name+x@gmail.com", "newname@gmail.com")


@pytest.mark.django_db
@pytest.mark.parametrize("new", ["x@mailinator.com", "taken+alias@gmail.com"])
def test_a_refused_email_change_keeps_access_and_the_old_email(auth_admin, new):
    other = str(uuid.uuid4())
    client_for("taken@gmail.com", other).get("/api/v1/me/")
    sub = str(uuid.uuid4())
    client_for("mine@gmail.com", sub).get("/api/v1/me/")
    assert client_for(new, sub).get("/api/v1/me/").status_code == 200  # not locked out
    p = Profile.objects.get(pk=sub)
    assert (p.email, p.canonical_email) == ("mine@gmail.com", "mine@gmail.com")
    assert auth_admin.deleted == []


@pytest.mark.django_db
def test_an_unchanged_email_costs_no_write(auth_admin):
    sub = str(uuid.uuid4())
    c = client_for("same@gmail.com", sub)
    c.get("/api/v1/me/")
    with CaptureQueriesContext(connection) as ctx:
        c.get("/api/v1/me/")
    assert not [q for q in ctx.captured_queries if q["sql"].lstrip().upper().startswith("UPDATE")]
