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
