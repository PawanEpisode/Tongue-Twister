import threading

import httpx
import pytest

from tests.conftest import job_payload
from twister_worker import transfer
from twister_worker.api_client import ApiClient, ApiError
from twister_worker.errors import Cancelled, JobFailed
from twister_worker.models import Job, OutputTarget
from twister_worker.signing import SIGNATURE_HEADER, sign

NOCANCEL = threading.Event()
KW = dict(timeout_s=5, attempts=3, cancel=NOCANCEL)


def client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


# -- download ---------------------------------------------------------------------------------
def test_download_streams_to_file(tmp_path):
    http = client(lambda r: httpx.Response(200, content=b"x" * 5000))
    assert transfer.download(http, "https://s/x", tmp_path / "f", max_bytes=10_000, **KW) == 5000
    assert (tmp_path / "f").stat().st_size == 5000


def test_download_cap_by_header_and_by_stream(tmp_path):
    http = client(lambda r: httpx.Response(200, content=b"x" * 5000))
    with pytest.raises(JobFailed) as err:
        transfer.download(http, "https://s/x", tmp_path / "f", max_bytes=100, **KW)
    assert err.value.code == "source_too_large"

    def chunked(request):
        return httpx.Response(200, stream=httpx.ByteStream(b"y" * 4000))

    http2 = client(chunked)
    with pytest.raises(JobFailed):
        transfer.download(http2, "https://s/x", tmp_path / "g", max_bytes=1000, **KW)


def test_download_retries_5xx_but_not_403(tmp_path, monkeypatch):
    monkeypatch.setattr("twister_worker.retry.time.sleep", lambda _: None)
    statuses = [503, 200]
    http = client(lambda r: httpx.Response(statuses.pop(0), content=b"ok"))
    assert transfer.download(http, "https://s/x", tmp_path / "f", max_bytes=10, **KW) == 2
    forbidden = client(lambda r: httpx.Response(403))
    with pytest.raises(JobFailed) as err:
        transfer.download(forbidden, "https://s/x", tmp_path / "f", max_bytes=10, **KW)
    assert err.value.code == "source_download_failed"


def test_download_network_errors_become_job_failed(tmp_path, monkeypatch):
    monkeypatch.setattr("twister_worker.retry.time.sleep", lambda _: None)

    def boom(request):
        raise httpx.ConnectError("no route")

    with pytest.raises(JobFailed) as err:
        transfer.download(client(boom), "https://s/x", tmp_path / "f", max_bytes=10, **KW)
    assert err.value.code == "source_download_failed"


def test_download_honours_cancel(tmp_path):
    cancel = threading.Event()
    cancel.set()
    http = client(lambda r: httpx.Response(200, content=b"abc"))
    with pytest.raises(Cancelled):
        transfer.download(
            http,
            "https://s/x",
            tmp_path / "f",
            max_bytes=10,
            timeout_s=1,
            attempts=2,
            cancel=cancel,
        )


# -- upload -----------------------------------------------------------------------------------
TARGET = OutputTarget("p/o.mp4", "https://s/up", "tok", "video/mp4")


def test_upload_sends_bytes_with_headers(tmp_path):
    src = tmp_path / "o.mp4"
    src.write_bytes(b"abc" * 100)
    seen = {}

    def handler(request):
        seen["body"] = request.read()
        seen["headers"] = request.headers
        seen["method"] = request.method
        return httpx.Response(200)

    assert transfer.upload(client(handler), TARGET, src, max_bytes=1000, **KW) == 300
    assert seen["body"] == b"abc" * 100 and seen["method"] == "PUT"
    assert seen["headers"]["content-type"] == "video/mp4"
    assert seen["headers"]["content-length"] == "300"
    assert "authorization" not in seen["headers"]  # the signed URL carries the token


def test_upload_refuses_oversized_and_empty(tmp_path):
    big, empty = tmp_path / "big", tmp_path / "empty"
    big.write_bytes(b"x" * 50)
    empty.write_bytes(b"")
    http = client(lambda r: pytest.fail("must not send"))
    with pytest.raises(JobFailed) as too_big:
        transfer.upload(http, TARGET, big, max_bytes=10, **KW)
    assert too_big.value.code == "output_too_large"
    with pytest.raises(JobFailed) as none:
        transfer.upload(http, TARGET, empty, max_bytes=10, **KW)
    assert none.value.code == "output_empty"


def test_upload_retries_then_fails(tmp_path, monkeypatch):
    monkeypatch.setattr("twister_worker.retry.time.sleep", lambda _: None)
    src = tmp_path / "o"
    src.write_bytes(b"data")
    calls = []

    def handler(request):
        request.read()
        calls.append(1)
        return httpx.Response(502)

    with pytest.raises(JobFailed) as err:
        transfer.upload(client(handler), TARGET, src, max_bytes=100, **KW)
    assert err.value.code == "upload_failed" and len(calls) == 3
    with pytest.raises(JobFailed):
        transfer.upload(
            client(lambda r: (r.read(), httpx.Response(400))[1]), TARGET, src, max_bytes=100, **KW
        )


# -- API client -------------------------------------------------------------------------------
def api(settings, handler):
    return ApiClient(settings, client(handler))


def test_claim_signs_body_and_parses_job(settings):
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["body"] = request.content
        seen["sig"] = request.headers[SIGNATURE_HEADER]
        return httpx.Response(200, json={"job": job_payload()})

    job = api(settings, handler).claim()
    assert isinstance(job, Job) and job.id == "job-1"
    assert seen["url"] == "https://api.test/api/v1/internal/media/claim/"
    assert seen["sig"] == "sha256=" + sign("s3cret", seen["body"])
    assert seen["body"] == b"{}"


def test_claim_empty_queue(settings):
    assert api(settings, lambda r: httpx.Response(200, json={"job": None})).claim() is None


def test_claim_retries_5xx_then_raises_on_4xx(settings, monkeypatch):
    monkeypatch.setattr("twister_worker.retry.time.sleep", lambda _: None)
    codes = [500, 200]
    ok = api(settings, lambda r: httpx.Response(codes.pop(0), json={"job": None}))
    assert ok.claim() is None
    with pytest.raises(ApiError) as err:
        api(settings, lambda r: httpx.Response(403)).claim()
    assert err.value.status == 403


def test_heartbeat_semantics(settings, monkeypatch):
    monkeypatch.setattr("twister_worker.retry.time.sleep", lambda _: None)
    assert api(settings, lambda r: httpx.Response(200, json={})).heartbeat("job-1") is True
    assert api(settings, lambda r: httpx.Response(409)).heartbeat("job-1") is False
    assert api(settings, lambda r: httpx.Response(410)).heartbeat("job-1") is False
    assert api(settings, lambda r: httpx.Response(503)).heartbeat("job-1") is True

    def down(request):
        raise httpx.ConnectError("x")

    assert api(settings, down).heartbeat("job-1") is True


def test_report_posts_signed_payload_to_asset_url(settings):
    seen = {}

    def handler(request):
        seen.update(
            url=request.url.path, body=request.content, sig=request.headers[SIGNATURE_HEADER]
        )
        return httpx.Response(200, json={})

    api(settings, handler).report("asset-1", {"status": "ready", "job_id": "job-1"})
    assert seen["url"] == "/api/v1/internal/media/asset-1/processed/"
    assert seen["sig"] == "sha256=" + sign("s3cret", seen["body"])
