"""Uniform error envelope (API contract 07 §1): {"error": {code, message, details, request_id}}."""

from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.views import exception_handler as drf_exception_handler

CODES = {
    status.HTTP_400_BAD_REQUEST: "bad_request",
    status.HTTP_401_UNAUTHORIZED: "unauthenticated",
    status.HTTP_403_FORBIDDEN: "forbidden",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_410_GONE: "gone",
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: "too_large",
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
}


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The resource changed since you last loaded it."
    default_code = "conflict"


def _message(data) -> str:
    return str(data["detail"]) if isinstance(data, dict) and "detail" in data else "Request failed."


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None  # unhandled → Django's 500 (never leak internals)
    if isinstance(exc, ValidationError):
        code, message, details = "validation_error", "Some fields are invalid.", response.data
    else:
        code, message, details = (
            CODES.get(response.status_code, "error"),
            _message(response.data),
            {},
        )
    request = context.get("request")
    response.data = {
        "error": {
            "code": code,
            "message": message,
            "details": details,
            "request_id": getattr(request, "request_id", None),
        }
    }
    return response
