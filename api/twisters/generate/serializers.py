from rest_framework import serializers

from ..models import Difficulty
from ..serializers import TwisterSerializer
from . import topic
from .drafts import DEFAULT_LANGUAGE, LANGUAGES
from .validators import MAX_WORDS, MIN_WORDS


class GenerateRequestSerializer(serializers.Serializer):
    topic = serializers.CharField(max_length=topic.TOPIC_MAX, trim_whitespace=True)
    difficulty = serializers.ChoiceField(
        choices=Difficulty.values, default=Difficulty.MEDIUM, required=False
    )
    language = serializers.ChoiceField(choices=LANGUAGES, default=DEFAULT_LANGUAGE, required=False)
    words = serializers.IntegerField(min_value=MIN_WORDS, max_value=MAX_WORDS, required=False)

    def validate_topic(self, value: str) -> str:
        cleaned = topic.clean(value)
        if len(cleaned) < topic.TOPIC_MIN:
            raise serializers.ValidationError("Tell us what the twister should be about.")
        return cleaned


class OwnTwisterSerializer(TwisterSerializer):
    """A twister as its owner sees it: the catalogue shape plus the fields needed to manage it."""

    attempts_count = serializers.SerializerMethodField()

    class Meta(TwisterSerializer.Meta):
        fields = [*TwisterSerializer.Meta.fields, "id", "topic", "created_at", "attempts_count"]

    def get_attempts_count(self, obj) -> int:
        """Tries on the stats row. No row means the owner has not tried this twister yet."""
        return self.context.get("attempt_counts", {}).get(obj.id, 0)
