"""HTTP layer for account deletion and export. Views validate, delegate and shape the response."""

from django.http import StreamingHttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.request import Request
from rest_framework.response import Response

from ..throttles import ExportThrottle
from . import deletion, export
from .serializers import DeleteAccountSerializer, DeletionStateSerializer


def request_account_deletion(request: Request) -> Response:
    """`DELETE /me/` (routed through `twisters.views.me`): 202, idempotent while pending."""
    DeleteAccountSerializer(data=request.data).is_valid(raise_exception=True)
    profile = deletion.request_deletion(request.user)
    return Response(DeletionStateSerializer(profile).data, status=status.HTTP_202_ACCEPTED)


@extend_schema(request=None, responses=DeletionStateSerializer)
@api_view(["DELETE"])
@permission_classes([permissions.IsAuthenticated])
def cancel_account_deletion(request):
    """`DELETE /me/deletion/`: change of mind. Idempotent; allowed until the purge actually runs."""
    return Response(DeletionStateSerializer(deletion.cancel_deletion(request.user)).data)


@extend_schema(responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([ExportThrottle])
def export_data(request):
    """`GET /me/export/`: everything we hold about the caller, as a downloadable JSON file."""
    now = timezone.now()
    response = StreamingHttpResponse(
        export.stream(request.user, now), content_type="application/json"
    )
    response["Content-Disposition"] = f'attachment; filename="{export.filename(now)}"'
    response["Cache-Control"] = "private, no-store"
    return response


@extend_schema(responses=OpenApiTypes.STR)
@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([ExportThrottle])
def export_attempts_csv(request):
    """`GET /me/export/attempts.csv`: the caller's attempts as a spreadsheet-friendly file."""
    now = timezone.now()
    response = StreamingHttpResponse(
        export.attempts_csv(request.user), content_type="text/csv; charset=utf-8"
    )
    response["Content-Disposition"] = f'attachment; filename="{export.csv_filename(now)}"'
    response["Cache-Control"] = "private, no-store"
    return response
