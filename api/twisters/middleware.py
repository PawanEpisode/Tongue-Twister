import re
import uuid

_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class RequestIdMiddleware:
    """Attach a request id (client-supplied if well-formed) to the request and echo it as X-Request-Id."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        supplied = request.headers.get("X-Request-Id", "")
        request.request_id = supplied if _SAFE_ID.match(supplied) else uuid.uuid4().hex
        response = self.get_response(request)
        response["X-Request-Id"] = request.request_id
        return response
