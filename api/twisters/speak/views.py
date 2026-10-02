import datetime as dt
import json

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from .. import errors
from ..media import consent, uploads
from ..media.views import create_score_card_link
from ..models import (
    SCORE_VERSION_CURRENT,
    AcousticModelVersion,
    Attempt,
    AttemptFeedback,
    AttemptKind,
    AttemptWord,
    ConsentType,
    Profile,
    ScoringJob,
    ScoringProfile,
    Twister,
    UserPhonemeStat,
)
from ..practice import flags
from ..security import require_worker_signature
from ..throttles import (
    AttemptSyncThrottle,
    AttemptThrottle,
    ShareCreateThrottle,
    SpotCheckAudioThrottle,
    WordFeedbackThrottle,
)
from . import jobs, queries, record_jobs, service, stats
from .normalise import tokenise
from .serializers import (
    ACCURATE_MODE_FLAG,
    AttemptDetailSerializer,
    AttemptSerializer,
    AttemptSubmitSerializer,
    DeviceWordSerializer,
    FeedbackSerializer,
    SpotCheckAudioSerializer,
    low_confidence_body,
    profile_summary,
    result_body,
)

MAX_SYNC_ITEMS = 50
DEFAULT_LIMIT, MAX_LIMIT = 10, 50
MAX_OFFSET = 10_000


def _locked(profile: Profile) -> Profile:
    """Serialise this user's writes (streak, XP, stats) — same order everywhere to avoid deadlocks."""
    return Profile.objects.select_for_update().get(pk=profile.pk)


def _offset(request) -> int:
    raw = request.query_params.get("offset", "0")
    if not raw.isdigit() or int(raw) > MAX_OFFSET:
        raise ValidationError({"offset": f"Use a whole number from 0 to {MAX_OFFSET}."})
    return int(raw)


def _limit(request) -> int:
    raw = request.query_params.get("limit", str(DEFAULT_LIMIT))
    if not raw.isdigit() or not 1 <= int(raw) <= MAX_LIMIT:
        raise ValidationError({"limit": f"Use a whole number from 1 to {MAX_LIMIT}."})
    return int(raw)


class AttemptViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AttemptSerializer
    filter_backends = []
    lookup_value_regex = r"\d+"

    def get_serializer_class(self):
        return AttemptDetailSerializer if self.action == "retrieve" else AttemptSerializer

    def get_throttles(self):
        if self.action == "create":
            return [AttemptThrottle()]
        if self.action == "sync":
            return [AttemptSyncThrottle()]
        if self.action == "word_feedback":
            return [WordFeedbackThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        qs = Attempt.objects.filter(profile=self.request.user).select_related(
            "twister", "model_version"
        )
        if self.action == "retrieve":
            qs = qs.prefetch_related("words__phonemes")
        params = self.request.query_params
        if slug := params.get("twister"):
            qs = qs.filter(twister__slug=slug)
        if kind := params.get("kind"):
            if kind not in AttemptKind.values:
                raise ValidationError({"kind": f"Use one of {', '.join(AttemptKind.values)}."})
            qs = qs.filter(kind=kind)
        return qs

    # -- POST /attempts/ ---------------------------------------------------------------------------

    def create(self, request, *args, **kwargs):
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        if isinstance(data, dict) and not data.get("client_attempt_id"):
            key = request.headers.get("Idempotency-Key")
            if key:
                data["client_attempt_id"] = key
        ser = AttemptSubmitSerializer(data=data, context={"profile": request.user})
        ser.is_valid(raise_exception=True)
        include_words = request.query_params.get("include") == "words"

        with transaction.atomic():
            profile = _locked(request.user)
            result = service.submit(profile, ser.to_submission(profile))

        if result.unscorable:
            return Response(low_confidence_body(result.unscorable), status=status.HTTP_200_OK)
        ser.log_drift(result.attempt)
        words = include_words or result.attempt.kind in service.PERSISTED_WORDS
        return Response(
            result_body(result, profile, include_words=words),
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
            headers={} if result.created else {"Idempotent-Replay": "true"},
        )

    # -- POST /attempts/sync/ ----------------------------------------------------------------------

    @action(detail=False, methods=["post"])
    def sync(self, request):
        """Upload offline-queued attempts (≤ 50). Every item succeeds or fails on its own."""
        items = request.data.get("attempts") if isinstance(request.data, dict) else None
        if not isinstance(items, list) or not items:
            raise ValidationError({"attempts": "Send a non-empty list."})
        if len(items) > MAX_SYNC_ITEMS:
            raise ValidationError({"attempts": f"At most {MAX_SYNC_ITEMS} attempts per request."})

        parsed = []
        results: list[dict | None] = [None] * len(items)
        for position, raw in enumerate(items):
            ser = AttemptSubmitSerializer(
                data=raw if isinstance(raw, dict) else {}, context={"profile": request.user}
            )
            if ser.is_valid() and self._occurred_ok(ser):
                parsed.append((position, ser))
            else:
                results[position] = {
                    "client_attempt_id": raw.get("client_attempt_id")
                    if isinstance(raw, dict)
                    else None,
                    "status": "rejected",
                    "reason": "invalid",
                    "fields": sorted(ser.errors) if ser.errors else ["occurred_at"],
                }

        # Oldest first: personal bests, streak days and mastery must replay in the order they happened.
        parsed.sort(key=lambda p: p[1].validated_data.get("occurred_at") or timezone.now())
        with transaction.atomic():
            profile = _locked(request.user)
            for position, ser in parsed:
                results[position] = self._sync_one(profile, ser)

        counts = {
            k: sum(1 for r in results if r["status"] == k)
            for k in ("created", "duplicate", "rejected")
        }
        return Response({"results": results, "counts": counts, "profile": profile_summary(profile)})

    @staticmethod
    def _occurred_ok(ser) -> bool:
        when = ser.validated_data.get("occurred_at")
        if when is None:
            return True
        now = timezone.now()
        return (
            now - dt.timedelta(days=settings.ATTEMPT_MAX_BACKDATE_DAYS)
            <= when
            <= now + dt.timedelta(minutes=5)
        )

    @staticmethod
    def _sync_one(profile: Profile, ser: AttemptSubmitSerializer) -> dict:
        client_id = ser.validated_data.get("client_attempt_id")
        try:
            with transaction.atomic():  # a failing item must not poison the rest of the batch
                result = service.submit(profile, ser.to_submission(profile))
        except errors.ApiProblem as problem:
            return {"client_attempt_id": client_id, "status": "rejected", "reason": problem.code}
        if result.unscorable:
            return {
                "client_attempt_id": client_id,
                "status": "rejected",
                "reason": result.unscorable,
            }
        attempt = result.attempt
        return {
            "client_attempt_id": client_id,
            "status": "created" if result.created else "duplicate",
            "id": attempt.pk,
            "score": attempt.score,
            "xp_awarded": attempt.xp_awarded,
            "flagged": attempt.flagged,
        }

    # -- DELETE /attempts/{id}/ --------------------------------------------------------------------

    def destroy(self, request, *args, **kwargs):
        attempt = self.get_object()
        with transaction.atomic():
            profile = _locked(request.user)
            service.delete_attempt(profile, attempt)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # -- POST /attempts/{id}/score-card/ -----------------------------------------------------------

    @action(
        detail=True,
        methods=["post"],
        url_path="score-card",
        url_name="score-card",
        throttle_classes=[ShareCreateThrottle],
    )
    def score_card(self, request, pk=None):
        """A public, media-free share link for this attempt's result (spec 13 §1)."""
        return create_score_card_link(request, self.get_object())

    # -- POST /attempts/{id}/spot-check-audio/ -------------------------------------------------------

    @action(
        detail=True,
        methods=["post"],
        url_path="spot-check-audio",
        url_name="spot-check-audio",
        throttle_classes=[SpotCheckAudioThrottle],
    )
    def spot_check_audio(self, request, pk=None):
        """Attach the clip the server asked for; this is what queues the worker re-score (D34)."""
        attempt = self.get_object()
        ser = SpotCheckAudioSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        uploads.require_spot_check_upload(request.user)
        with transaction.atomic():
            profile = _locked(request.user)
            attempt = (
                Attempt.objects.select_for_update(of=("self",))
                .select_related("model_version")
                .get(pk=attempt.pk)
            )
            existing = attempt.scoring_jobs.filter(status__in=ScoringJob.ACTIVE).first()
            if existing is not None:
                return Response(
                    _job_summary(existing, attempt), headers={"Idempotent-Replay": "true"}
                )
            if attempt.spot_check_requested_at is None:
                raise errors.ApiProblem(
                    409, "no_request", "Nothing is waiting for audio on this attempt."
                )
            if not jobs.request_open(attempt):
                raise errors.ApiProblem(
                    409, "expired", "The time to send audio for this attempt has passed."
                )
            asset = uploads.owned_audio_asset(profile, ser.validated_data["voice_asset_id"])
            if asset is None:
                raise ValidationError({"voice_asset_id": "Unknown or unfinished voice clip."})
            _check_clip_matches(attempt, asset)
            model = attempt.model_version
            if model is None or not model.active:
                raise errors.ApiProblem(
                    409, "model_retired", "That scoring model is no longer in use."
                )
            job, _ = jobs.enqueue(attempt, asset, model)
        return Response(_job_summary(job, attempt), status=status.HTTP_202_ACCEPTED)

    # -- POST /attempts/{id}/words/{i}/feedback/ ---------------------------------------------------

    @action(
        detail=True,
        methods=["post"],
        url_path=r"words/(?P<index>\d+)/feedback",
        url_name="word-feedback",
    )
    def word_feedback(self, request, pk=None, index=None):
        attempt = self.get_object()
        word = AttemptWord.objects.filter(attempt=attempt, target_index=int(index)).first()
        if word is None:
            raise NotFound("No such word on this attempt.")
        ser = FeedbackSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        if ser.validated_data.get("donated_audio"):
            consent.require_not_minor(request.user)  # decision D6
            consent.require(request.user, ConsentType.MODEL_IMPROVEMENT)
        feedback, created = AttemptFeedback.objects.update_or_create(
            attempt_word=word, profile=request.user, defaults=ser.validated_data
        )
        return Response(
            FeedbackSerializer(feedback).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


# --- learner insights --------------------------------------------------------------------------------


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def weak_words(request):
    """The 'practise weak words' queue: weakest first, paged with `limit`/`offset`; `count` is the
    whole queue. `?due=1` keeps only words whose review is due."""
    due = request.query_params.get("due") in ("1", "true")
    return Response(
        {
            "count": queries.weak_word_count(request.user, due=due),
            "results": queries.weak_word_rows(
                request.user, limit=_limit(request), offset=_offset(request), due=due
            ),
        }
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def nailed_words(request):
    """Words passed in a drill (and not slipped on since), most recent first, paged like the queue."""
    return Response(
        {
            "count": queries.nailed_word_count(request.user),
            "results": queries.nailed_word_rows(
                request.user, limit=_limit(request), offset=_offset(request)
            ),
        }
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def weak_sounds(request):
    rows = UserPhonemeStat.objects.filter(profile=request.user, errors__gt=0).order_by(
        "-error_rate", "-errors", "phoneme_pair"
    )[: _limit(request)]
    out = []
    for r in rows:
        target, heard = r.phoneme_pair.split(">", 1)
        out.append(
            {
                "pair": r.phoneme_pair,
                "target": target,
                "heard": None if heard == stats.DELETED else heard,
                "occurrences": r.occurrences,
                "errors": r.errors,
                "error_rate": round(r.error_rate, 3),
            }
        )
    return Response({"results": out})


# --- engine manifest & worker callback ----------------------------------------------------------------


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def engine_manifest(request):
    """What a client needs to run the on-device engine. Empty until a model is published, which
    tells the client to stay on basic (text-layer) scoring."""
    user = request.user if isinstance(request.user, Profile) else None
    model = (
        AcousticModelVersion.objects.filter(active=True).first()
        if flags.enabled(ACCURATE_MODE_FLAG, user)
        else None
    )
    profile = (
        ScoringProfile.objects.filter(active=True, model_version=model).first() if model else None
    )
    lexicon = (
        Twister.objects.public()
        .order_by("-phoneme_version")
        .values_list("phoneme_version", flat=True)
        .first()
        or 0
    )
    return Response(
        {
            "model": None
            if model is None
            else {
                "name": model.name,
                "base_model": model.base_model,
                "licence": model.licence,
                "quantization": model.quantization,
                "size_bytes": model.size_bytes,
                "sha256": model.sha256,
                "url": model.download_url,
                "label_map_version": model.label_map_version,
            },
            "scoring_profile": None
            if profile is None
            else {
                "code": profile.code,
                "thresholds": profile.thresholds,
                "accent_packs": profile.accent_packs,
                "confusion_map": profile.confusion_map,
            },
            "lexicon_version": lexicon,
            "score_version": SCORE_VERSION_CURRENT,
        },
        headers={"Cache-Control": "public, max-age=300, stale-while-revalidate=600"},
    )


def _signed_body(request) -> dict:
    """Verify the worker signature and parse the raw body (empty = `{}`)."""
    require_worker_signature(request)
    try:
        body = json.loads(request.body or b"{}")
    except ValueError as exc:
        raise ValidationError({"body": "Invalid JSON."}) from exc
    if not isinstance(body, dict):
        raise ValidationError({"body": "Send a JSON object."})
    return body


def _job_summary(job: ScoringJob, attempt: Attempt) -> dict:
    return {
        "job": {"id": job.pk, "status": job.status},
        "attempt": {"id": attempt.pk, "verification_status": attempt.verification_status},
    }


def _check_clip_matches(attempt: Attempt, asset) -> None:
    """The clip must be the one that was scored: same bytes (sha-256) and about the same length (D38)."""
    if not attempt.audio_sha256:
        raise ValidationError(
            {"voice_asset_id": "This attempt has no audio hash to verify against."}
        )
    if (asset.checksum_sha256 or "").lower() != attempt.audio_sha256.lower():
        raise ValidationError({"voice_asset_id": "The clip does not match the scored audio."})
    if asset.duration_ms is None:
        raise ValidationError({"voice_asset_id": "The clip has no duration."})
    tolerance = settings.SPOT_CHECK_DURATION_TOLERANCE
    if abs(asset.duration_ms - attempt.duration_ms) > tolerance * max(attempt.duration_ms, 1000):
        raise ValidationError({"voice_asset_id": "The clip length does not match the attempt."})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
@throttle_classes([])
def scoring_job_claim(request):
    """Scoring worker: take the next job (lease + signed audio URL), or `{"job": null}` when idle."""
    body = _signed_body(request)
    worker_id = body.get("worker_id", "")
    return Response({"job": jobs.claim_payload(worker_id if isinstance(worker_id, str) else "")})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
@throttle_classes([])
def scoring_job_heartbeat(request, job_id):
    """Scoring worker: extend the lease (409 `lease_lost` once the job is no longer running)."""
    _signed_body(request)
    job = jobs.heartbeat(job_id)
    return Response(
        {
            "job_id": job.pk,
            "lease_s": settings.SCORING_JOB_LEASE_S,
            "locked_until": job.locked_until,
        }
    )


def _validated_result(body: dict, job: ScoringJob) -> dict:
    """Field-by-field validation of a worker result; anything odd is a 400 and changes nothing."""
    outcome = body.get("status")
    if outcome not in ("done", "failed"):
        raise ValidationError({"status": "Send status 'done' or 'failed'."})
    latency = body.get("latency_ms")
    if latency is not None and (
        not isinstance(latency, int) or isinstance(latency, bool) or not 0 <= latency <= 3_600_000
    ):
        raise ValidationError({"latency_ms": "Whole milliseconds."})
    out: dict = {"outcome": outcome, "latency_ms": latency}
    if outcome == "failed":
        code = body.get("error_code", "worker_error")
        if not isinstance(code, str) or not 0 < len(code) <= 40:
            raise ValidationError({"error_code": "A short code."})
        retryable = body.get("retryable", True)
        if not isinstance(retryable, bool):
            raise ValidationError({"retryable": "true or false."})
        return out | {"error_code": code, "retryable": retryable}
    score, unscorable = body.get("score"), body.get("unscorable")
    if unscorable is not None:
        if unscorable not in jobs.INCONCLUSIVE:
            raise ValidationError({"unscorable": "Unknown reason."})
        score = None
    elif not (
        isinstance(score, int | float)
        and not isinstance(score, bool)
        and score == score
        and 0 <= score <= 100
    ):
        raise ValidationError({"status": "Send a 0-100 score, or an unscorable reason."})
    if job.kind == ScoringJob.Kind.RECORD:
        return out | _validated_record_fields(body, job, score, unscorable)
    try:
        words = jobs.validate_words(body.get("words"), len(tokenise(job.attempt.twister.text)))
    except ValueError as exc:
        raise ValidationError({"words": str(exc)}) from exc
    sha = body.get("model_sha256")
    if sha is not None and sha != job.model_version.sha256:
        score, unscorable = None, "model_mismatch"  # a different model is not comparable
    version = body.get("engine_version", "")
    if not isinstance(version, str) or len(version) > 40:
        raise ValidationError({"engine_version": "At most 40 characters."})
    return out | {
        "score": score,
        "unscorable": unscorable,
        "words": words,
        "summary": {
            "engine_version": version,
            "model_sha256": sha if isinstance(sha, str) else None,
            "quality": body.get("quality") if isinstance(body.get("quality"), dict) else {},
        },
    }


def _validated_record_fields(body: dict, job: ScoringJob, score, unscorable) -> dict:
    """A record job reports full device-style words (the API computes the score from them), the clip length
    it actually scored, and the same summary a spot-check does."""
    sha = body.get("model_sha256")
    if sha is not None and sha != job.model_version.sha256:
        unscorable = "model_mismatch"  # a different model is not comparable
    version = body.get("engine_version", "")
    if not isinstance(version, str) or len(version) > 40:
        raise ValidationError({"engine_version": "At most 40 characters."})
    words, duration = [], None
    if not unscorable:
        ser = DeviceWordSerializer(data=body.get("words"), many=True)
        if not ser.is_valid():
            raise ValidationError({"words": ser.errors})
        if len(ser.validated_data) > 600:
            raise ValidationError({"words": "At most 600 words."})
        words = [AttemptSubmitSerializer._device_word(w) for w in ser.validated_data]
        duration = body.get("duration_ms")
        if (
            not isinstance(duration, int)
            or isinstance(duration, bool)
            or not 300 <= duration <= settings.SCORING_MAX_AUDIO_S * 1000
        ):
            raise ValidationError({"duration_ms": "Whole milliseconds of scored audio."})
    return {
        "score": score,
        "unscorable": unscorable,
        "device_words": words,
        "duration_ms": duration,
        "summary": {
            "engine_version": version,
            "model_sha256": sha if isinstance(sha, str) else None,
            "quality": body.get("quality") if isinstance(body.get("quality"), dict) else {},
        },
    }


@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
@throttle_classes([])
def scoring_job_result(request, job_id):
    """Worker callback (HMAC-signed, idempotent): settles a spot-check (docs/features/13 §3.4)."""
    body = _signed_body(request)
    purge = None
    with transaction.atomic():
        job = (
            ScoringJob.objects.select_for_update(of=("self",))
            .select_related(
                "attempt__twister", "recording__twister", "model_version", "audio_asset"
            )
            .filter(pk=job_id)
            .first()
        )
        if job is None:
            raise NotFound()
        if job.status in (
            ScoringJob.Status.DONE,
            ScoringJob.Status.FAILED,
            ScoringJob.Status.EXPIRED,
        ):
            return Response({"status": job.status}, headers={"Idempotent-Replay": "true"})
        result = _validated_result(body, job)
        # A late result from a worker whose lease lapsed is still good work: accept while queued or running.
        if result["outcome"] == "failed":
            settled = jobs.fail(job, result["error_code"], retryable=result["retryable"])
        elif job.kind == ScoringJob.Kind.RECORD:
            profile = _locked(Profile(pk=job.recording.profile_id))
            record_jobs.settle_done(
                job,
                profile,
                unscorable=result["unscorable"],
                words=result["device_words"],
                duration_ms=result["duration_ms"],
                summary=result["summary"],
                latency_ms=result["latency_ms"],
            )
            settled = jobs.Settled(job, True)
        else:
            profile = _locked(Profile(pk=job.attempt.profile_id))
            settled = jobs.settle_done(
                job,
                profile,
                score=result["score"],
                unscorable=result["unscorable"],
                words=result["words"],
                summary=result["summary"],
                latency_ms=result["latency_ms"],
            )
        purge = settled.purge
        status_now = job.status
    jobs.purge_audio(purge)
    return Response({"status": status_now})
