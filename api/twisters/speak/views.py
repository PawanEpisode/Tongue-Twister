import datetime as dt
import json

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action, api_view, authentication_classes, permission_classes
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response

from .. import errors
from ..media import consent
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
    Verification,
)
from ..practice import flags
from ..security import require_worker_signature
from ..throttles import (
    AttemptSyncThrottle,
    AttemptThrottle,
    ShareCreateThrottle,
    WordFeedbackThrottle,
)
from . import queries, service, stats
from .serializers import (
    ACCURATE_MODE_FLAG,
    AttemptDetailSerializer,
    AttemptSerializer,
    AttemptSubmitSerializer,
    FeedbackSerializer,
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


@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def scoring_job_result(request, job_id):
    """Worker callback (HMAC-signed, idempotent): applies a spot-check verdict to the attempt."""
    require_worker_signature(request)
    try:
        body = json.loads(request.body or b"{}")
    except ValueError as exc:
        raise ValidationError({"body": "Invalid JSON."}) from exc
    outcome = body.get("status")
    score = body.get("score")
    if outcome not in ("done", "failed") or (
        outcome == "done" and not (isinstance(score, int | float) and 0 <= score <= 100)
    ):
        raise ValidationError({"status": "Send status 'done' with a 0-100 score, or 'failed'."})

    with transaction.atomic():
        job = (
            ScoringJob.objects.select_for_update()
            .select_related("attempt")
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
        profile = _locked(Profile(pk=job.attempt.profile_id))
        apply_job_result(job, profile, done=outcome == "done", score=score, body=body)
    return Response({"status": job.status})


def apply_job_result(job: ScoringJob, profile: Profile, *, done: bool, score, body: dict) -> None:
    now = timezone.now()
    attempt = job.attempt
    job.tries += 1
    job.finished_at = now
    job.latency_ms = body.get("latency_ms") if isinstance(body.get("latency_ms"), int) else None
    if not done:
        job.status = ScoringJob.Status.FAILED
        job.error_code = str(body.get("error_code", "worker_error"))[:40]
        job.save()
        return  # attempt stays pending; the sweeper retries once, then lets the device result stand
    job.status = ScoringJob.Status.DONE
    job.save()
    delta = abs(float(score) - attempt.score)
    attempt.spot_checked = True
    attempt.spot_check_delta = round(delta, 2)
    if delta > settings.SPOT_CHECK_MAX_DELTA:
        attempt.flagged = True
        attempt.verification_status = Verification.FAILED
    else:
        attempt.verification_status = Verification.VERIFIED
        attempt.verified_at = now
    attempt.save(
        update_fields=[
            "spot_checked",
            "spot_check_delta",
            "flagged",
            "verification_status",
            "verified_at",
        ]
    )
    stats.rebuild_profile_stats(
        profile
    )  # trust changed: mastery, bests and weak-word tallies follow
