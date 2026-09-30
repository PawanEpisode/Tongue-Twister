"""Request/response shapes for Speak & Score (API contract 07 §5, §13)."""

import logging
import math
import re

from rest_framework import serializers

from ..errors import model_unsupported
from ..models import (
    AccentLang,
    AcousticModelVersion,
    Attempt,
    AttemptFeedback,
    AttemptKind,
    AttemptPhoneme,
    AttemptWord,
    Engine,
    PhonemeVerdict,
    PracticeSession,
    Profile,
    ScoringProfile,
    Twister,
    UserPreference,
    WordReason,
)
from ..practice import flags
from . import device, service
from .normalise import tokenise

log = logging.getLogger(__name__)

MAX_QUALITY_KEYS = 12
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ACCURATE_MODE_FLAG = "accurate_mode"
CLIENT_ENGINES = [
    Engine.TEXT_LAYER,
    Engine.ONDEVICE,
]  # `worker` results only arrive via the worker callback


def _finite(value):
    if value is not None and not math.isfinite(value):
        raise serializers.ValidationError("Must be a finite number.")
    return value


class SttWordSerializer(serializers.Serializer):
    w = serializers.CharField(max_length=64, allow_blank=True)
    conf = serializers.FloatField(min_value=0, max_value=1, required=False, allow_null=True)
    start_ms = serializers.IntegerField(
        min_value=0, max_value=600_000, required=False, allow_null=True
    )
    end_ms = serializers.IntegerField(
        min_value=0, max_value=600_000, required=False, allow_null=True
    )


class SttSerializer(serializers.Serializer):
    engine = serializers.ChoiceField(choices=CLIENT_ENGINES, required=False)
    lang = serializers.ChoiceField(choices=AccentLang.choices, required=False)
    confidence = serializers.FloatField(min_value=0, max_value=1, required=False, allow_null=True)
    words = SttWordSerializer(
        many=True, required=False, max_length=service.pipeline.MAX_SPOKEN_TOKENS
    )


class DevicePhonemeSerializer(serializers.Serializer):
    t = serializers.CharField(max_length=8)
    verdict = serializers.ChoiceField(choices=PhonemeVerdict.choices)
    heard = serializers.CharField(max_length=8, required=False, allow_null=True, allow_blank=True)
    variant = serializers.CharField(max_length=40, required=False, allow_blank=True)
    delta = serializers.FloatField(required=False, allow_null=True, validators=[_finite])
    lpp = serializers.FloatField(required=False, allow_null=True, validators=[_finite])
    lpr = serializers.FloatField(required=False, allow_null=True, validators=[_finite])
    start_ms = serializers.IntegerField(
        min_value=0, max_value=600_000, required=False, allow_null=True
    )
    end_ms = serializers.IntegerField(
        min_value=0, max_value=600_000, required=False, allow_null=True
    )


class DeviceWordSerializer(serializers.Serializer):
    i = serializers.IntegerField(min_value=0)
    target = serializers.CharField(max_length=64)
    status = serializers.ChoiceField(choices=sorted(device.DEVICE_STATUSES))
    reason = serializers.ChoiceField(choices=WordReason.choices, required=False, allow_blank=True)
    confidence = serializers.FloatField(min_value=0, max_value=1, required=False, allow_null=True)
    acoustic_score = serializers.FloatField(
        min_value=0, max_value=100, required=False, allow_null=True
    )
    phoneme_distance = serializers.FloatField(required=False, allow_null=True, validators=[_finite])
    start_ms = serializers.IntegerField(
        min_value=0, max_value=600_000, required=False, allow_null=True
    )
    end_ms = serializers.IntegerField(
        min_value=0, max_value=600_000, required=False, allow_null=True
    )
    phonemes = DevicePhonemeSerializer(
        many=True, required=False, max_length=device.MAX_PHONEMES_PER_WORD
    )


