from django.db.models import Count, Max, Q
from django.utils import timezone
from django_filters import rest_framework as filters
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import Attempt, AttemptKind, Category, Favorite, Profile, Twister
from .serializers import CategorySerializer, ProfileSerializer, TwisterSerializer
from .speak.queries import best_scores, leaderboard_attempts
from .speak.serializers import AttemptSerializer


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
            ctx["best_scores"] = best_scores(user.attempts.all())
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
        twister = self.get_object()
        mine = Attempt.objects.filter(profile=request.user, twister=twister).select_related(
            "twister", "model_version"
        )
        if (kind := request.query_params.get("kind")) in AttemptKind.values:
            mine = mine.filter(kind=kind)
        rows = mine[:limit] if limit else mine
        return Response(
            {
                "count": mine.count(),
                "best_score": best_scores(mine).get(twister.id),
                "results": AttemptSerializer(rows, many=True).data,
            }
        )

    @action(detail=True, methods=["get"])
    def leaderboard(self, request, slug=None):
        twister = self.get_object()
        rows = (
            leaderboard_attempts()
            .filter(twister=twister)
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


@api_view(["GET", "PATCH"])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    if request.method == "PATCH":
        ser = ProfileSerializer(request.user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
    mine = request.user.attempts
    return Response(
        {
            **ProfileSerializer(request.user).data,
            "total_attempts": mine.count(),
            "best_score": mine.filter(kind=AttemptKind.TEST, flagged=False).aggregate(
                best=Max("score")
            )["best"],
        }
    )
