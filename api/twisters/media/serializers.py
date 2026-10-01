"""Request validation and response shapes for the media API. No business rules live here beyond
"is this input well formed and does it reference the caller's own rows"."""

from __future__ import annotations

import base64
import binascii
import datetime as dt
import logging
import re
from typing import Any

from django.conf import settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import serializers

from .. import errors
from ..fields import VisibleTwisterField
from ..models import (
    Attempt,
    AttemptWord,
    CaptureSource,
    ConsentType,
    MediaAsset,
    MediaStatus,
    ModerationReport,
    PracticeSession,
    Profile,
    Recording,
    RecordingEndReason,
    ReportReason,
    ShareLink,
    Twister,
    UserConsent,
    Visibility,
)
from ..practice.serializers import _bounded_json
from . import analysis, consent, quota, scorecard, shares
from .storage import StorageError, get_storage

log = logging.getLogger(__name__)

MAX_DIMENSION = 32_767
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_DATA_URI = re.compile(r"^data:image/jpeg;base64,(?P<b64>[A-Za-z0-9+/=\s]+)$")


# --- consent ------------------------------------------------------------------------------------


class ConsentGrantSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=ConsentType.choices)
    version = serializers.CharField(max_length=20)

    def validate(self, attrs):
        if attrs["version"] != consent.current_version(attrs["type"]):
            raise serializers.ValidationError({"version": "Unknown or outdated consent version."})
        return attrs


class ConsentSerializer(serializers.ModelSerializer):
    current = serializers.SerializerMethodField()

    class Meta:
        model = UserConsent
        fields = ["type", "version", "granted_at", "revoked_at", "current"]

    def get_current(self, obj: UserConsent) -> bool:
        return obj.version == consent.current_version(obj.type)


# --- recordings: input --------------------------------------------------------------------------


def own_attempt(
    profile: Profile, attempt_id: int, twister: Twister, *, exclude: Recording | None = None
) -> Attempt:
    """An attempt the caller owns, on the same twister, not already tied to another recording."""
    attempt = Attempt.objects.filter(pk=attempt_id, profile=profile).first()
    if attempt is None or attempt.twister_id != twister.pk:
        raise serializers.ValidationError("Not one of your attempts on this twister.")
    linked = Recording.objects.filter(attempt=attempt).exclude(pk=getattr(exclude, "pk", None))
    if linked.exists():
        raise errors.Conflict("That attempt is already linked to a recording.")
    return attempt


class RecordingCreateSerializer(serializers.Serializer):
    client_recording_id = serializers.UUIDField()
    twister = VisibleTwisterField()
    session_id = serializers.UUIDField(required=False, allow_null=True)
    attempt = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    title = serializers.CharField(max_length=80, required=False, allow_blank=True)
    layout = serializers.SlugField(max_length=24, required=False)
    layout_settings = serializers.DictField(required=False)
    has_camera = serializers.BooleanField(required=False)
    has_screen = serializers.BooleanField(required=False)
    has_mic = serializers.BooleanField(required=False)
    has_system_audio = serializers.BooleanField(required=False)
    duration_ms = serializers.IntegerField(min_value=1, max_value=600_000)
    width = serializers.IntegerField(
        min_value=1, max_value=MAX_DIMENSION, required=False, allow_null=True
    )
    height = serializers.IntegerField(
        min_value=1, max_value=MAX_DIMENSION, required=False, allow_null=True
    )
    fps = serializers.IntegerField(min_value=1, max_value=240, required=False, allow_null=True)
    mime_type = serializers.CharField(max_length=120)
    size_bytes = serializers.IntegerField(min_value=1, max_value=2**40)
    capture_source = serializers.ChoiceField(choices=CaptureSource.choices, required=False)
    recovered = serializers.BooleanField(required=False)
    ended_reason = serializers.ChoiceField(
        choices=RecordingEndReason.choices, required=False, allow_blank=True
    )

    def validate_layout_settings(self, value):
        return _bounded_json(value)

    def validate(self, attrs):
        profile: Profile = self.context["profile"]
        if session_id := attrs.pop("session_id", None):
            session = PracticeSession.objects.filter(pk=session_id, profile=profile).first()
            if session is None:
                raise serializers.ValidationError({"session_id": "Unknown session."})
            attrs["session"] = session
        if attempt_id := attrs.pop("attempt", None):
            try:
                attrs["attempt"] = own_attempt(profile, attempt_id, attrs["twister"])
            except serializers.ValidationError as exc:
                raise serializers.ValidationError({"attempt": exc.detail}) from exc
        return attrs


class RecordingUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=80, allow_blank=True, required=False)
    notes = serializers.CharField(max_length=1000, allow_blank=True, required=False)
    visibility = serializers.ChoiceField(choices=Visibility.choices, required=False)
    expires_at = serializers.DateTimeField(required=False)
    attempt = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    trim_start_ms = serializers.IntegerField(min_value=0, max_value=600_000, required=False)
    trim_end_ms = serializers.IntegerField(
        min_value=1, max_value=600_000, required=False, allow_null=True
    )
    crop_rect = serializers.DictField(
        child=serializers.IntegerField(min_value=0, max_value=MAX_DIMENSION),
        required=False,
        allow_null=True,
    )
    layout_settings = serializers.DictField(required=False)

    def validate_layout_settings(self, value):
        return _bounded_json(value)

    def validate_crop_rect(self, value):
        if value is None:
            return value
        if set(value) != {"x", "y", "w", "h"} or value["w"] < 1 or value["h"] < 1:
            raise serializers.ValidationError("Send x, y, w and h with w and h at least 1.")
        return value

    def validate_expires_at(self, value: dt.datetime):
        recording: Recording = self.instance
        limits = quota.limits_for(self.context["profile"])
        latest = recording.created_at + dt.timedelta(days=limits.retention_days)
        if value < timezone.now():
            raise serializers.ValidationError("Must be in the future.")
        if value > latest:
            raise serializers.ValidationError(
                f"At most {limits.retention_days} days after it was saved."
            )
        return value

    def validate(self, attrs):
        recording: Recording = self.instance
        start = attrs.get("trim_start_ms", recording.trim_start_ms)
        end = attrs.get("trim_end_ms", recording.trim_end_ms)
        if end is not None and (end <= start or end > recording.duration_ms):
            raise serializers.ValidationError(
                {"trim_end_ms": "Must be after the start and within the recording."}
            )
        if start >= recording.duration_ms:
            raise serializers.ValidationError({"trim_start_ms": "Must be inside the recording."})
        if "attempt" in attrs:
            if attrs["attempt"] is None:
                attrs["attempt"] = None
            else:
                try:
                    attrs["attempt"] = own_attempt(
                        self.context["profile"],
                        attrs["attempt"],
                        recording.twister,
                        exclude=recording,
                    )
                except serializers.ValidationError as exc:
                    raise serializers.ValidationError({"attempt": exc.detail}) from exc
        return attrs

    def update(self, instance: Recording, validated: dict[str, Any]) -> Recording:
        for name, value in validated.items():
            setattr(instance, name, value)
        instance.save(update_fields=list(validated))
        return instance


class CompleteSerializer(serializers.Serializer):
    """Body of `complete`. `size_bytes` is informational: the stored size is what counts."""

    size_bytes = serializers.IntegerField(min_value=1, max_value=2**40, required=False)
    checksum_sha256 = serializers.RegexField(_SHA256, required=False, allow_null=True)
    thumbnail = serializers.CharField(required=False, allow_null=True, allow_blank=True)

    def validate_thumbnail(self, value: str | None) -> bytes | None:
        """`data:image/jpeg;base64,…` → JPEG bytes (≤ 200 KB). Empty means no thumbnail."""
        if not value:
            return None
        match = _DATA_URI.match(value)
        if match is None:
            raise serializers.ValidationError("Send a data:image/jpeg;base64 URI.")
        try:
            data = base64.b64decode(match["b64"], validate=False)
        except (binascii.Error, ValueError) as exc:
            raise serializers.ValidationError("Invalid base64.") from exc
        if len(data) > settings.THUMBNAIL_MAX_BYTES:
            raise serializers.ValidationError("At most 200 KB.")
        if not data.startswith(b"\xff\xd8\xff"):
            raise serializers.ValidationError("Not a JPEG.")
        return data


class VoiceCreateSerializer(serializers.Serializer):
    mime_type = serializers.CharField(max_length=120)
    size_bytes = serializers.IntegerField(min_value=1, max_value=2**40)
    duration_ms = serializers.IntegerField(min_value=1, max_value=600_000)


