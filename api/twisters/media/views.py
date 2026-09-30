"""HTTP layer for consent, cloud recordings, voice clips, share links and worker callbacks.

Views only parse, authorise and shape responses; every rule lives in the sibling service modules.
Ownership is enforced by starting every lookup from the caller's own rows (404, never 403, so ids of
other users' objects cannot be probed).
"""

from __future__ import annotations

import datetime as dt
import json
import uuid

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import mixins, permissions, serializers, status, viewsets
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.exceptions import AuthenticationFailed, NotFound, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .. import errors
from ..auth import SupabaseJWTAuthentication
from ..models import (
    Attempt,
    ConsentType,
    MediaAsset,
    MediaKind,
    Profile,
    Recording,
    RecordingStatus,
    ShareLink,
    ShareTarget,
    UserConsent,
)
from ..practice import flags
from ..security import hash_ip, require_worker_signature
from ..throttles import (
    RecordingCreateThrottle,
    ShareCreateThrottle,
    ShareReportThrottle,
    ShareResolveThrottle,
    VoiceUploadThrottle,
)
from . import analysis, consent, jobs, moderation, processing, quota, recordings, shares, uploads
from .serializers import (
    CompleteSerializer,
    ConsentGrantSerializer,
    ConsentSerializer,
    ModerationReportSerializer,
    RecordingCreateSerializer,
    RecordingDetailSerializer,
    RecordingSerializer,
    RecordingUpdateSerializer,
    ReportSerializer,
    ShareCreateSerializer,
    ShareLinkSerializer,
    VoiceCreateSerializer,
    public_recording_body,
    public_score_card_body,
    recording_payload,
    recording_urls,
)

SHARE_FLAG = "share_links"
REPLAY = {"Idempotent-Replay": "true"}
UUID_PATTERN = r"[0-9a-fA-F-]{36}"
_QUOTA_SCHEMA = inline_serializer(
    "Quota",
    {
        "used_bytes": serializers.IntegerField(),
        "limit_bytes": serializers.IntegerField(),
        "count": serializers.IntegerField(),
        "count_limit": serializers.IntegerField(),
    },
)


_ANALYSIS_SCHEMA = inline_serializer(
    "AnalysisResponse",
    {
        "analysis": inline_serializer(
            "Analysis",
            {"status": serializers.CharField(), "audio_ready": serializers.BooleanField()},
        )
    },
)


def _with_idempotency_key(request: Request, field: str) -> dict:
    """Body as a plain dict; the `Idempotency-Key` header fills `field` when the body omits it."""
    data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
    if (
        isinstance(data, dict)
        and not data.get(field)
        and (key := request.headers.get("Idempotency-Key"))
    ):
        data[field] = key
    return data


def _require_sharing(profile: Profile | None = None) -> None:
    on = flags.enabled(SHARE_FLAG, profile) if profile else flags.switched_on(SHARE_FLAG)
    if not on:
        raise errors.feature_disabled("Sharing is not available right now.")


# --- consent & storage --------------------------------------------------------------------------


@extend_schema(
    methods=["POST"],
    request=ConsentGrantSerializer,
    responses={200: ConsentSerializer, 201: ConsentSerializer},
)
@extend_schema(methods=["GET"], responses=ConsentSerializer(many=True))
@api_view(["GET", "POST"])
@permission_classes([permissions.IsAuthenticated])
def consents(request):
    """GET: the caller's active consents plus the versions being asked for now. POST: grant (idempotent)."""
    if request.method == "GET":
        rows = UserConsent.objects.filter(profile=request.user, revoked_at__isnull=True)
        return Response(
            {
                "results": ConsentSerializer(rows, many=True).data,
                "current_versions": settings.CONSENT_VERSIONS,
            }
        )
    ser = ConsentGrantSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    row, created = consent.grant(
        request.user, ser.validated_data["type"], ser.validated_data["version"], hash_ip(request)
    )
    return Response(
        ConsentSerializer(row).data,
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        headers={} if created else REPLAY,
    )


@extend_schema(responses=inline_serializer("ConsentRevoked", {"type": serializers.CharField()}))
@api_view(["DELETE"])
@permission_classes([permissions.IsAuthenticated])
def consent_revoke(request, consent_type: str):
    """Revoke a consent. Media that depended on it is removed by the job after the grace period."""
    if consent_type not in ConsentType.values:
        raise NotFound()
    row = consent.revoke(request.user, consent_type)
    has_media = consent_type in (ConsentType.RECORDING_UPLOAD, ConsentType.VOICE_STORAGE)
    return Response(
        {
            "type": consent_type,
            "revoked_at": row.revoked_at if row else None,
            "purge_at": consent.purge_after(row.revoked_at) if row and has_media else None,
        }
    )


