"""Idempotent import of what a guest did before signing up (decision D12)."""
import datetime as dt
import hashlib
import json

from django.utils import timezone
from rest_framework import serializers

from .. import scoring
from ..models import Attempt, Favorite, Profile, SyncBatch, SyncKind, Twister, UserPreference
from .serializers import PreferenceSerializer

MAX_ATTEMPTS = 50
MAX_FAVORITES = 200
MAX_BACKDATE = dt.timedelta(days=365)


class AttemptImportSerializer(serializers.Serializer):
    client_attempt_id = serializers.UUIDField()
    twister = serializers.SlugRelatedField(slug_field="slug", queryset=Twister.objects.filter(is_published=True))
    transcript = serializers.CharField(allow_blank=True, max_length=3000)
    duration_ms = serializers.IntegerField(min_value=300, max_value=300_000)
    created_at = serializers.DateTimeField(required=False)


class GuestSyncSerializer(serializers.Serializer):
    client_batch_id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=SyncKind.choices, default=SyncKind.GUEST_SIGNUP)
    preferences = serializers.DictField(required=False)
    favorites = serializers.ListField(child=serializers.CharField(max_length=80), max_length=MAX_FAVORITES, default=list)
    # Items are validated one by one so a single bad row is rejected, not the whole batch.
    attempts = serializers.ListField(child=serializers.DictField(), max_length=MAX_ATTEMPTS, default=list)


def _import_preferences(profile: Profile, data: dict | None) -> None:
    """Fresh accounts adopt guest settings; an existing account's settings always win (merge, not overwrite)."""
    prefs, created = UserPreference.objects.get_or_create(profile=profile)
    if not (created and data):
        return
    ser = PreferenceSerializer(prefs, data=data, partial=True)
    if ser.is_valid():
        ser.save()


def _import_favorites(profile: Profile, slugs: list[str]) -> int:
    twisters = Twister.objects.filter(slug__in=set(slugs), is_published=True)
    existing = set(Favorite.objects.filter(profile=profile).values_list("twister_id", flat=True))
    new = [Favorite(profile=profile, twister=t) for t in twisters if t.id not in existing]
    Favorite.objects.bulk_create(new)
    return len(new)


def _import_attempts(profile: Profile, items: list[dict], now: dt.datetime) -> tuple[int, int]:
    """Returns (imported, rejected). Guest attempts are re-scored server-side and earn no XP or streak."""
    seen = set(Attempt.objects.filter(profile=profile, client_attempt_id__isnull=False)
               .values_list("client_attempt_id", flat=True))
    imported = rejected = 0
    for raw in items:
        item = AttemptImportSerializer(data=raw)
        if not item.is_valid():
            rejected += 1
            continue
        d = item.validated_data
        if d["client_attempt_id"] in seen:
            continue  # duplicate of an earlier import — neither imported nor an error
        seen.add(d["client_attempt_id"])
        result = scoring.compute(d["twister"].text, d["transcript"], d["duration_ms"], d["twister"].difficulty)
        attempt = Attempt.objects.create(
            profile=profile, twister=d["twister"], transcript=d["transcript"], duration_ms=d["duration_ms"],
            client_attempt_id=d["client_attempt_id"], accuracy=result["accuracy"], wpm=result["wpm"],
            score=result["score"], xp_awarded=0)
        when = min(now, max(now - MAX_BACKDATE, d.get("created_at", now)))
        Attempt.objects.filter(pk=attempt.pk).update(created_at=when)  # auto_now_add ignores create() kwargs
        imported += 1
    return imported, rejected


def import_batch(profile: Profile, data: dict) -> tuple[SyncBatch, bool]:
    """Apply a validated payload once per (profile, client_batch_id). Caller holds the profile lock."""
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()
    batch, created = SyncBatch.objects.get_or_create(
        profile=profile, client_batch_id=data["client_batch_id"], defaults={"kind": data["kind"], "payload_sha256": digest})
    if not created:
        return batch, False
    now = timezone.now()
    _import_preferences(profile, data.get("preferences"))
    batch.favorites_imported = _import_favorites(profile, data["favorites"])
    batch.attempts_imported, batch.rejected = _import_attempts(profile, data["attempts"], now)
    batch.save()
    if profile.guest_migrated_at is None:
        profile.guest_migrated_at = now
        profile.save(update_fields=["guest_migrated_at"])
    return batch, True
