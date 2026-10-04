import re
from urllib.parse import urlsplit

from rest_framework import serializers

from ..models import GateIntent

UTM_VALUE = re.compile(r"[^a-z0-9_.-]")


def clean_utm(value: str) -> str:
    return UTM_VALUE.sub("", str(value or "").lower())[:40]


def clean_path(value: str) -> str:
    """A site path only: no host, query or fragment. Anything else is dropped to the empty string."""
    if not isinstance(value, str) or not value.startswith("/") or value.startswith("//"):
        return ""
    return urlsplit(value).path[:120]


class AttributionSerializer(serializers.Serializer):
    intent = serializers.ChoiceField(choices=GateIntent.choices, default=GateIntent.DIRECT)
    first_path = serializers.CharField(max_length=300, allow_blank=True, default="")
    utm = serializers.DictField(child=serializers.CharField(allow_blank=True), required=False)

    def validate(self, attrs):
        utm = attrs.get("utm") or {}
        return {
            "intent": attrs["intent"],
            "first_path": clean_path(attrs.get("first_path", "")),
            "utm_source": clean_utm(utm.get("source", "")),
            "utm_medium": clean_utm(utm.get("medium", "")),
            "utm_campaign": clean_utm(utm.get("campaign", "")),
        }
