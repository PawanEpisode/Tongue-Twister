from rest_framework import serializers

from .errors import Conflict
from .models import AgeBand, Category, Profile, Twister
from .names import clean_public_name


class CategorySerializer(serializers.ModelSerializer):
    count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Category
        fields = ["slug", "name", "emoji", "description", "count"]


class TwisterSerializer(serializers.ModelSerializer):
    category = serializers.SlugRelatedField(slug_field="slug", read_only=True)
    difficulty_label = serializers.CharField(source="get_difficulty_display", read_only=True)
    is_favorite = serializers.SerializerMethodField()
    best_score = serializers.SerializerMethodField()

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
            "is_favorite",
            "best_score",
        ]

    def _fav_ids(self):
        return self.context.get("favorite_ids", set())

    def _best(self):
        return self.context.get("best_scores", {})

    def get_is_favorite(self, obj):
        return obj.id in self._fav_ids()

    def get_best_score(self, obj):
        return self._best().get(obj.id)


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
        ]
        read_only_fields = ["id", "email", "xp", "current_streak", "best_streak"]

    def validate_public_name(self, value: str) -> str:
        """Canonicalise before the model's `validate_public_name` runs (single spaces, NFC)."""
        return clean_public_name(value)

    def validate_age_band(self, value: str) -> str:
        """Self-declared once (decision D6). Changing it later needs support, so a second, different
        answer is a conflict rather than a silent overwrite of a safety setting."""
        if self.instance and self.instance.age_band not in (AgeBand.UNKNOWN, value):
            raise Conflict("Age range has already been set.")
        return value
