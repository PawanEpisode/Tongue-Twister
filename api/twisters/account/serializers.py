from rest_framework import serializers

CONFIRM_WORD = "DELETE"


class DeleteAccountSerializer(serializers.Serializer):
    """`DELETE /me/` body. Typing the word is the whole confirmation; anything else is a 400."""

    confirm = serializers.CharField()

    def validate_confirm(self, value: str) -> str:
        if value != CONFIRM_WORD:
            raise serializers.ValidationError(f'Send "{CONFIRM_WORD}" to confirm.')
        return value


class DeletionStateSerializer(serializers.Serializer):
    """Both dates are null for an account that is not pending deletion."""

    deletion_requested_at = serializers.DateTimeField(allow_null=True)
    deletion_scheduled_for = serializers.DateTimeField(allow_null=True)
