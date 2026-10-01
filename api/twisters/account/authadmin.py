"""Supabase Auth Admin adapter: the one call account deletion needs, `DELETE /auth/v1/admin/users/{id}`.

A tiny stdlib client in the style of `media.storage.SupabaseStorage`, with an injectable transport so
the request shape is unit-tested without a network. The service-role key is a secret: it is never
logged, never returned, and error messages carry the operation and HTTP status only.
"""

from __future__ import annotations

import logging
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from typing import Protocol

from django.conf import settings

log = logging.getLogger(__name__)

HTTP_TIMEOUT_S = 15
# 200/204 = deleted; 404 = already gone (a retry after a half-finished purge), which is the goal state.
DELETED_STATUSES = frozenset({200, 204, 404})

Transport = Callable[[urllib.request.Request], int]


class AuthAdminError(Exception):
    """Supabase refused or could not be reached; the caller keeps the account pending and retries."""


class AuthAdminPort(Protocol):
    def delete_user(self, user_id: uuid.UUID | str) -> None: ...


def _urllib_transport(request: urllib.request.Request) -> int:
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_S) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise AuthAdminError("network error") from exc  # never include the URL or headers


class SupabaseAuthAdmin:
    def __init__(self, base_url: str, service_key: str, transport: Transport = _urllib_transport):
        self._endpoint = f"{base_url.rstrip('/')}/auth/v1/admin/users"
        self._key = service_key
        self._transport = transport

    def delete_user(self, user_id: uuid.UUID | str) -> None:
        request = urllib.request.Request(
            f"{self._endpoint}/{urllib.parse.quote(str(user_id), safe='')}",
            method="DELETE",
            headers={"Authorization": f"Bearer {self._key}", "apikey": self._key},
        )
        status = self._transport(request)
        if status not in DELETED_STATUSES:
            log.warning("authadmin.delete_user failed status=%s", status)
            raise AuthAdminError(f"delete_user failed ({status})")


class UnconfiguredAuthAdmin:
    """Used when there is no service-role key (local development): deleting the local data still works,
    the Supabase login is simply left behind, and the log says so."""

    def delete_user(self, user_id: uuid.UUID | str) -> None:
        log.warning(
            "authadmin.skipped: SUPABASE_SERVICE_ROLE_KEY is not set; auth user not deleted"
        )


def get_auth_admin() -> AuthAdminPort:
    if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        return SupabaseAuthAdmin(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
    return UnconfiguredAuthAdmin()
