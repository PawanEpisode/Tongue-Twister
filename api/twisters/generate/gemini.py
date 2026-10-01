"""Google Gemini over REST (D24): stdlib `urllib`, no SDK, an injectable transport for tests.

One request = one `generateContent` call with structured JSON output. A 5xx, a network error or a
timeout is retried once; anything else that is not a 200 is `GeneratorUnavailable`. The API key travels
in a header (never in the URL, which proxies and logs keep), and neither it nor the user's text is ever
logged: log lines carry lengths and status codes only.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable

from django.conf import settings

from . import prompts
from .drafts import Draft, GenerationBlocked, GeneratorUnavailable

log = logging.getLogger(__name__)

BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
MAX_ATTEMPTS = 2  # the request and one retry
MAX_OUTPUT_TOKENS = 400
TEMPERATURE = 1.0
HARM_CATEGORIES = (
    "HARM_CATEGORY_HARASSMENT",
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    "HARM_CATEGORY_DANGEROUS_CONTENT",
)
SAFETY_SETTINGS = [
    {"category": category, "threshold": "BLOCK_MEDIUM_AND_ABOVE"} for category in HARM_CATEGORIES
]

Response = tuple[int, bytes]
Transport = Callable[[urllib.request.Request, float], Response]


class TransportError(Exception):
    """The request never produced an HTTP answer (timeout, DNS, connection reset)."""


def urllib_transport(request: urllib.request.Request, timeout: float) -> Response:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, b""
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise TransportError(type(exc).__name__) from exc  # never the URL or headers


class GeminiGenerator:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        timeout: float = 10.0,
        transport: Transport = urllib_transport,
    ):
        self._api_key = api_key
        self._model = model
        self._timeout = timeout
        self._transport = transport

    def generate(self, topic: str, difficulty: int, language: str) -> Draft:
        body = self._body(topic, difficulty)
        data = self._call(body)
        return self._parse(data)

    def _body(self, topic: str, difficulty: int) -> bytes:
        return json.dumps(
            {
                "systemInstruction": {"parts": [{"text": prompts.SYSTEM_INSTRUCTION}]},
                "contents": [
                    {"role": "user", "parts": [{"text": prompts.user_prompt(topic, difficulty)}]}
                ],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": prompts.RESPONSE_SCHEMA,
                    "temperature": TEMPERATURE,
                    "maxOutputTokens": MAX_OUTPUT_TOKENS,
                },
                "safetySettings": SAFETY_SETTINGS,
            }
        ).encode()

    def _request(self, body: bytes) -> urllib.request.Request:
        model = urllib.parse.quote(self._model, safe="")
        return urllib.request.Request(
            f"{BASE_URL}/{model}:generateContent",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", "x-goog-api-key": self._api_key},
        )

    def _call(self, body: bytes) -> dict:
        status = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                status, payload = self._transport(self._request(body), self._timeout)
            except TransportError as exc:
                log.warning("gemini.network_error attempt=%d kind=%s", attempt, exc)
                continue
            if status >= 500:
                log.warning("gemini.server_error attempt=%d status=%s", attempt, status)
                continue
            if status != 200:
                log.warning(
                    "gemini.refused status=%s", status
                )  # 4xx: key, quota or request problem
                raise GeneratorUnavailable(f"status {status}")
            try:
                data = json.loads(payload)
            except ValueError:
                data = None
            if not isinstance(data, dict):
                raise GenerationBlocked("malformed_output")
            return data
        raise GeneratorUnavailable(f"gave up after {MAX_ATTEMPTS} attempts (last status {status})")

    @staticmethod
    def _parse(data: dict) -> Draft:
        if (data.get("promptFeedback") or {}).get("blockReason"):
            raise GenerationBlocked("provider_blocked")
        candidates = data.get("candidates") or []
        if not candidates:
            raise GenerationBlocked("empty_output")
        candidate = candidates[0]
        if candidate.get("finishReason") in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"):
            raise GenerationBlocked("provider_blocked")
        try:
            parts = candidate["content"]["parts"]
            result = json.loads("".join(part.get("text", "") for part in parts))
            text = result["text"]
        except (KeyError, TypeError, ValueError, AttributeError):
            raise GenerationBlocked("malformed_output") from None
        tip, sounds = result.get("tip", ""), result.get("focus_sounds", [])
        if not isinstance(text, str) or not isinstance(tip, str) or not isinstance(sounds, list):
            raise GenerationBlocked("malformed_output")
        return Draft(text=text, tip=tip, focus_sounds=[s for s in sounds if isinstance(s, str)])


def from_settings(transport: Transport = urllib_transport) -> GeminiGenerator:
    if not settings.GEMINI_API_KEY:
        raise GeneratorUnavailable("GEMINI_API_KEY is not set")
    return GeminiGenerator(
        settings.GEMINI_API_KEY,
        settings.GEMINI_MODEL,
        timeout=settings.GEMINI_TIMEOUT_S,
        transport=transport,
    )
