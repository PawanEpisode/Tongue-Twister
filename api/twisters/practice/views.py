from django.db import transaction
from django.utils.http import parse_http_date_safe
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from ..errors import Conflict
from ..media import quota
from ..models import PracticeSession, Profile, SessionStatus, UserPreference
from ..progress.serializers import unlocked_payload
from ..serializers import ProfileSerializer
from . import flags, guest_sync, services
from .serializers import (
    PlanSerializer,
    PreferenceSerializer,
    SessionCreateSerializer,
    SessionSerializer,
    SessionUpdateSerializer,
)


@api_view(["GET", "PATCH"])
@permission_classes([permissions.IsAuthenticated])
def preferences(request):
    """GET/PATCH the caller's Practice Hub settings (row is created lazily with defaults)."""
    prefs, _ = UserPreference.objects.get_or_create(profile=request.user)
    if request.method == "GET":
        return Response(PreferenceSerializer(prefs).data)

    # Optional optimistic concurrency: refuse to overwrite a newer write from another device.
    since = parse_http_date_safe(request.headers.get("If-Unmodified-Since", ""))
    if since is not None and int(prefs.updated_at.timestamp()) > since:
        raise Conflict("Preferences changed since you last loaded them.")
    ser = PreferenceSerializer(prefs, data=request.data, partial=True)
    ser.is_valid(raise_exception=True)
    ser.save()
    return Response(ser.data)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def entitlements(request):
    used = quota.usage(request.user)
    return Response(
        {
            "plan": PlanSerializer(request.user.plan).data,
            "usage": {"used_bytes": used.used_bytes, "count": used.count},
        }
    )


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def feature_flags(request):
    user = request.user if isinstance(request.user, Profile) else None
    return Response(
        {"flags": flags.evaluate(user)}, headers={"Cache-Control": "private, max-age=60"}
    )


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
@transaction.atomic
def sync_guest(request):
    """Import guest attempts/favourites/preferences once; retries with the same batch id are no-ops."""
    ser = guest_sync.GuestSyncSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    profile = Profile.objects.select_for_update().get(pk=request.user.pk)
    batch, created = guest_sync.import_batch(profile, ser.validated_data)
    return Response(
        {
            "attempts_imported": batch.attempts_imported,
            "favorites_imported": batch.favorites_imported,
            "rejected": batch.rejected,
        },
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        headers={} if created else {"Idempotent-Replay": "true"},
    )


class SessionViewSet(mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Practice-session ledger. Advisory: attempts stay valid without a session."""

    permission_classes = [permissions.IsAuthenticated]
    filter_backends = []

    def get_queryset(self):
        qs = PracticeSession.objects.filter(profile=self.request.user).select_related("twister")
        return qs.select_for_update(of=("self",)) if self.action == "partial_update" else qs

    def create(self, request, *args, **kwargs):
        ser = SessionCreateSerializer(data=request.data, context={"profile": request.user})
        ser.is_valid(raise_exception=True)
        data = dict(ser.validated_data)
        client_id = data.pop("client_session_id")
        session, created = PracticeSession.objects.get_or_create(
            profile=request.user, client_session_id=client_id, defaults=data
        )
        return Response(
            SessionSerializer(session).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            headers={} if created else {"Idempotent-Replay": "true"},
        )

    @transaction.atomic
    def partial_update(self, request, *args, **kwargs):
        # Lock the profile first (same order as attempts) so streak/XP writes serialise per user.
        profile = Profile.objects.select_for_update().get(pk=request.user.pk)
        session = self.get_object()
        session.profile = profile

        update = services.SessionUpdate(0, [])
        if (
            session.status == SessionStatus.ACTIVE
        ):  # terminal sessions are immutable → replays are harmless no-ops
            ser = SessionUpdateSerializer(session, data=request.data, partial=True)
            ser.is_valid(raise_exception=True)
            update = services.apply_session_update(session, dict(ser.validated_data))
        return Response(
            {
                **SessionSerializer(session).data,
                "xp_awarded": update.xp,
                "achievements_unlocked": unlocked_payload(update.achievements_unlocked),
                "profile": ProfileSerializer(profile).data,
            }
        )
