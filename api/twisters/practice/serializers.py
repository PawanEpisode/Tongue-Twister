import json

from rest_framework import serializers

from ..models import EndReason, Plan, PracticeSession, SessionStatus, Twister, UserPreference

MAX_JSON_BYTES = 4096


def _bounded_json(value):
    if len(json.dumps(value)) > MAX_JSON_BYTES:
        raise serializers.ValidationError(f"Must be at most {MAX_JSON_BYTES} bytes.")
    return value


class PreferenceSerializer(serializers.ModelSerializer):
    """Numeric ranges come from the model validators, so API and DB can't disagree."""

    class Meta:
        model = UserPreference
        exclude = ["profile"]
        read_only_fields = ["updated_at", "schema_version"]

    def validate_extra(self, value):
        return _bounded_json(value)

    def validate_speed_ladder(self, value):
        return _bounded_json(value)

    def update(self, instance, validated):
        # `extra` is merged key-by-key (two devices editing different keys don't clobber each other);
        # every other field is last-write-wins.
        if "extra" in validated:
            validated["extra"] = {**instance.extra, **validated["extra"]}
        return super().update(instance, validated)


class SessionCreateSerializer(serializers.ModelSerializer):
    twister = serializers.SlugRelatedField(slug_field="slug", queryset=Twister.objects.filter(is_published=True))

    class Meta:
        model = PracticeSession
        fields = ["client_session_id", "twister", "mode", "submode", "settings_snapshot", "engine", "user_agent_family"]

    def validate_settings_snapshot(self, value):
        return _bounded_json(value)


class SessionUpdateSerializer(serializers.ModelSerializer):
    status = serializers.ChoiceField(choices=[SessionStatus.COMPLETED, SessionStatus.ABANDONED], required=False)

    class Meta:
        model = PracticeSession
        fields = ["status", "ended_reason", "active_ms", "loops_completed", "passes_completed", "avg_wpm"]
        extra_kwargs = {"avg_wpm": {"min_value": 0, "max_value": 1000}}

    def validate(self, attrs):
        if "status" in attrs:
            attrs.setdefault("ended_reason", EndReason.FINISHED if attrs["status"] == SessionStatus.COMPLETED else EndReason.USER)
        elif "ended_reason" in attrs:
            raise serializers.ValidationError({"ended_reason": "Only valid together with status."})
        return attrs


class SessionSerializer(serializers.ModelSerializer):
    twister = serializers.SlugRelatedField(slug_field="slug", read_only=True)

    class Meta:
        model = PracticeSession
        fields = ["id", "client_session_id", "twister", "mode", "submode", "status", "ended_reason", "started_at",
                  "ended_at", "active_ms", "loops_completed", "passes_completed", "avg_wpm", "settings_snapshot",
                  "engine", "user_agent_family"]
        read_only_fields = fields


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = ["code", "name", "limits"]