class ClientScoreSerializer(serializers.Serializer):
    """Diagnostics only: the server never trusts it, but drift between client and server is logged."""

    version = serializers.IntegerField(required=False)
    score = serializers.IntegerField(min_value=0, max_value=100)


class SegmentSerializer(serializers.Serializer):
    """Which words of the twister were practised: scoring tokens `start` (inclusive) to `end` (exclusive)."""

    start = serializers.IntegerField(min_value=0, max_value=service.pipeline.MAX_SPOKEN_TOKENS)
    end = serializers.IntegerField(min_value=1, max_value=service.pipeline.MAX_SPOKEN_TOKENS)


class AttemptSubmitSerializer(serializers.Serializer):
    client_attempt_id = serializers.UUIDField(required=False, allow_null=True)
    twister = serializers.SlugRelatedField(
        slug_field="slug", queryset=Twister.objects.filter(is_published=True)
    )
    session_id = serializers.UUIDField(required=False, allow_null=True)
    kind = serializers.ChoiceField(
        choices=[AttemptKind.TEST, AttemptKind.TRAIN, AttemptKind.DRILL], default=AttemptKind.TEST
    )
    segment = SegmentSerializer(required=False)
    transcript = serializers.CharField(
        allow_blank=True, max_length=service.TEXT_MAX, trim_whitespace=True
    )
    duration_ms = serializers.IntegerField(min_value=300, max_value=300_000)
    long_pause_ms = serializers.IntegerField(min_value=0, max_value=300_000, default=0)
    stt = SttSerializer(required=False)
    voice_asset_id = serializers.UUIDField(required=False, allow_null=True)
    client_score = ClientScoreSerializer(required=False)
    # Device engine (Tier 1) fields, docs/features/10 §5
    engine = serializers.ChoiceField(choices=CLIENT_ENGINES, required=False)
    engine_version = serializers.CharField(max_length=40, required=False, allow_blank=True)
    model_version = serializers.CharField(max_length=80, required=False, allow_blank=True)
    scoring_profile = serializers.CharField(max_length=40, required=False, allow_blank=True)
    nonce = serializers.UUIDField(required=False, allow_null=True)
    audio_sha256 = serializers.CharField(max_length=64, required=False, allow_null=True)
    quality = serializers.DictField(required=False)
    words = DeviceWordSerializer(many=True, required=False, max_length=600)
    # Offline queue only (POST /attempts/sync/): when the attempt really happened.
    occurred_at = serializers.DateTimeField(required=False)

    def validate_audio_sha256(self, value):
        value = value.lower() if value else value
        if value and not SHA256.match(value):
            raise serializers.ValidationError("Must be a lowercase hex SHA-256.")
        return value

    def validate_quality(self, value):
        if len(value) > MAX_QUALITY_KEYS or not all(
            isinstance(v, bool | int | float | str)
            and (not isinstance(v, float) or math.isfinite(v))
            for v in value.values()
        ):
            raise serializers.ValidationError("Unsupported quality report.")
        return value

    def validate(self, attrs):
        stt = attrs.get("stt", {})
        engine = attrs.get("engine") or stt.get("engine") or Engine.TEXT_LAYER
        attrs["engine"] = engine
        self._check_segment(attrs, engine)
        if attrs["long_pause_ms"] > attrs["duration_ms"]:
            raise serializers.ValidationError({"long_pause_ms": "Cannot exceed duration_ms."})
        if engine == Engine.ONDEVICE:
            if not flags.enabled(ACCURATE_MODE_FLAG, self.context.get("profile")):
                raise model_unsupported()  # kill switch: clients fall back to basic scoring
            attrs["model_version"] = self._resolve_model(attrs.get("model_version"))
            attrs["scoring_profile"] = self._resolve_profile(
                attrs.get("scoring_profile"), attrs["model_version"]
            )
        elif attrs.get("words") or attrs.get("model_version") or attrs.get("scoring_profile"):
            raise serializers.ValidationError(
                {"words": "Word verdicts are only accepted from the on-device engine."}
            )
        if attrs.get("words"):
            try:
                device.validate(
                    [self._device_word(w) for w in attrs["words"]], tokenise(attrs["twister"].text)
                )
            except device.DeviceResultError as exc:
                raise serializers.ValidationError({"words": str(exc)}) from exc
        return attrs

    @staticmethod
    def _check_segment(attrs, engine) -> None:
        segment = attrs.get("segment")
        if not segment:
            return
        problem = None
        if attrs["kind"] not in (AttemptKind.TRAIN, AttemptKind.DRILL):
            problem = "Only Train and Drill attempts can practise part of a twister."
        elif engine != Engine.TEXT_LAYER or attrs.get("words"):
            problem = "Part-twister attempts are scored from text only."
        elif not segment["start"] < segment["end"] <= len(tokenise(attrs["twister"].text)):
            problem = "Must be a non-empty range inside the twister's words."
        if problem:
            raise serializers.ValidationError({"segment": problem})

    @staticmethod
    def _resolve_model(name):
        model = AcousticModelVersion.objects.filter(name=name or "", active=True).first()
        if model is None:
            raise model_unsupported()
        return model

    @staticmethod
    def _resolve_profile(code, model):
        profile = ScoringProfile.objects.filter(
            code=code or "", model_version=model, active=True
        ).first()
        if profile is None:
            raise model_unsupported()
        return profile

    @staticmethod
    def _device_word(w: dict) -> device.DeviceWord:
        return device.DeviceWord(
            index=w["i"],
            target=w["target"],
            status=w["status"],
            reason=w.get("reason", ""),
            confidence=w.get("confidence"),
            acoustic_score=w.get("acoustic_score"),
            phoneme_distance=w.get("phoneme_distance"),
            start_ms=w.get("start_ms"),
            end_ms=w.get("end_ms"),
            phonemes=[
                device.DevicePhoneme(
                    target=p["t"],
                    verdict=p["verdict"],
                    heard=p.get("heard") or None,
                    variant=p.get("variant", ""),
                    delta=p.get("delta"),
                    lpp=p.get("lpp"),
                    lpr=p.get("lpr"),
                    start_ms=p.get("start_ms"),
                    end_ms=p.get("end_ms"),
                )
                for p in w.get("phonemes", [])
            ],
        )

    def to_submission(self, profile: Profile, *, earns_progress: bool = True) -> service.Submission:
        d = self.validated_data
        stt = d.get("stt", {})
        session = None
        if d.get(
            "session_id"
        ):  # advisory link; someone else's or unknown session is simply ignored
            session = PracticeSession.objects.filter(pk=d["session_id"], profile=profile).first()
        lang = stt.get("lang") or self._preferred_lang(profile)
        return service.Submission(
            twister=d["twister"],
            transcript=d["transcript"],
            duration_ms=d["duration_ms"],
            kind=d["kind"],
            segment=(d["segment"]["start"], d["segment"]["end"]) if d.get("segment") else None,
            long_pause_ms=d["long_pause_ms"],
            client_attempt_id=d.get("client_attempt_id"),
            session=session,
            engine=d["engine"],
            engine_version=d.get("engine_version", ""),
            confidence=stt.get("confidence"),
            lang=lang,
            model_version=d.get("model_version"),
            scoring_profile=d.get("scoring_profile"),
            nonce=d.get("nonce"),
            audio_sha256=d.get("audio_sha256") or None,
            quality=d.get("quality", {}),
            device_words=[self._device_word(w) for w in d.get("words", [])],
            spoken_meta={
                i: service.SpokenMeta(w.get("conf"), w.get("start_ms"), w.get("end_ms"))
                for i, w in enumerate(stt.get("words", []))
            },
            voice_asset_id=d.get("voice_asset_id"),
            occurred_at=d.get("occurred_at"),
            earns_progress=earns_progress,
        )

    @staticmethod
    def _preferred_lang(profile: Profile) -> str:
        return (
            UserPreference.objects.filter(profile=profile)
            .values_list("accent_lang", flat=True)
            .first()
            or ""
        )

    def log_drift(self, attempt: Attempt) -> None:
        client = self.validated_data.get("client_score")
        if client and abs(client["score"] - attempt.score) >= 10:
            log.info("speak.score_drift client=%s server=%s", client["score"], attempt.score)


