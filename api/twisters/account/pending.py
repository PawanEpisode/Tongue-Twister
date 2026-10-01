"""What an account that is pending deletion (D21) may do.

Everything read-only keeps working, so a person can still see their data, export it and change their
mind. Of the writes only two survive: asking again (idempotent) and cancelling. Everything else is
refused with `403 account_pending_deletion`. The check runs in the one authentication step
(`twisters.auth`), so no view can forget it.
"""

from rest_framework.permissions import SAFE_METHODS
from rest_framework.request import Request

from .. import errors
from ..models import Profile

# (method, url name) pairs; the names are given to the routes in `twisters/urls.py`.
ALLOWED_WRITES = frozenset({("DELETE", "me"), ("DELETE", "me-deletion")})


def may_proceed(request: Request) -> bool:
    if request.method in SAFE_METHODS:
        return True
    match = request.resolver_match
    return (request.method, match.url_name if match else None) in ALLOWED_WRITES


def guard(request: Request, profile: Profile) -> None:
    """Raise `account_pending_deletion` when a pending profile attempts a blocked write."""
    if profile.pending_deletion and not may_proceed(request):
        raise errors.account_pending_deletion(profile.deletion_scheduled_for)
