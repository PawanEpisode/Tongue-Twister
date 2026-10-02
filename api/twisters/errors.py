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
    status.HTTP_402_PAYMENT_REQUIRED: "quota_exceeded",
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

    details: dict

    def __init__(self, status_code: int, code: str, message: str, details: dict | None = None):
        super().__init__(detail=message, code=code)
        self.status_code = status_code
        self.code = code
        self.details = details or {}


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


def quota_exceeded(limit: str, **details) -> ApiProblem:
    """402: a plan limit was hit. `details.limit` names which one so the UI can say what to free up."""
    return ApiProblem(
        status.HTTP_402_PAYMENT_REQUIRED,
        "quota_exceeded",
        f"Your plan's {limit} limit is reached.",
        {"limit": limit, **details},
    )


def minor_not_allowed(
    message: str = "Cloud recordings and voice uploads are for people aged 13 or older.",
) -> ApiProblem:
    return ApiProblem(status.HTTP_403_FORBIDDEN, "minor_not_allowed", message)


def age_required() -> ApiProblem:
    return ApiProblem(
        status.HTTP_403_FORBIDDEN,
        "age_required",
        "Tell us your age range before saving to the cloud.",
    )


def feature_disabled(message: str = "This feature is not available right now.") -> ApiProblem:
    return ApiProblem(status.HTTP_403_FORBIDDEN, "feature_disabled", message)


def account_pending_deletion(scheduled_for) -> ApiProblem:
    """403: the account is in its deletion grace period (D21), so only reads, export and cancel work."""
    return ApiProblem(
        status.HTTP_403_FORBIDDEN,
        "account_pending_deletion",
        "This account is scheduled for deletion. Cancel the deletion to keep using it.",
        {"scheduled_for": scheduled_for.isoformat() if scheduled_for else None},
    )


def generation_limit(limit: int, used: int, resets_at) -> ApiProblem:
    """429: today's generation quota is spent (D26). `details` says when it comes back."""
    return ApiProblem(
        status.HTTP_429_TOO_MANY_REQUESTS,
        "generation_limit",
        "You have used today's twister generations. Try again tomorrow.",
        {"limit": limit, "used": used, "resets_at": resets_at.isoformat()},
    )


def stored_limit(limit: int, stored: int) -> ApiProblem:
    """409: the person already keeps `GENERATE_MAX_STORED` private twisters; deleting one frees a place.
    Nothing is spent: no quota slot is taken and the model is not called."""
    return ApiProblem(
        status.HTTP_409_CONFLICT,
        "stored_limit",
        "You have reached the limit of saved twisters. Delete one to make a new one.",
        {"limit": limit, "stored": stored},
    )


def generation_rejected(reason: str) -> ApiProblem:
    """422: the request or the generated text did not pass the safety checks (D26). `details.reason` is a
    stable machine code; the message never echoes the user's text or the model's output."""
    return ApiProblem(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "generation_rejected",
        "We could not make a suitable twister from that. Try a different topic.",
        {"reason": reason},
    )


def generator_unavailable() -> ApiProblem:
    return ApiProblem(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "generator_unavailable",
        "The twister generator is not available right now. Try again in a moment.",
    )


def dependency_unavailable(message: str = "A required service is not available.") -> ApiProblem:
    return ApiProblem(status.HTTP_503_SERVICE_UNAVAILABLE, "dependency_unavailable", message)


def gone(message: str = "This link is no longer available.") -> ApiProblem:
    return ApiProblem(status.HTTP_410_GONE, "gone", message)


def _message(data) -> str:
    return str(data["detail"]) if isinstance(data, dict) and "detail" in data else "Request failed."


def record_quota_hit(request, limit: str) -> None:
    """Remember that this user ran into `limit` (evidence for the paid-plan decision). Best effort and never
    visible to the caller: a failure here must not change the 402 they are about to get. By the time the
    exception handler runs the request's transaction has unwound, so the row is not rolled back with it."""
    from datetime import timedelta  # local: models import this module

    from django.utils import timezone

    from .models import Profile, QuotaHit

    user = getattr(request, "user", None)
    if not isinstance(user, Profile):
        return
    try:
        recent = QuotaHit.objects.filter(
            profile=user, limit=limit[:20], created_at__gt=timezone.now() - timedelta(minutes=10)
        )
        if not recent.exists():
            QuotaHit.objects.create(
                profile=user, limit=limit[:20], plan_code=str(user.plan_id or "")[:20]
            )
    except Exception:  # noqa: BLE001
        import logging

        logging.getLogger(__name__).warning("quota_hit.record_failed", exc_info=True)


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None  # unhandled → Django's 500 (never leak internals)
    if isinstance(exc, ApiProblem) and exc.code == "quota_exceeded":
        record_quota_hit(context.get("request"), str(exc.details.get("limit", "")))
    if isinstance(exc, ValidationError):
        code, message, details = "validation_error", "Some fields are invalid.", response.data
    else:
        code, message, details = (
            exc.code if isinstance(exc, ApiProblem) else CODES.get(response.status_code, "error"),
            _message(response.data),
            exc.details if isinstance(exc, ApiProblem) else {},
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