# --- responses -------------------------------------------------------------------------------------


class PhonemeSerializer(serializers.ModelSerializer):
    target = serializers.CharField(source="target_phoneme")
    heard = serializers.SerializerMethodField()

    def get_heard(self, obj) -> str | None:
        return obj.heard_phoneme or None

    class Meta:
        model = AttemptPhoneme
        fields = [
            "idx",
            "target",
            "heard",
            "variant_used",
            "verdict",
            "delta",
            "lpp",
            "lpr",
            "start_ms",
            "end_ms",
        ]


class WordSerializer(serializers.ModelSerializer):
    """`target`/`spoken` are the normalised words; UI maps `target_index` to the twister's tokens."""

    target = serializers.CharField(source="target_word")
    spoken = serializers.CharField(source="spoken_word")
    phonemes = PhonemeSerializer(many=True, read_only=True)

    class Meta:
        model = AttemptWord
        fields = [
            "target_index",
            "spoken_index",
            "target",
            "spoken",
            "status",
            "reason",
            "credit",
            "confidence",
            "acoustic_score",
            "phoneme_distance",
            "start_ms",
            "end_ms",
            "phonemes",
        ]


class AttemptSerializer(serializers.ModelSerializer):
    """List/history row."""

    twister = serializers.SlugRelatedField(slug_field="slug", read_only=True)
    model_version = serializers.SlugRelatedField(slug_field="name", read_only=True)

    class Meta:
        model = Attempt
        fields = [
            "id",
            "public_id",
            "twister",
            "kind",
            "transcript",
            "accuracy",
            "speed_score",
            "fluency_score",
            "completeness",
            "wpm",
            "score",
            "score_version",
            "xp_awarded",
            "duration_ms",
            "engine",
            "model_version",
            "verification_status",
            "is_personal_best",
            "flagged",
            "created_at",
        ]


