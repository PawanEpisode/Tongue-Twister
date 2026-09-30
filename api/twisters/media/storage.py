"""Object-storage adapter. Everything else in the app talks to `StorageBackend`, never to Supabase.

Two implementations: `SupabaseStorage` (production, service-role key, stdlib HTTP only) and
`InMemoryStorage` (dev and tests, so no test can touch the network). Buckets are private; the only way
to read or write an object is a short-lived URL minted here after the API has authorised the caller.

Security notes: the service-role key and every signed URL/token are secrets. They are never logged
(errors carry an operation name and HTTP status only) and the key is never returned to a client.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass

from django.conf import settings

from .. import errors

log = logging.getLogger(__name__)

BUCKET_RECORDINGS = "recordings"
BUCKET_VOICE = "voice"
BUCKET_THUMBS = "thumbs"
BUCKET_CAPTIONS = "captions"
BUCKETS = (BUCKET_RECORDINGS, BUCKET_VOICE, BUCKET_THUMBS, BUCKET_CAPTIONS)
HTTP_TIMEOUT_S = 15


class StorageError(Exception):
    """The storage service failed or refused. Callers map it to 503 or skip and retry next run."""


@dataclass(frozen=True)
class ObjectStat:
    size: int
    mime_type: str | None = None
    checksum_sha256: str | None = None  # only when the backend can supply it cheaply


@dataclass(frozen=True)
class SignedUpload:
    provider: str
    bucket: str
    path: str
    signed_url: str  # resumable (TUS) endpoint
    token: str
    expires_in: int
    chunk_size: int
    standard_url: str  # single-request upload URL, for small files or clients without TUS

    def as_dict(self) -> dict:
        return {
            "provider": self.provider,
            "bucket": self.bucket,
            "path": self.path,
            "signed_url": self.signed_url,
            "token": self.token,
            "expires_in": self.expires_in,
            "chunk_size": self.chunk_size,
            "standard_url": self.standard_url,
        }


class StorageBackend(ABC):
    provider: str

    @abstractmethod
    def create_upload(
        self, bucket: str, path: str, mime_type: str, ttl_s: int, *, upsert: bool = False
    ) -> SignedUpload:
        """Mint credentials for the client to upload exactly one object at `path`. `upsert` lets the
        holder overwrite an existing object (worker retries re-upload to the same path)."""

    @abstractmethod
    def stat(self, bucket: str, path: str) -> ObjectStat | None:
        """Size/type of the stored object, or None when it does not exist."""

    @abstractmethod
    def read_head(self, bucket: str, path: str, length: int) -> bytes:
        """The first `length` bytes (for content sniffing)."""

    @abstractmethod
    def put(self, bucket: str, path: str, data: bytes, mime_type: str) -> None:
        """Server-side write (thumbnails). Overwrites."""

    @abstractmethod
    def signed_url(self, bucket: str, path: str, ttl_s: int) -> str:
        """A read-only URL valid for `ttl_s` seconds."""

    def signed_urls(self, bucket: str, paths: list[str], ttl_s: int) -> dict[str, str]:
        """Batch form; backends with a bulk endpoint override it to avoid one round-trip per row."""
        return {p: self.signed_url(bucket, p, ttl_s) for p in paths}

    @abstractmethod
    def delete(self, bucket: str, path: str) -> None:
        """Remove the object. Deleting a missing object is not an error."""


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --- in-memory (dev, tests) ---------------------------------------------------------------------


class InMemoryStorage(StorageBackend):
    """Dict-backed fake. Tests play the client with `simulate_upload`; URLs are opaque `memory://`."""

    provider = "memory"

    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], tuple[bytes, str]] = {}
        self.fail_next: str | None = None  # set to an operation name to make it raise once

    def _maybe_fail(self, op: str) -> None:
        if self.fail_next == op:
            self.fail_next = None
            raise StorageError(f"{op} failed")

    def simulate_upload(self, bucket: str, path: str, data: bytes, mime_type: str = "") -> None:
        self.objects[(bucket, path)] = (data, mime_type)

    def exists(self, bucket: str, path: str) -> bool:
        return (bucket, path) in self.objects

    def create_upload(self, bucket, path, mime_type, ttl_s, *, upsert=False):
        self._maybe_fail("create_upload")
        token = f"memtoken-{sha256_hex(f'{bucket}/{path}'.encode())[:16]}"
        return SignedUpload(
            provider=self.provider,
            bucket=bucket,
            path=path,
            signed_url="memory://upload/resumable",
            token=token,
            expires_in=ttl_s,
            chunk_size=settings.UPLOAD_CHUNK_BYTES,
            standard_url=f"memory://upload/{bucket}/{path}?token={token}",
        )

    def stat(self, bucket, path):
        self._maybe_fail("stat")
        found = self.objects.get((bucket, path))
        if found is None:
            return None
        data, mime = found
        return ObjectStat(len(data), mime or None, sha256_hex(data))

    def read_head(self, bucket, path, length):
        self._maybe_fail("read_head")
        found = self.objects.get((bucket, path))
        if found is None:
            raise StorageError("read_head: not found")
        return found[0][:length]

    def put(self, bucket, path, data, mime_type):
        self._maybe_fail("put")
        self.objects[(bucket, path)] = (data, mime_type)

    def signed_url(self, bucket, path, ttl_s):
        self._maybe_fail("signed_url")
        return f"memory://{bucket}/{path}?exp={int(time.time()) + ttl_s}"

    def delete(self, bucket, path):
        self._maybe_fail("delete")
        self.objects.pop((bucket, path), None)


# --- Supabase Storage ---------------------------------------------------------------------------

Transport = Callable[[urllib.request.Request], tuple[int, dict[str, str], bytes]]


def _urllib_transport(request: urllib.request.Request) -> tuple[int, dict[str, str], bytes]:
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_S) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers or {}), exc.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise StorageError("network error") from exc  # never include the URL: it may carry a token


class SupabaseStorage(StorageBackend):
    """Supabase Storage REST API (`/storage/v1`), authenticated with the service-role key.

    `transport` is injectable so the request shapes are unit-tested without a network.
    """

    provider = "supabase"

    def __init__(self, base_url: str, service_key: str, transport: Transport = _urllib_transport):
        if not base_url or not service_key:
            raise errors.dependency_unavailable("Media storage is not configured.")
        self.api = f"{base_url.rstrip('/')}/storage/v1"
        self._key = service_key
        self._transport = transport

    # -- plumbing ------------------------------------------------------------------------------

    @staticmethod
    def _object(bucket: str, path: str) -> str:
        return f"{urllib.parse.quote(bucket, safe='')}/{urllib.parse.quote(path, safe='/')}"

    def _call(
        self,
        method: str,
        endpoint: str,
        *,
        op: str,
        body: bytes | None = None,
        json_body: dict | None = None,
        headers: dict[str, str] | None = None,
        ok: tuple[int, ...] = (200,),
    ) -> tuple[int, dict[str, str], bytes]:
        merged = {"Authorization": f"Bearer {self._key}", "apikey": self._key, **(headers or {})}
        if json_body is not None:
            body = json.dumps(json_body).encode()
            merged["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.api}/{endpoint}", data=body, method=method, headers=merged
        )
        status, resp_headers, payload = self._transport(request)
        if status not in ok and status != 404:
            log.warning("storage.%s failed status=%s", op, status)
            raise StorageError(f"{op} failed ({status})")
        return status, resp_headers, payload

    def _json(self, payload: bytes, op: str) -> dict:
        try:
            data = json.loads(payload or b"{}")
        except ValueError as exc:
            raise StorageError(f"{op}: invalid response") from exc
        if not isinstance(data, dict):
            raise StorageError(f"{op}: invalid response")
        return data

    # -- StorageBackend ------------------------------------------------------------------------

    def create_upload(self, bucket, path, mime_type, ttl_s, *, upsert=False):
        status, _, payload = self._call(
            "POST",
            f"object/upload/sign/{self._object(bucket, path)}",
            op="create_upload",
            json_body={},
            headers={"x-upsert": "true"} if upsert else None,
        )
        if status == 404:
            raise StorageError("create_upload: bucket missing")
        signed = self._json(payload, "create_upload")
        query = urllib.parse.parse_qs(urllib.parse.urlparse(signed.get("url", "")).query)
        token = (query.get("token") or [""])[0]
        if not token:
            raise StorageError("create_upload: no token")
        return SignedUpload(
            provider=self.provider,
            bucket=bucket,
            path=path,
            signed_url=f"{self.api}/upload/resumable",
            token=token,
            expires_in=min(ttl_s, 7200),  # Supabase signed upload tokens live 2 h
            chunk_size=settings.UPLOAD_CHUNK_BYTES,
            standard_url=f"{self.api}/object/upload/sign/{self._object(bucket, path)}?token={token}",
        )

    def stat(self, bucket, path):
        status, _, payload = self._call(
            "GET", f"object/info/{self._object(bucket, path)}", op="stat"
        )
        if status == 404:
            return None
        info = self._json(payload, "stat")
        size = info.get("size")
        if size is None:
            size = (info.get("metadata") or {}).get("size")
        if not isinstance(size, int):
            raise StorageError("stat: no size")
        mime = info.get("contentType") or (info.get("metadata") or {}).get("mimetype")
        return ObjectStat(size, mime)

    def read_head(self, bucket, path, length):
        status, _, payload = self._call(
            "GET",
            f"object/{self._object(bucket, path)}",
            op="read_head",
            headers={"Range": f"bytes=0-{length - 1}"},
            ok=(200, 206),
        )
        if status == 404:
            raise StorageError("read_head: not found")
        return payload[:length]

    def put(self, bucket, path, data, mime_type):
        self._call(
            "POST",
            f"object/{self._object(bucket, path)}",
            op="put",
            body=data,
            headers={"Content-Type": mime_type, "x-upsert": "true"},
        )

    def _absolute(self, signed_path: str) -> str:
        return f"{self.api}{signed_path}" if signed_path.startswith("/") else signed_path

    def signed_url(self, bucket, path, ttl_s):
        status, _, payload = self._call(
            "POST",
            f"object/sign/{self._object(bucket, path)}",
            op="signed_url",
            json_body={"expiresIn": ttl_s},
        )
        if status == 404:
            raise StorageError("signed_url: not found")
        signed = self._json(payload, "signed_url").get("signedURL")
        if not signed:
            raise StorageError("signed_url: no url")
        return self._absolute(signed)

    def signed_urls(self, bucket, paths, ttl_s):
        if not paths:
            return {}
        _, _, payload = self._call(
            "POST",
            f"object/sign/{urllib.parse.quote(bucket, safe='')}",
            op="signed_urls",
            json_body={"expiresIn": ttl_s, "paths": paths},
        )
        try:
            rows = json.loads(payload or b"[]")
        except ValueError as exc:
            raise StorageError("signed_urls: invalid response") from exc
        return {
            row["path"]: self._absolute(row["signedURL"])
            for row in rows
            if isinstance(row, dict) and row.get("signedURL") and row.get("path")
        }

    def delete(self, bucket, path):
        self._call("DELETE", f"object/{self._object(bucket, path)}", op="delete")


# --- factory ------------------------------------------------------------------------------------

_instances: dict[str, StorageBackend] = {}


def get_storage() -> StorageBackend:
    """The configured backend, one shared instance per backend name (the in-memory fake must persist
    across calls within a process; Supabase is stateless)."""
    name = settings.MEDIA_STORAGE_BACKEND
    if name not in _instances:
        if name == "memory":
            _instances[name] = InMemoryStorage()
        elif name == "supabase":
            _instances[name] = SupabaseStorage(
                settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY
            )
        else:
            raise errors.dependency_unavailable("Unknown media storage backend.")
    return _instances[name]


def reset_storage() -> None:
    """Forget cached backends (tests)."""
    _instances.clear()
