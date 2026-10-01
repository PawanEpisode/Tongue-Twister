from rest_framework import serializers

from ..models import Difficulty
from ..serializers import TwisterSerializer
from . import topic
from .drafts import DEFAULT_LANGUAGE, LANGUAGES


class GenerateRequestSerializer(serializers.Serializer):
    topic = serializers.CharField(max_length=topic.TOPIC_MAX, trim_whitespace=True)
    difficulty = serializers.ChoiceField(
        choices=Difficulty.values, default=Difficulty.MEDIUM, required=False
    )
    language = serializers.ChoiceField(choices=LANGUAGES, default=DEFAULT_LANGUAGE, required=False)

    def validate_topic(self, value: str) -> str:
        cleaned = topic.clean(value)
        if len(cleaned) < topic.TOPIC_MIN:
            raise serializers.ValidationError("Tell us what the twister should be about.")
        return cleaned


class OwnTwisterSerializer(TwisterSerializer):
    """A twister as its owner sees it: the catalogue shape plus the fields needed to manage it."""

    class Meta(TwisterSerializer.Meta):
        fields = [*TwisterSerializer.Meta.fields, "id", "topic", "created_at"]