class AttemptDetailSerializer(AttemptSerializer):
    words = WordSerializer(many=True, read_only=True)

    class Meta(AttemptSerializer.Meta):
        fields = [
            *AttemptSerializer.Meta.fields,
            "long_pause_ms",
            "gop_score",
            "lang",
            "breakdown",
            "words",
        ]


def profile_summary(profile: Profile) -> dict:
    return {
        "xp": profile.xp,
        "level": profile.level,
        "current_streak": profile.current_streak,
        "best_streak": profile.best_streak,
    }


def result_body(result: service.Result, profile: Profile, *, include_words: bool = True) -> dict:
    """The POST /attempts/ response for a saved attempt (201, or 200 on an idempotent replay)."""
    attempt = result.attempt
    data = AttemptSerializer(attempt).data
    body = {
        **data,
        "speed_score": attempt.speed_score,
        "personal_best": result.personal_best,
        "level_up": result.level_up,
        "mastered_now": result.mastered_now,
        "achievements_unlocked": [],
        "low_confidence": False,
        "warning": result.warning,
        "profile": profile_summary(profile),
    }
    if include_words:
        words = attempt.words.all().prefetch_related("phonemes")
        body["words"] = WordSerializer(words, many=True).data
        body["focus_gated"] = any(w.reason == WordReason.FOCUS_SWAP for w in words)
    return body


def low_confidence_body(reason: str) -> dict:
    return {
        "id": None,
        "score": None,
        "low_confidence": True,
        "reason": reason,
        "personal_best": False,
        "level_up": False,
        "mastered_now": False,
        "xp_awarded": 0,
        "words": [],
    }


class FeedbackSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttemptFeedback
        fields = ["judged_correct", "comment", "donated_audio"]
