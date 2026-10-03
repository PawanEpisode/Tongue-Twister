"""Admission of a brand-new account: the single place that decides whether an unknown, token-verified user
may get a Profile. Kept out of `twisters.auth` so authentication stays about *who you are* and this about
*whether we accept a new account*.

A refused sign-up also has its Supabase login removed (best effort), so the refused address is not left
behind as an unconfirmed user that could later be confirmed and retried.
"""

from __future__ import annotations

import logging
import uuid

from . import emailpolicy
from .account.authadmin import AuthAdminError, get_auth_admin
from .models import Profile

log = logging.getLogger(__name__)


def _discard_auth_user(sub: str) -> None:
    try:
        get_auth_admin().delete_user(sub)
    except AuthAdminError:
        log.warning("signup_guard: could not remove refused auth user %s", sub)


def admit_new_account(sub: str | uuid.UUID, email: str) -> str:
    """Return the canonical email to store, or raise the `ApiProblem` explaining the refusal."""
    if emailpolicy.signup_problem(email):
        _discard_auth_user(str(sub))
        raise emailpolicy.email_not_allowed()
    canonical = emailpolicy.canonical_email(email)
    if canonical and Profile.objects.filter(canonical_email=canonical).exclude(pk=sub).exists():
        _discard_auth_user(str(sub))
        raise emailpolicy.email_alias_exists()
    return canonical


def sync_email(profile: Profile, email: str) -> None:
    """Keep a profile's email in step after the person changed it at Supabase (the Account → change email flow).

    Only an address that would be accepted for a new account is recorded. One that would not (a disposable
    domain, or an inbox another account already uses) is logged and ignored: the person keeps their access and
    the stored email stays as it was. Refusing them here would lock a real person out over a list mistake;
    hard enforcement at Supabase itself needs an Auth Hook, which lives outside this codebase.
    """
    email = (email or "").strip()
    if not email or email == profile.email:
        return
    canonical = emailpolicy.canonical_email(email)
    if emailpolicy.signup_problem(email):
        log.warning(
            "signup_guard: ignored email change to a refused address (profile %s)", profile.pk
        )
        return
    if (
        canonical
        and Profile.objects.filter(canonical_email=canonical).exclude(pk=profile.pk).exists()
    ):
        log.warning(
            "signup_guard: ignored email change to an inbox already in use (profile %s)", profile.pk
        )
        return
    Profile.objects.filter(pk=profile.pk).update(email=email, canonical_email=canonical)
    profile.email, profile.canonical_email = email, canonical