@extend_schema(responses=inline_serializer("Storage", {"used_bytes": serializers.IntegerField()}))
@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def storage_usage(request):
    soon = timezone.now() + dt.timedelta(days=settings.EXPIRY_REMINDER_DAYS)
    expiring = (
        recordings.live(request.user)
        .filter(status=RecordingStatus.READY, expires_at__lte=soon)
        .order_by("expires_at")[:20]
    )
    return Response(
        {
            **quota.snapshot(request.user),
            "expiring_soon": [
                {"id": r.pk, "title": r.title, "expires_at": r.expires_at} for r in expiring
            ],
        }
    )


# --- recordings ---------------------------------------------------------------------------------


class RecordingViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = RecordingSerializer
    filter_backends: list = []
    lookup_value_regex = UUID_PATTERN

    def get_serializer_class(self):
        return RecordingDetailSerializer if self.action == "retrieve" else RecordingSerializer

    def get_throttles(self):
        if self.action == "create":
            return [RecordingCreateThrottle()]
        if self.action == "share":
            return [ShareCreateThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        if self.action == "restore":  # the only route that may see soft-deleted rows
            qs = Recording.objects.filter(profile=self.request.user, deleted_at__isnull=False)
        else:
            qs = recordings.live(self.request.user)
        qs = qs.select_related(
            "twister", "attempt", "video_asset", "thumbnail_asset", "captions_asset"
        )
        if self.action == "list" and (slug := self.request.query_params.get("twister")):
            qs = qs.filter(twister__slug=slug)
        return qs

    # -- create / list / read ----------------------------------------------------------------------

    @extend_schema(request=RecordingCreateSerializer, responses={201: None})
    def create(self, request):
        ser = RecordingCreateSerializer(
            data=_with_idempotency_key(request, "client_recording_id"),
            context={"profile": request.user},
        )
        ser.is_valid(raise_exception=True)
        result = recordings.create(request.user, dict(ser.validated_data))
        asset = result.recording.video_asset
        upload = None
        if asset is not None and asset.status in uploads.AWAITING:
            upload = uploads.sign_upload(asset).as_dict()
        return Response(
            {
                "recording": recording_payload(result.recording, detail=False),
                "upload": upload,
                "quota": quota.snapshot(request.user),
            },
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
            headers={} if result.created else REPLAY,
        )

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        urls = recording_urls(page, detail=False)
        return self.get_paginated_response(
            RecordingSerializer(page, many=True, context={"urls": urls}).data
        )

    def retrieve(self, request, *args, **kwargs):
        return Response(recording_payload(self.get_object()))

    # -- update / delete ---------------------------------------------------------------------------

    @extend_schema(request=RecordingUpdateSerializer, responses=RecordingDetailSerializer)
    def partial_update(self, request, *args, **kwargs):
        recording = self.get_object()
        ser = RecordingUpdateSerializer(
            recording, data=request.data, partial=True, context={"profile": request.user}
        )
        ser.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                ser.save()
        except IntegrityError as exc:  # the one-recording-per-attempt unique index
            raise errors.Conflict("That attempt is already linked to a recording.") from exc
        return Response(recording_payload(recording))

    def destroy(self, request, *args, **kwargs):
        recording = self.get_object()
        recordings.soft_delete(request.user, recording)
        restorable_until = recording.deleted_at + dt.timedelta(hours=settings.RESTORE_WINDOW_HOURS)
        return Response(
            {
                "id": recording.pk,
                "deleted_at": recording.deleted_at,
                "restorable_until": restorable_until,
            }
        )

    @extend_schema(request=None, responses=RecordingDetailSerializer)
    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        return Response(recording_payload(recordings.restore(request.user, self.get_object())))

    # -- upload completion / processing ------------------------------------------------------------

    @extend_schema(
        request=CompleteSerializer,
        responses={200: RecordingDetailSerializer, 202: RecordingDetailSerializer},
    )
    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        recording = self.get_object()
        ser = CompleteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        recording, changed = recordings.complete(
            request.user,
            recording,
            checksum=ser.validated_data.get("checksum_sha256"),
            thumbnail=ser.validated_data.get("thumbnail"),
        )
        return Response(
            recording_payload(recording),
            status=status.HTTP_202_ACCEPTED if changed else status.HTTP_200_OK,
            headers={} if changed else REPLAY,
        )

    @extend_schema(request=None, responses={202: RecordingDetailSerializer})
    @action(detail=True, methods=["post"], url_path="retry-processing")
    def retry_processing(self, request, pk=None):
        recording = recordings.retry_processing(request.user, self.get_object())
        return Response(recording_payload(recording), status=status.HTTP_202_ACCEPTED)

    @extend_schema(request=None, responses={200: _ANALYSIS_SCHEMA, 202: _ANALYSIS_SCHEMA})
    @action(detail=True, methods=["post"])
    def analyse(self, request, pk=None):
        """Queue audio extraction for analysis (idempotent; the worker does the work)."""
        block, created = analysis.request(request.user, self.get_object())
        return Response(
            {"analysis": block},
            status=status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK,
            headers={} if created else REPLAY,
        )

    # -- sharing -----------------------------------------------------------------------------------

    @extend_schema(
        request=ShareCreateSerializer,
        responses={
            201: inline_serializer(
                "ShareCreated",
                {
                    "id": serializers.UUIDField(),
                    "url": serializers.URLField(),
                    "expires_at": serializers.DateTimeField(),
                },
            )
        },
    )
    @action(detail=True, methods=["post"])
    def share(self, request, pk=None):
        """Mint a link; the raw token is in this response only and is not recoverable afterwards."""
        recording = self.get_object()  # ownership (404) is decided before any gate about the caller
        _require_sharing(request.user)
        consent.require_adult(request.user)
        ser = ShareCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        link, token = shares.create_for_recording(
            request.user,
            recording,
            ser.validated_data["expires_in"],
            quota.limits_for(request.user).share_max_days,
        )
        return Response(
            {
                "id": link.pk,
                "url": shares.share_url(link.target_type, token),
                "expires_at": link.expires_at,
            },
            status=status.HTTP_201_CREATED,
        )


def create_score_card_link(request: Request, attempt: Attempt) -> Response:
    """`POST /attempts/{id}/score-card/`: a public, media-free link to one attempt's result."""
    _require_sharing(request.user)
    link, token = shares.create_for_score_card(request.user, attempt)
    return Response(
        {
            "id": link.pk,
            "url": shares.share_url(link.target_type, token),
            "expires_at": link.expires_at,
        },
        status=status.HTTP_201_CREATED,
    )


class ShareViewSet(mixins.ListModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """The owner's links (never with tokens) and immediate revocation."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ShareLinkSerializer
    filter_backends: list = []
    lookup_value_regex = UUID_PATTERN

    def get_queryset(self):
        qs = ShareLink.objects.filter(created_by=self.request.user)
        if raw := self.request.query_params.get("recording"):
            try:
                target = uuid.UUID(raw)
            except ValueError as exc:
                raise ValidationError({"recording": "Not a valid id."}) from exc
            qs = qs.filter(target_type=ShareTarget.RECORDING, target_id=target)
        return qs

    @extend_schema(parameters=[OpenApiParameter("recording", str, description="Recording id")])
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def perform_destroy(self, instance):
        shares.revoke(instance)


# --- voice clips --------------------------------------------------------------------------------


@extend_schema(request=VoiceCreateSerializer, responses={201: None})
@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([VoiceUploadThrottle])
def voice_create(request):
    ser = VoiceCreateSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    asset = uploads.create_voice(request.user, **ser.validated_data)
    return Response(
        {
            "voice_asset_id": asset.pk,
            "status": asset.status,
            "expires_at": asset.expires_at,
            "upload": uploads.sign_upload(asset).as_dict(),
            "quota": quota.snapshot(request.user),
        },
        status=status.HTTP_201_CREATED,
    )


@extend_schema(request=CompleteSerializer, responses={200: None, 202: None})
@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def voice_complete(request, asset_id):
    asset = MediaAsset.objects.filter(
        pk=asset_id, profile=request.user, kind=MediaKind.AUDIO
    ).first()
    if asset is None:
        raise NotFound()
    ser = CompleteSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    changed = uploads.complete_voice(
        request.user, asset, checksum=ser.validated_data.get("checksum_sha256")
    )
    return Response(
        {"voice_asset_id": asset.pk, "status": asset.status, "expires_at": asset.expires_at},
        status=status.HTTP_202_ACCEPTED if changed else status.HTTP_200_OK,
        headers={} if changed else REPLAY,
    )


# --- public (anonymous) -------------------------------------------------------------------------


class OptionalJWTAuthentication(SupabaseJWTAuthentication):
    """Identify the caller when a valid token is sent, but treat a bad or expired one as anonymous:
    a public page must not break because the browser holds a stale session."""

    def authenticate(self, request):
        try:
            return super().authenticate(request)
        except AuthenticationFailed:
            return None


class PublicView(APIView):
    """Anonymous, never cached or indexed. Headers are set in `finalize_response` so they also cover
    404/410/429 answers."""

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["X-Robots-Tag"] = "noindex, nofollow"
        response["Cache-Control"] = "no-store"
        return response


class PublicRecordingView(PublicView):
    throttle_classes = [ShareResolveThrottle]

    @extend_schema(
        responses=inline_serializer("PublicRecording", {"title": serializers.CharField()})
    )
    def get(self, request, token: str):
        _require_sharing()
        return Response(public_recording_body(shares.resolve(token, ShareTarget.RECORDING)))


class PublicScoreCardView(PublicView):
    throttle_classes = [ShareResolveThrottle]

    @extend_schema(
        responses=inline_serializer("PublicScoreCard", {"score": serializers.IntegerField()})
    )
    def get(self, request, token: str):
        _require_sharing()
        return Response(public_score_card_body(shares.resolve(token, ShareTarget.SCORE_CARD)))


class PublicReportView(PublicView):
    authentication_classes = [OptionalJWTAuthentication]
    throttle_classes = [ShareReportThrottle]

    @extend_schema(
        request=ReportSerializer,
        responses={200: ModerationReportSerializer, 201: ModerationReportSerializer},
    )
    def post(self, request, token: str):
        _require_sharing()
        ser = ReportSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        link = shares.resolve(token, ShareTarget.RECORDING, count_view=False).link
        reporter = request.user if isinstance(request.user, Profile) else None
        row, created = moderation.report(
            link, reporter=reporter, ip_hash=hash_ip(request), **ser.validated_data
        )
        return Response(
            ModerationReportSerializer(row).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            headers={} if created else REPLAY,
        )


# --- worker endpoints (HMAC-signed, not rate-limited: the signature is the credential) -----------

PROCESSED_STATUSES = ("ready", "failed")


def _signed_json_body(request: Request) -> dict:
    """Verify the worker signature and parse the raw body (empty body = `{}`)."""
    require_worker_signature(request)
    try:
        body = json.loads(request.body or b"{}")
    except ValueError as exc:
        raise ValidationError({"body": "Invalid JSON."}) from exc
    if not isinstance(body, dict):
        raise ValidationError({"body": "Send a JSON object."})
    return body


def _validated_processed(body: dict) -> dict:
    if body.get("status") not in PROCESSED_STATUSES:
        raise ValidationError({"status": "Send status 'ready' or 'failed'."})
    outputs = body.get("outputs", [])
    if not isinstance(outputs, list) or not all(isinstance(o, str) for o in outputs):
        raise ValidationError({"outputs": "Send a list of output names."})
    if (raw := body.get("job_id")) is not None:
        try:
            body = {**body, "job_id": uuid.UUID(str(raw))}
        except ValueError as exc:
            raise ValidationError({"job_id": "Not a valid id."}) from exc
    return body


@extend_schema(request=None, responses={200: None})
@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
@throttle_classes([])
def media_claim(request):
    """Media worker: take the next job (lease + signed URLs), or `{"job": null}` when idle."""
    _signed_json_body(request)
    return Response({"job": processing.claim_next()})


@extend_schema(request=None, responses={200: None})
@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
@throttle_classes([])
def media_heartbeat(request, job_id):
    """Media worker: extend the lease on a running job (409 `lease_lost` if it is no longer running)."""
    _signed_json_body(request)
    job = jobs.heartbeat(job_id)
    return Response(
        {
            "job_id": job.pk,
            "lease_s": settings.MEDIA_JOB_LEASE_S,
            "locked_until": job.locked_until,
        }
    )


@extend_schema(request=None, responses={200: None})
@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
@throttle_classes([])
def media_processed(request, asset_id):
    """Media worker callback (idempotent): a job finished or failed."""
    body = _validated_processed(_signed_json_body(request))
    asset = (
        MediaAsset.objects.select_related("profile")
        .filter(pk=asset_id, kind=MediaKind.VIDEO)
        .first()
    )
    if asset is None:
        raise NotFound()
    job, changed = processing.apply_processed(asset, body)
    return Response(
        {"status": body["status"], "job_status": job.status},
        headers={} if changed else REPLAY,
    )