class ShareCreateSerializer(serializers.Serializer):
    expires_in = serializers.ChoiceField(choices=list(shares.EXPIRY_CHOICES), default="7d")


class ReportSerializer(serializers.Serializer):
    reason = serializers.ChoiceField(choices=ReportReason.choices)
    details = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")


# --- recordings: output -------------------------------------------------------------------------


def signed_map(assets: list[MediaAsset | None], ttl_s: int) -> dict:
    """asset id → signed URL for many assets, one storage round-trip per bucket. Signing failures
    degrade to "no URL" (the caller still has the metadata); public playback checks explicitly."""
    by_bucket: dict[str, list[MediaAsset]] = {}
    for asset in assets:
        if asset is not None and asset.status == MediaStatus.READY:
            by_bucket.setdefault(asset.bucket, []).append(asset)
    out: dict = {}
    storage = get_storage()
    for bucket, group in by_bucket.items():
        try:
            urls = storage.signed_urls(bucket, [a.path for a in group], ttl_s)
        except StorageError:
            log.warning("media.sign_failed bucket=%s", bucket)
            continue
        out.update({a.pk: urls[a.path] for a in group if a.path in urls})
    return out


def playback_block(asset: MediaAsset, url: str) -> dict:
    return {
        "url": url,
        "expires_at": timezone.now() + dt.timedelta(seconds=settings.PLAYBACK_URL_TTL_S),
        "mime": asset.mime_type,
    }


class RecordingSerializer(serializers.ModelSerializer):
    """List row. Context `urls` (asset id → signed URL) supplies the thumbnail."""

    twister = serializers.SlugRelatedField(slug_field="slug", read_only=True)
    twister_text = serializers.CharField(source="twister.text", read_only=True)
    attempt_id = serializers.IntegerField(read_only=True)
    session_id = serializers.UUIDField(read_only=True)
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = Recording
        fields = [
            "id",
            "client_recording_id",
            "twister",
            "twister_text",
            "session_id",
            "attempt_id",
            "title",
            "notes",
            "layout",
            "layout_settings",
            "crop_rect",
            "trim_start_ms",
            "trim_end_ms",
            "has_camera",
            "has_screen",
            "has_mic",
            "has_system_audio",
            "duration_ms",
            "width",
            "height",
            "fps",
            "mime_type",
            "size_bytes",
            "capture_source",
            "status",
            "failure_reason",
            "recovered",
            "captions_source",
            "visibility",
            "ended_reason",
            "consented_at",
            "expires_at",
            "deleted_at",
            "hidden_at",
            "created_at",
            "thumbnail_url",
        ]

    def get_thumbnail_url(self, obj: Recording) -> str | None:
        return self.context.get("urls", {}).get(obj.thumbnail_asset_id)


class MarkerWordSerializer(serializers.ModelSerializer):
    target = serializers.CharField(source="target_word")
    spoken = serializers.CharField(source="spoken_word")

    class Meta:
        model = AttemptWord
        fields = ["target_index", "target", "spoken", "status", "reason", "start_ms", "end_ms"]


class AttemptSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Attempt
        fields = [
            "id",
            "public_id",
            "kind",
            "score",
            "accuracy",
            "wpm",
            "duration_ms",
            "created_at",
        ]


class RecordingDetailSerializer(RecordingSerializer):
    attempt = serializers.SerializerMethodField()
    words = serializers.SerializerMethodField()
    playback = serializers.SerializerMethodField()
    captions_url = serializers.SerializerMethodField()
    analysis = serializers.SerializerMethodField()

    class Meta(RecordingSerializer.Meta):
        fields = [
            *RecordingSerializer.Meta.fields,
            "attempt",
            "words",
            "playback",
            "captions_url",
            "analysis",
        ]

    def get_attempt(self, obj: Recording) -> dict | None:
        return AttemptSummarySerializer(obj.attempt).data if obj.attempt_id else None

    def get_words(self, obj: Recording) -> list:
        if not obj.attempt_id:
            return []
        return MarkerWordSerializer(obj.attempt.words.all(), many=True).data

    def get_playback(self, obj: Recording) -> dict | None:
        asset = obj.video_asset
        url = self.context.get("urls", {}).get(asset.pk) if asset else None
        if obj.status != "ready" or url is None:
            return None
        return playback_block(asset, url)

    def get_captions_url(self, obj: Recording) -> str | None:
        return self.context.get("urls", {}).get(obj.captions_asset_id)

    def get_analysis(self, obj: Recording) -> dict:
        return analysis.block(obj)


