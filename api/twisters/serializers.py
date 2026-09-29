from rest_framework import serializers

from .models import Attempt, Category, Profile, Twister


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
        fields = ["slug", "text", "category", "difficulty", "difficulty_label", "origin", "tip",
                  "focus_sounds", "word_count", "is_favorite", "best_score"]

    def _fav_ids(self):
        return self.context.get("favorite_ids", set())

    def _best(self):
        return self.context.get("best_scores", {})

    def get_is_favorite(self, obj):
        return obj.id in self._fav_ids()

    def get_best_score(self, obj):
        return self._best().get(obj.id)


class AttemptCreateSerializer(serializers.Serializer):
    twister = serializers.SlugRelatedField(slug_field="slug", queryset=Twister.objects.filter(is_published=True))
    transcript = serializers.CharField(allow_blank=True, max_length=3000)
    duration_ms = serializers.IntegerField(min_value=300, max_value=300_000)


class AttemptSerializer(serializers.ModelSerializer):
    twister = serializers.SlugRelatedField(slug_field="slug", read_only=True)

    class Meta:
        model = Attempt
        fields = ["id", "twister", "transcript", "accuracy", "wpm", "score", "xp_awarded", "duration_ms", "created_at"]


class ProfileSerializer(serializers.ModelSerializer):
    level = serializers.IntegerField(read_only=True)

    class Meta:
        model = Profile
        fields = ["id", "email", "display_name", "avatar_emoji", "xp", "level", "current_streak", "best_streak"]
        read_only_fields = ["id", "email", "xp", "current_streak", "best_streak"]
