from rest_framework import serializers

from .errors import Conflict
from .models import AgeBand, Category, Profile, Twister
from .names import clean_public_name
from .progress import mastery
from .speak.queries import best_scores


class CategorySerializer(serializers.ModelSerializer):
    count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Category
        fields = ["slug", "name", "emoji", "description", "count"]


def twister_context(user) -> dict:
    """Per-caller serializer context (favourites, best scores, mastery): three constant-size queries
    whatever the page size. Empty for anonymous callers, whose twisters carry no personal fields."""
    if not isinstance(user, Profile):
        return {}
    return {
        "favorite_ids": set(user.favorites.values_list("twister_id", flat=True)),
        "best_scores": best_scores(user.attempts.all()),
        "mastery_states": mastery.mastery_states_for(user),
    }


class TwisterSerializer(serializers.ModelSerializer):
    category = serializers.SlugRelatedField(slug_field="slug", read_only=True)
    difficulty_label = serializers.CharField(source="get_difficulty_display", read_only=True)
    is_favorite = serializers.SerializerMethodField()
    best_score = serializers.SerializerMethodField()
    mastery = serializers.SerializerMethodField()

    class Meta:
        model = Twister
        fields = [
            "slug",
            "text",
            "category",
            "difficulty",
            "difficulty_label",
            "origin",
            "tip",
            "focus_sounds",
            "word_count",
            "visibility",
            "is_favorite",
            "best_score",
            "mastery",
        ]

    def _fav_ids(self):
        return self.context.get("favorite_ids", set())

    def _best(self):
        return self.context.get("best_scores", {})

    def get_is_favorite(self, obj):
        return obj.id in self._fav_ids()

    def get_best_score(self, obj):
        return self._best().get(obj.id)

    def get_mastery(self, obj):
        """`null` for anonymous callers; twisters the user never tried are `new`."""
        states = self.context.get("mastery_states")
        return None if states is None else states.get(obj.id, mastery.NEW)


class ProfileSerializer(serializers.ModelSerializer):
    level = serializers.IntegerField(read_only=True)

    class Meta:
        model = Profile
        fields = [
            "id",
            "email",
            "display_name",
            "avatar_emoji",
            "public_name",
            "xp",
            "level",
            "current_streak",
            "best_streak",
            "timezone",
            "age_band",
            "hide_from_boards",
            "streak_freezes",
            "night_owl",
            "deletion_scheduled_for",
        ]
        read_only_fields = [
            "id",
            "email",
            "xp",
            "current_streak",
            "best_streak",
            "streak_freezes",
            "deletion_scheduled_for",
        ]

    def validate_public_name(self, value: str) -> str:
        """Canonicalise before the model's `validate_public_name` runs (single spaces, NFC)."""
        return clean_public_name(value)

    def validate_age_band(self, value: str) -> str:
        """Self-declared once (decision D6). Changing it later needs support, so a second, different
        answer is a conflict rather than a silent overwrite of a safety setting."""
        if self.instance and self.instance.age_band not in (AgeBand.UNKNOWN, value):
            raise Conflict("Age range has already been set.")
        return value
