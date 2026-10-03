"""Request validation and response shapes for the progress endpoints (contract 07 S15)."""

from django.conf import settings
from rest_framework import serializers

from ..models import Achievement, ProfileEvent, UserAchievement
from . import achievements as engine

SECRET_NAME = "Secret achievement"
SECRET_DESCRIPTION = "Keep practising to find it."
SECRET_ICON = "lock"
STATS_RANGES = ("7d", "30d", "90d", "all")
STATS_MODES = ("speak_score", "read_along", "record")
DEFAULT_ACTIVITY_WEEKS, MAX_ACTIVITY_WEEKS = 12, 52


class AchievementBriefSerializer(serializers.ModelSerializer):
    """What a toast needs; also the shape inside `achievements_unlocked` on attempt responses."""

    class Meta:
        model = Achievement
        fields = ["code", "name", "description", "icon", "tier", "xp_reward"]
        read_only_fields = fields


class UnseenAchievementSerializer(AchievementBriefSerializer):
    """An unlock the user has not been shown yet; built from a `UserAchievement`."""

    code = serializers.CharField(source="achievement.code")
    name = serializers.CharField(source="achievement.name")
    description = serializers.CharField(source="achievement.description")
    icon = serializers.CharField(source="achievement.icon")
    tier = serializers.CharField(source="achievement.tier")
    xp_reward = serializers.IntegerField(source="achievement.xp_reward")

    class Meta:
        model = UserAchievement
        fields = [*AchievementBriefSerializer.Meta.fields, "unlocked_at"]
        read_only_fields = fields


class AchievementViewSerializer(serializers.Serializer):
    """One row of `GET /me/achievements/`. A locked secret badge reveals nothing but its category."""

    def to_representation(self, view: engine.AchievementView) -> dict:
        a = view.achievement
        secret = a.hidden and view.unlocked_at is None
        return {
            "code": a.code,
            "name": SECRET_NAME if secret else a.name,
            "description": SECRET_DESCRIPTION if secret else a.description,
            "icon": SECRET_ICON if secret else a.icon,
            "tier": a.tier,
            "category": a.category,
            "xp_reward": a.xp_reward,
            "unlocked_at": view.unlocked_at,
            "progress": None if secret else view.progress,
            "seen": view.seen,
        }


def unlocked_payload(unlocked: list[engine.Unlocked]) -> list[dict]:
    return AchievementBriefSerializer([u.achievement for u in unlocked], many=True).data


class SeenSerializer(serializers.Serializer):
    codes = serializers.ListField(
        child=serializers.CharField(max_length=40),
        required=False,
        allow_empty=True,
        max_length=settings.ACHIEVEMENT_SEEN_MAX_CODES,
    )


class StatsQuerySerializer(serializers.Serializer):
    range = serializers.ChoiceField(choices=STATS_RANGES, default="30d")
    mode = serializers.ChoiceField(choices=STATS_MODES, required=False, default=None)


class ActivityQuerySerializer(serializers.Serializer):
    weeks = serializers.IntegerField(
        min_value=1, max_value=MAX_ACTIVITY_WEEKS, default=DEFAULT_ACTIVITY_WEEKS
    )


class ProfileEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProfileEvent
        fields = ["id", "kind", "data", "created_at"]
        read_only_fields = fields
