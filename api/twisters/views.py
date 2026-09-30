from django.db import transaction
from django.db.models import Count, Max, Q
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from . import scoring
from .models import Attempt, Category, Favorite, Profile, Twister
from .practice import services
from .serializers import (
    AttemptCreateSerializer,
    AttemptSerializer,
    CategorySerializer,
    ProfileSerializer,
    TwisterSerializer,
)


class TwisterFilter(filters.FilterSet):
    category = filters.CharFilter(field_name="category__slug")
    difficulty = filters.NumberFilter()
    origin = filters.CharFilter()
    min_words = filters.NumberFilter(field_name="word_count", lookup_expr="gte")
    max_words = filters.NumberFilter(field_name="word_count", lookup_expr="lte")

    class Meta:
        model = Twister
        fields = ["category", "difficulty", "origin", "min_words", "max_words"]


class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Category.objects.annotate(
        count=Count("twisters", filter=Q(twisters__is_published=True))
    ).filter(count__gt=0)
    serializer_class = CategorySerializer
    lookup_field = "slug"
    pagination_class = None


class TwisterViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Twister.objects.filter(is_published=True).select_related("category")
    serializer_class = TwisterSerializer
    lookup_field = "slug"
    filterset_class = TwisterFilter
    search_fields = ["text", "tip"]
    ordering_fields = ["difficulty", "word_count", "created_at"]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        user = self.request.user
        if getattr(user, "is_authenticated", False) and isinstance(user, Profile):
            ctx["favorite_ids"] = set(user.favorites.values_list("twister_id", flat=True))
            ctx["best_scores"] = dict(
                user.attempts.values_list("twister_id").annotate(b=Max("score"))
            )
        return ctx

    @action(detail=False, methods=["get"])
    def daily(self, request):
        """Same twister for everyone each UTC day — deterministic rotation."""
        ids = list(self.get_queryset().values_list("id", flat=True).order_by("id"))
        if not ids:
            return Response(status=status.HTTP_404_NOT_FOUND)
        pick = ids[timezone.now().date().toordinal() % len(ids)]
        obj = self.get_queryset().get(id=pick)
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def favorite(self, request, slug=None):
        twister = self.get_object()
        fav, created = Favorite.objects.get_or_create(profile=request.user, twister=twister)
        if not created:
            fav.delete()
        return Response({"is_favorite": created})

    @action(detail=True, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def history(self, request, slug=None):
        """The caller's attempts on this twister (newest first) plus totals for the side panel."""
        limit = {"10": 10, "30": 30, "all": None}.get(
            request.query_params.get("range", "10"), "bad"
        )
        if limit == "bad":
            raise ValidationError({"range": "Use 10, 30 or all."})
        mine = Attempt.objects.filter(profile=request.user, twister=self.get_object())
        stats = mine.aggregate(count=Count("id"), best=Max("score"))
        rows = mine[:limit] if limit else mine
        return Response(
            {
                "count": stats["count"],
                "best_score": stats["best"],
                "results": AttemptSerializer(rows, many=True).data,
            }
        )

    @action(detail=True, methods=["get"])
    def leaderboard(self, request, slug=None):
        twister = self.get_object()
        rows = (
            Attempt.objects.filter(twister=twister)
            .values("profile_id", "profile__display_name", "profile__avatar_emoji")
            .annotate(best=Max("score"))
            .order_by("-best")[:10]
        )
        return Response(
            [
                {
                    "user": r["profile__display_name"] or "Anonymous",
                    "emoji": r["profile__avatar_emoji"],
                    "score": r["best"],
                }
                for r in rows
            ]
        )


class AttemptViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AttemptSerializer
    filter_backends = []

    def get_queryset(self):
        return Attempt.objects.filter(profile=self.request.user).select_related("twister")

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        ser = AttemptCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        twister: Twister = ser.validated_data["twister"]
        result = scoring.compute(
            twister.text,
            ser.validated_data["transcript"],
            ser.validated_data["duration_ms"],
            twister.difficulty,
        )

        profile = Profile.objects.select_for_update().get(pk=request.user.pk)
        prev_best = Attempt.objects.filter(profile=profile, twister=twister).aggregate(
            m=Max("score")
        )["m"]
        attempt = Attempt.objects.create(
            profile=profile,
            twister=twister,
            transcript=ser.validated_data["transcript"],
            accuracy=result["accuracy"],
            duration_ms=ser.validated_data["duration_ms"],
            wpm=result["wpm"],
            score=result["score"],
            xp_awarded=result["xp"],
        )
        old_level = profile.level
        services.record_attempt(profile, result["xp"])

        data = AttemptSerializer(attempt).data
        data.update(
            {
                "personal_best": prev_best is None or result["score"] > prev_best,
                "level_up": profile.level > old_level,
                "profile": ProfileSerializer(profile).data,
            }
        )
        return Response(data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH"])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    if request.method == "PATCH":
        ser = ProfileSerializer(request.user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    stats = request.user.attempts.aggregate(total=Count("id"), best=Max("score"))
    return Response(
        {
            **ProfileSerializer(request.user).data,
            "total_attempts": stats["total"],
            "best_score": stats["best"],
        }
    )
