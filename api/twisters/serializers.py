from rest_framework import serializers

from .models import Category, Profile, Twister


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
            "xp",
            "level",
            "current_streak",
            "best_streak",
            "timezone",
        ]
        read_only_fields = ["id", "email", "xp", "current_streak", "best_streak"]
