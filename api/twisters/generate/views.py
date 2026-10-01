"""HTTP layer for Generate Twister (spec 16 section 2). Views validate, delegate and shape the response."""

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.response import Response

from .. import errors
from ..practice import flags
from ..serializers import twister_context
from ..throttles import GenerateThrottle
from . import own, quota, service
from .serializers import GenerateRequestSerializer, OwnTwisterSerializer

GENERATE_FLAG = "generate_twister"


@extend_schema(request=GenerateRequestSerializer, responses={201: OwnTwisterSerializer})
@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([GenerateThrottle])
def generate(request):
    """`POST /generate/`: a new private twister, plus today's quota so the UI can show what is left."""
    if not flags.enabled(GENERATE_FLAG, request.user):
        raise errors.feature_disabled("Twister generation is not available right now.")
    body = GenerateRequestSerializer(data=request.data)
    body.is_valid(raise_exception=True)
    now = timezone.now()
    twister = service.generate(
        request.user,
        body.validated_data["topic"],
        body.validated_data["difficulty"],
        body.validated_data["language"],
        body.validated_data.get("words"),
        now=now,
    )
    data = OwnTwisterSerializer(twister, context=twister_context(request.user)).data
    return Response(
        {**data, "quota": quota.status(request.user, now).as_dict()},
        status=status.HTTP_201_CREATED,
    )


class MyTwisterList(generics.ListAPIView):
    """`GET /me/twisters/`: the caller's generated twisters (newest first) and today's quota."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = OwnTwisterSerializer
    filter_backends = []

    def get_queryset(self):
        return own.owned(self.request.user).select_related("category")

    def get_serializer_context(self):
        return {**super().get_serializer_context(), **twister_context(self.request.user)}

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        response.data["quota"] = quota.status(request.user, timezone.now()).as_dict()
        return response


@extend_schema(request=None, responses={204: None})
@api_view(["DELETE"])
@permission_classes([permissions.IsAuthenticated])
def delete_my_twister(request, twister_id):
    own.delete(request.user, twister_id)
    return Response(status=status.HTTP_204_NO_CONTENT)