def recording_urls(recordings: list[Recording], *, detail: bool) -> dict:
    assets: list[MediaAsset | None] = []
    for recording in recordings:
        assets.append(recording.thumbnail_asset)
        if detail:
            assets += [recording.video_asset, recording.captions_asset]
    return signed_map(assets, settings.PLAYBACK_URL_TTL_S)


def recording_payload(recording: Recording, *, detail: bool = True) -> dict:
    serializer = RecordingDetailSerializer if detail else RecordingSerializer
    urls = recording_urls([recording], detail=detail)
    return serializer(recording, context={"urls": urls}).data


# --- shares & public ----------------------------------------------------------------------------


class ShareLinkSerializer(serializers.ModelSerializer):
    active = serializers.SerializerMethodField()

    class Meta:
        model = ShareLink
        fields = [
            "id",
            "target_type",
            "target_id",
            "expires_at",
            "revoked_at",
            "view_count",
            "last_viewed_at",
            "created_at",
            "active",
        ]

    def get_active(self, obj: ShareLink) -> bool:
        return obj.revoked_at is None and obj.hidden_at is None and obj.expires_at > timezone.now()


def owner_name(profile: Profile) -> str | None:
    """What anonymous viewers may learn about the sharer: only the opt-in public name, never the
    account display name (which defaults to the e-mail local part) or anything else."""
    return profile.public_name or None


def public_recording_body(resolved: shares.Resolved) -> dict:
    """What an anonymous viewer of a recording link may see: no ids, emails or storage paths."""
    recording = resolved.recording
    asset = recording.video_asset
    urls = signed_map([asset, recording.captions_asset], settings.PLAYBACK_URL_TTL_S)
    if asset is None or asset.pk not in urls:
        raise errors.dependency_unavailable("Playback is unavailable; try again shortly.")
    body: dict[str, Any] = {
        "title": recording.title,
        "twister": {"slug": recording.twister.slug, "text": recording.twister.text},
        "duration_ms": recording.duration_ms,
        "trim_start_ms": recording.trim_start_ms,
        "trim_end_ms": recording.trim_end_ms,
        "playback": playback_block(asset, urls[asset.pk]),
        "owner": {"display_name": owner_name(recording.profile)},
    }
    if recording.attempt_id:
        body["score"] = recording.attempt.score
    if recording.captions_asset_id in urls:
        body["captions_url"] = urls[recording.captions_asset_id]
    return body


def score_card_image_urls(token: str) -> dict[str, str] | None:
    """Absolute image URLs for a link, or None while `API_PUBLIC_URL` is unset (nothing to build on)."""
    if not settings.API_PUBLIC_URL:
        return None
    path = reverse("public-score-card-image", kwargs={"token": token})
    return {size: f"{settings.API_PUBLIC_URL}{path}?size={size}" for size in scorecard.SIZES}


def score_card_payload(resolved: shares.Resolved) -> scorecard.ScoreCardPayload:
    """The only inputs the image is ever drawn from: what a stranger may see, nothing else."""
    attempt = resolved.attempt
    return scorecard.ScoreCardPayload(
        score=attempt.score,
        accuracy=attempt.accuracy,
        wpm=attempt.wpm,
        twister_text=attempt.twister.text,
        owner_name=owner_name(attempt.profile),
    )


def public_score_card_body(resolved: shares.Resolved, token: str) -> dict:
    """Score, per-word verdicts, the twister text and the opt-in public name. No media, no e-mail."""
    attempt = resolved.attempt
    words = attempt.words.filter(target_index__isnull=False).order_by("target_index")
    body = {
        "score": attempt.score,
        "accuracy": attempt.accuracy,
        "wpm": attempt.wpm,
        "kind": attempt.kind,
        "twister": {"slug": attempt.twister.slug, "text": attempt.twister.text},
        "words": [{"target": w.target_word, "status": w.status} for w in words],
        "owner": {"display_name": owner_name(attempt.profile)},
        "created_at": attempt.created_at,
    }
    if images := score_card_image_urls(token):
        body["images"] = images
    return body


class ModerationReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModerationReport
        fields = ["id", "reason", "created_at"]
