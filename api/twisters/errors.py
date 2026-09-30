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
    status.HTTP_422_UNPROCESSABLE_ENTITY: "unprocessable",
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
}


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The resource changed since you last loaded it."
    default_code = "conflict"


class ApiProblem(APIException):
    """An error with its own machine-readable `code` (API contract 07 §1 / §13)."""

    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(detail=message, code=code)
        self.status_code = status_code
        self.code = code


def nonce_invalid() -> ApiProblem:
    return ApiProblem(status.HTTP_409_CONFLICT, "nonce_invalid", "This attempt was already used.")


def audio_hash_duplicate() -> ApiProblem:
    return ApiProblem(
        status.HTTP_409_CONFLICT, "audio_hash_duplicate", "This recording was already submitted."
    )


def model_unsupported() -> ApiProblem:
    return ApiProblem(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "model_unsupported",
        "That scoring model is not available; use basic scoring.",
    )


def consent_required(message: str = "Consent is required for this.") -> ApiProblem:
    return ApiProblem(status.HTTP_403_FORBIDDEN, "consent_required", message)


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
            exc.code if isinstance(exc, ApiProblem) else CODES.get(response.status_code, "error"),
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
