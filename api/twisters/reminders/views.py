"""HTTP layer for reminders (spec 16 section 2, D27). Views validate, delegate and shape the response."""

from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import permissions, serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from ..media.views import PublicView
from ..throttles import UnsubscribeThrottle
from . import service, tokens


class ReminderSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    hour_local = serializers.IntegerField(min_value=0, max_value=23)


@extend_schema(request=ReminderSerializer, responses=ReminderSerializer)
@api_view(["GET", "PUT"])
@permission_classes([permissions.IsAuthenticated])
def me_reminders(request):
    """`GET|PUT /me/reminders/`: the caller's reminder e-mail setting. Works whatever the flag says
    (the flag only gates sending); a profile with no row reads as off at the default hour."""
    if request.method == "GET":
        return Response(service.get(request.user))
    body = ReminderSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    return Response(service.update(request.user, **body.validated_data))


class UnsubscribeView(PublicView):
    """`GET|POST /public/unsubscribe/{token}/`: one-click unsubscribe (RFC 8058). Idempotent; a valid
    token for an account that no longer exists answers the same `200`, so it reveals nothing."""

    throttle_classes = [UnsubscribeThrottle]

    @extend_schema(
        responses=inline_serializer("Unsubscribed", {"unsubscribed": serializers.BooleanField()})
    )
    def get(self, request, token: str):
        return self._unsubscribe(token)

    post = get

    @staticmethod
    def _unsubscribe(token: str) -> Response:
        profile_id = tokens.read_token(token)
        if profile_id is None:
            raise NotFound()
        service.unsubscribe(profile_id)
        return Response({"unsubscribed": True})
