"""Progress endpoints. Views validate parameters, call a service, and shape the response; the rules
live in the sibling modules."""

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from ..models import Favorite, Profile, Twister
from ..serializers import TwisterSerializer, twister_context
from . import achievements, boards, daily, insights, summary
from .serializers import (
    AchievementViewSerializer,
    ActivityQuerySerializer,
    SeenSerializer,
    StatsQuerySerializer,
)

NO_STORE = {"Cache-Control": "private, no-store"}
SHORT_CACHE_SECONDS = 60


def _viewer(request) -> Profile | None:
    return request.user if isinstance(request.user, Profile) else None


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def me_summary(request):
    return Response(summary.build(request.user, timezone.now()), headers=NO_STORE)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def me_achievements(request):
    views = achievements.catalogue_view(request.user)
    return Response(
        {
            "unlocked": sum(1 for v in views if v.unlocked_at is not None),
            "total": len(views),
            "results": AchievementViewSerializer(views, many=True).data,
        },
        headers=NO_STORE,
    )


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def me_achievements_seen(request):
    ser = SeenSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    return Response(
        {"marked": achievements.mark_seen(request.user, ser.validated_data.get("codes"))}
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def me_stats(request):
    query = StatsQuerySerializer(data=request.query_params)
    query.is_valid(raise_exception=True)
    body = insights.stats(
        request.user, query.validated_data["range"], query.validated_data["mode"], timezone.now()
    )
    return Response(body, headers=NO_STORE)


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def me_activity(request):
    query = ActivityQuerySerializer(data=request.query_params)
    query.is_valid(raise_exception=True)
    return Response(
        insights.activity(request.user, query.validated_data["weeks"], timezone.now()),
        headers=NO_STORE,
    )


class FavoriteList(generics.ListAPIView):
    """Newest favourite first, in the same shape (and with the same personal fields) as Browse."""

    permission_classes = [permissions.IsAuthenticated]
    filter_backends = []

    def get_queryset(self):
        return (
            Favorite.objects.filter(profile=self.request.user, twister__is_published=True)
            .select_related("twister__category")
            .order_by("-created_at", "-id")
        )

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        twisters = TwisterSerializer(
            [f.twister for f in page], many=True, context=twister_context(request.user)
        )
        return self.get_paginated_response(twisters.data)


@api_view(["PUT", "DELETE"])
@permission_classes([permissions.IsAuthenticated])
def me_favorite(request, slug):
    """Set the favourite state explicitly, so a retry or a double click can never flip it back."""
    twister = get_object_or_404(Twister, slug=slug, is_published=True)
    if request.method == "PUT":
        Favorite.objects.get_or_create(profile=request.user, twister=twister)
    else:
        Favorite.objects.filter(profile=request.user, twister=twister).delete()
    return Response({"is_favorite": request.method == "PUT"})


def short_cache(viewer: Profile | None) -> dict:
    """One minute of caching; shared caches only for anonymous callers, since the body is personal
    once someone is signed in."""
    scope = "private" if viewer else "public"
    return {"Cache-Control": f"{scope}, max-age={SHORT_CACHE_SECONDS}"}


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def daily_view(request):
    today = daily.today_utc()
    raw = request.query_params.get("day")
    day = daily.parse_day(raw, today) if raw else today
    row = daily.daily_twister(day)
    viewer = _viewer(request)
    twister = TwisterSerializer(row.twister, context=twister_context(viewer)).data
    return Response(
        {"day": day.isoformat(), "source": row.source, "twister": twister},
        headers=short_cache(viewer),
    )


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def weekly_board(request):
    viewer = _viewer(request)
    boards.require_weekly_access(viewer)
    now = timezone.now()
    twister = boards.resolve_twister(request.query_params.get("twister"), daily.today_utc(now))
    return Response(boards.weekly_board(viewer, twister, now), headers=short_cache(viewer))
