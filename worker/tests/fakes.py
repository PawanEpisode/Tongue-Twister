"""Test doubles: a fake object store over httpx.MockTransport and a fake ffmpeg runner."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from twister_worker.ffmpeg import CommandResult

PROBE = json.dumps(
    {
        "streams": [
            {"codec_type": "video", "codec_name": "vp8", "width": 640, "height": 360},
            {"codec_type": "audio"},
        ],
        "format": {"duration": "4.0", "format_name": "matroska,webm"},
    }
)


class FakeStore:
    """Serves the source on GET and records PUT uploads by URL path."""

    def __init__(self, source: bytes = b"S" * 1000, fail_puts: int = 0) -> None:
        self.source = source
        self.uploads: dict[str, bytes] = {}
        self.fail_puts = fail_puts
        self.gets = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            self.gets += 1
            return httpx.Response(200, content=self.source)
        body = request.read()
        if self.fail_puts > 0:
            self.fail_puts -= 1
            return httpx.Response(503)
        self.uploads[request.url.path] = body
        return httpx.Response(200)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self))


def fake_run(ctx_self, argv: list[str]) -> CommandResult:  # bound as JobContext.run
    if argv[0] == "ffprobe":
        return CommandResult(PROBE, "")
    Path(argv[-1]).write_bytes(b"OUT:" + Path(argv[0]).name.encode())
    return CommandResult("", "")
