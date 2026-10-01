"""Serializer fields shared across apps."""

from rest_framework import serializers

from .models import Profile, Twister


class VisibleTwisterField(serializers.SlugRelatedField):
    """A twister by slug, restricted to what *this caller* may open (D25): the public catalogue plus
    their own private twisters. Someone else's private slug is a plain "does not exist"."""

    def __init__(self, **kwargs):
        super().__init__(slug_field="slug", **kwargs)

    def get_queryset(self):
        """The caller comes from `context["profile"]`, the convention of the attempt and recording
        serializers; without one (a bare serializer) only the public catalogue is visible."""
        profile = self.context.get("profile")
        return Twister.objects.visible_to(profile if isinstance(profile, Profile) else None)
