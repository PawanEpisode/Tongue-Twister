"""Who may open a new account: the server-side email rules, so they cannot be skipped from the browser.

Sign-up itself happens at Supabase, so these run where we first see the account (`twisters.signup_guard`, called
from `twisters.auth`). Existing profiles are never re-checked, so tightening a rule cannot lock anyone out.

Pure functions only: no database, no network. The web app mirrors the disposable list for instant feedback
(`web/src/lib/disposableDomains.json`, generated from the file this module reads; a web test fails on drift).
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from . import errors

_DATA = Path(__file__).parent / "data" / "disposable_email_domains.json"
_DOMAIN = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
_LOCAL = re.compile(r"^[^\s@]{1,64}$")
MAX_EMAIL_LEN = 254

# Providers where "name+anything@" and (for Gmail only) dots in the name reach the same inbox. Everywhere
# else a "+" or "." may be a real, different address, so it is left alone.
_PLUS_ALIAS_DOMAINS = frozenset(
    {
        "gmail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com",
        "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me", "fastmail.com",
    }
)  # fmt: skip
_DOMAIN_SYNONYMS = {"googlemail.com": "gmail.com"}
_DOT_INSENSITIVE_DOMAINS = frozenset({"gmail.com"})


@lru_cache(maxsize=1)
def disposable_domains() -> frozenset[str]:
    """Throwaway-inbox providers: a new "account" per mail here is how free quotas get farmed."""
    return frozenset(d.lower() for d in json.loads(_DATA.read_text(encoding="utf-8"))["domains"])


def is_disposable(domain: str) -> bool:
    """True for a listed domain or any subdomain of one ("x.mailinator.com")."""
    parts = domain.lower().rstrip(".").split(".")
    listed = disposable_domains()
    return any(".".join(parts[i:]) in listed for i in range(len(parts) - 1))


def signup_problem(email: str) -> str | None:
    """Why this address may not open a new account, or None when it may. An empty address is let through:
    some providers hand over no email, and refusing those would lock out real people."""
    email = (email or "").strip().lower()
    if not email:
        return None
    local, sep, domain = email.rpartition("@")
    if (
        not sep
        or not _LOCAL.match(local)
        or len(email) > MAX_EMAIL_LEN
        or not _DOMAIN.match(domain)
    ):
        return "invalid"
    if is_disposable(domain):
        return "disposable"
    return None


def canonical_email(email: str) -> str:
    """The one spelling that stands for an inbox: "J.Doe+x@googlemail.com" and "jdoe@gmail.com" are the same
    person. Used only to spot a second account opened from an alias, never to change what the person typed.
    An address we cannot parse maps to "" (which never matches anything)."""
    email = (email or "").strip().lower()
    local, sep, domain = email.rpartition("@")
    if not sep or not local or not domain:
        return ""
    domain = _DOMAIN_SYNONYMS.get(domain, domain)
    if domain in _PLUS_ALIAS_DOMAINS:
        local = local.split("+", 1)[0]
    if domain in _DOT_INSENSITIVE_DOMAINS:
        local = local.replace(".", "")
    return f"{local}@{domain}" if local else ""


def email_not_allowed() -> errors.ApiProblem:
    return errors.ApiProblem(
        403,
        "email_not_allowed",
        "Please sign up with a permanent email address, not a disposable one.",
    )


def email_alias_exists() -> errors.ApiProblem:
    return errors.ApiProblem(
        409,
        "email_alias_exists",
        "An account already exists for this inbox. Sign in with the address you first used.",
    )
