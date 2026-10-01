from django.db.models import Count, Max
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import permissions, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.filters import OrderingFilter
from rest_framework.response import Response

from .account import views as account
from .filters import TwisterFilter, TwisterSearchFilter
from .models import (
    Attempt,
    AttemptKind,
    Category,
    Favorite,
    Profile,
    Twister,
    TwisterVisibility,
    public_twister_q,
)
from .progress import boards, browse, daily
from .serializers import CategorySerializer, ProfileSerializer, TwisterSerializer, twister_context
from .speak.queries import best_scores
from .speak.serializers import AttemptSerializer

OWNER_ACTIONS = ("retrieve", "history")  # the actions that may address a private twister
ANON_FACET_CACHE = "public, max-age=60, stale-while-revalidate=300"


class CategoryViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Category.objects.annotate(
        count=Count("twisters", filter=public_twister_q("twisters__"))
    ).filter(count__gt=0)
    serializer_class = CategorySerializer
    lookup_field = "slug"
    pagination_class = None


class TwisterViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Twister.objects.public().select_related("category")
    serializer_class = TwisterSerializer
    lookup_field = "slug"
    filterset_class = TwisterFilter
    filter_backends = [DjangoFilterBackend, TwisterSearchFilter, OrderingFilter]
    search_fields = ["text", "tip"]
    ordering_fields = ["difficulty", "word_count", "created_at"]

    def get_queryset(self):
        """The public catalogue; opening or practising one twister also admits the caller's own private
        ones (D25). Lists, facets, Random, Daily, boards and favourites never include a private twister."""
        if self.action in OWNER_ACTIONS:
            user = self.request.user
            visible = Twister.objects.visible_to(user if isinstance(user, Profile) else None)
            return visible.select_related("category")
        return super().get_queryset()

    def get_serializer_context(self):
        return {**super().get_serializer_context(), **twister_context(self.request.user)}

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        if response.data["visibility"] == TwisterVisibility.PRIVATE:
            response["Cache-Control"] = "private, no-store"
        return response

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        return browse.refine(queryset, self.request) if self.action == "list" else queryset

    @action(detail=False, methods=["get"])
    def facets(self, request):
        """Counts behind the Browse chips (each facet ignores its own filter)."""
        headers = {} if request.user.is_authenticated else {"Cache-Control": ANON_FACET_CACHE}
        return Response(browse.facets(self, self.get_queryset()), headers=headers)

    @action(detail=False, methods=["get"])
    def random(self, request):
        twister = browse.random_twister(self)
        return Response(self.get_serializer(twister).data, headers={"Cache-Control": "no-store"})

    @action(detail=False, methods=["get"])
    def daily(self, request):
        """Same twister for everyone each UTC day (bare twister; `GET /daily/` has the envelope)."""
        row = daily.daily_twister(daily.today_utc())
        return Response(self.get_serializer(row.twister).data)

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
        return Response(boards.twister_board(self.get_object()))


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    if request.method == "DELETE":
        return account.request_account_deletion(request)
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
