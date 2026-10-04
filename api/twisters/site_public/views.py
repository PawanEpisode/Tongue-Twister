from django.db import transaction
from rest_framework import permissions, status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response

from ..models import SignupAttribution, SyncBatch, SyncKind, Twister
from ..serializers import TwisterSerializer
from . import stats, teaser
from .serializers import AttributionSerializer

LANDING_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600"


@api_view(["GET"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def landing(request):
    """Everything the landing page needs from the server in one cacheable call. Identical for everyone
    (a signed-in caller gets the anonymous shape), so shared caches may keep it."""
    twisters = list(teaser.teaser_queryset())
    body = {
        "library_total": Twister.objects.public().count(),
        "teaser": TwisterSerializer(twisters, many=True, context={}).data,
        "facets": stats.facet_counts(),
        "stats": {**stats.catalogue_stats(), **stats.usage_stats()},
        "testimonials": [],
    }
    return Response(body, headers={"Cache-Control": LANDING_CACHE})


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
@transaction.atomic
def attribution(request):
    """Record how this account first arrived, once. A repeat returns what is stored and changes nothing."""
    existing = SignupAttribution.objects.filter(pk=request.user.pk).first()
    if existing:
        return Response(_row(existing), status=status.HTTP_200_OK)
    ser = AttributionSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    row, created = SignupAttribution.objects.get_or_create(
        profile=request.user,
        defaults={
            **ser.validated_data,
            # A demo score may have been claimed before this call arrived.
            "demo_claimed": SyncBatch.objects.filter(
                profile=request.user, kind=SyncKind.DEMO_CLAIM
            ).exists(),
        },
    )
    return Response(_row(row), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


def _row(row: SignupAttribution) -> dict:
    return {
        "intent": row.intent,
        "first_path": row.first_path,
        "utm": {
            "source": row.utm_source,
            "medium": row.utm_medium,
            "campaign": row.utm_campaign,
        },
        "demo_claimed": row.demo_claimed,
    }
