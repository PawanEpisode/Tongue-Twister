"""The scoring-worker queue: request audio, enqueue, claim with a lease, heartbeat, settle and sweep.

Spec: docs/features/13 §3.3-3.4 (decisions D34-D36). The concurrency model is the media queue's
(`media/jobs.py`): a claim is one conditional UPDATE (`queued -> running`), so two workers can never both
win a job on any database; on PostgreSQL the candidate row is also locked with `FOR UPDATE SKIP LOCKED`.

A job exists only when the client supplied the audio (D34), so a job always has `audio_asset`.
Nothing here trusts the worker with identity: the claim payload carries the attempt's public id, the
signed audio URL and what is needed to score, never a user id, e-mail or transcript.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass

from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework.exceptions import NotFound

from .. import errors
from ..media import consent, uploads
from ..models import (
    AcousticModelVersion,
    Attempt,
    ConsentType,
    MediaAsset,
    MediaStatus,
    Profile,
    ScoringJob,
    ScoringProfile,
    Verification,
    WordReason,
    WordStatus,
)
from . import pronunciations, record_jobs, stats
from .engine.variants import AccentRule, expand_variants
from .normalise import tokenise

log = logging.getLogger(__name__)

CLAIM_ATTEMPTS = 5  # lost races before a claim gives up for this poll
DONE, FAILED, EXPIRED = ScoringJob.Status.DONE, ScoringJob.Status.FAILED, ScoringJob.Status.EXPIRED
QUEUED, RUNNING = ScoringJob.Status.QUEUED, ScoringJob.Status.RUNNING

# Worker-reported reasons a clip could not be judged. They are inconclusive, never a flag (D35).
INCONCLUSIVE = {
    "no_speech",
    "nothing_recognised",
    "could_not_follow",
    "audio_mismatch",
    "audio_too_long",
    "audio_unreadable",
    "low_quality",
    "model_mismatch",
}
WORD_STATUSES = {s.value for s in WordStatus}
WORD_REASONS = {r.value for r in WordReason} | {""}


def lease() -> dt.timedelta:
    return dt.timedelta(seconds=settings.SCORING_JOB_LEASE_S)


# --- audio request (D34) -----------------------------------------------------------------------------


def audio_window() -> dt.timedelta:
    return dt.timedelta(minutes=settings.SPOT_CHECK_AUDIO_WINDOW_MIN)


def request_open(attempt: Attempt, now: dt.datetime | None = None) -> bool:
    """The server asked for audio for this attempt and the window has not closed."""
    asked = attempt.spot_check_requested_at
    return (
        asked is not None
        and attempt.verification_status == Verification.DEVICE
        and (now or timezone.now()) <= asked + audio_window()
    )


# --- enqueue ------------------------------------------------------------------------------------


def enqueue(
    attempt: Attempt, asset: MediaAsset, model: AcousticModelVersion
) -> tuple[ScoringJob, bool]:
    """Queue the spot-check for an attempt whose audio is attached; idempotent (partial unique index)."""
    try:
        with transaction.atomic():
            job = ScoringJob.objects.create(
                attempt=attempt,
                audio_asset=asset,
                kind=ScoringJob.Kind.SPOT_CHECK,
                model_version=model,
                max_tries=settings.SCORING_JOB_MAX_TRIES,
            )
            Attempt.objects.filter(pk=attempt.pk).update(verification_status=Verification.PENDING)
            attempt.verification_status = Verification.PENDING
            return job, True
    except IntegrityError:
        return ScoringJob.objects.get(
            attempt=attempt, kind=ScoringJob.Kind.SPOT_CHECK, status__in=ScoringJob.ACTIVE
        ), False


# --- claim / heartbeat --------------------------------------------------------------------------


def _candidates():
    """Queued work a worker may take now: audio still there, model still active, tries left."""
    return (
        ScoringJob.objects.filter(
            status=QUEUED,
            tries__lt=F("max_tries"),
            audio_asset__status=MediaStatus.READY,
            model_version__active=True,
        )
        .select_related("attempt", "recording", "audio_asset", "model_version")
        .order_by("created_at")
    )


def claim(worker_id: str = "", now: dt.datetime | None = None) -> ScoringJob | None:
    """Hand the oldest runnable job to a worker under a fresh lease, or None when the queue is idle."""
    now = now or timezone.now()
    sweep_leases(now)
    for _ in range(CLAIM_ATTEMPTS):
        with transaction.atomic():
            rows = _candidates()
            if connection.features.has_select_for_update_skip_locked:
                rows = rows.select_for_update(skip_locked=True, of=("self",))
            job = rows.first()
            if job is None:
                return None
            won = ScoringJob.objects.filter(pk=job.pk, status=QUEUED).update(
                status=RUNNING,
                tries=F("tries") + 1,
                locked_until=now + lease(),
                started_at=now,
                worker_id=worker_id[:80],
                error_code="",
            )
        if won:
            job.refresh_from_db()
            return job
    return None


def release_claim(job: ScoringJob) -> None:
    """Undo a claim that could not be served (storage was down while signing): the try does not count."""
    ScoringJob.objects.filter(pk=job.pk, status=RUNNING).update(
        status=QUEUED, tries=F("tries") - 1, locked_until=None
    )


def heartbeat(job_id, now: dt.datetime | None = None) -> ScoringJob:
    """Extend a running job's lease. 404 for an unknown id, 409 `lease_lost` once it is no longer running."""
    now = now or timezone.now()
    extended = ScoringJob.objects.filter(pk=job_id, status=RUNNING).update(
        locked_until=now + lease()
    )
    job = ScoringJob.objects.filter(pk=job_id).first()
    if job is None:
        raise NotFound()
    if not extended:
        raise errors.ApiProblem(409, "lease_lost", "This job is no longer running.")
    return job


def consent_ok(job: ScoringJob) -> bool:
    """`voice_processing` is still granted (D41): withdrawing it stops a queued check."""
    return consent.active_current(job.owner, ConsentType.VOICE_PROCESSING) is not None


# --- the claim payload ----------------------------------------------------------------------------


def label_map_url(model: AcousticModelVersion) -> str:
    """`label_map.json` is published next to the model file (tools/export_model)."""
    return model.download_url.rsplit("/", 1)[0] + "/label_map.json" if model.download_url else ""


def accent_rules(profile: ScoringProfile | None, lang: str) -> list[AccentRule]:
    packs = (profile.accent_packs if profile else None) or {}
    rules = []
    for raw in packs.get(lang, []) if isinstance(packs, dict) else []:
        if isinstance(raw, dict) and raw.get("src") and raw.get("dst"):
            rules.append(
                AccentRule(
                    str(raw["src"]), str(raw["dst"]), tuple(map(str, raw.get("protects", ())))
                )
            )
    return rules


def words_for(twister, lang: str, profile: ScoringProfile | None) -> list[dict]:
    """The twister's words with every accepted pronunciation, accent rules applied (server side, so neither the
    worker nor the browser needs the lexicon). Raises ValueError if a word has no pronunciation."""
    overrides = pronunciations.override_index(twister.pk)
    resolved, missing = pronunciations.resolve(twister.text, overrides)
    if missing:
        raise ValueError(f"no pronunciation for: {', '.join(missing)}")
    focus = {str(f).lower() for f in (twister.focus_sounds or [])}
    rules = accent_rules(profile, lang)
    words = []
    for token in tokenise(twister.text):
        variants = [v.split() for v in resolved[token]]
        words.append({"text": token, "variants": expand_variants(variants, rules, focus)})
    return words


def expected_words(attempt: Attempt, profile: ScoringProfile | None) -> list[dict]:
    return words_for(attempt.twister, attempt.lang, profile)


def build_payload(job: ScoringJob) -> dict:
    """What the worker needs, and nothing identifying. Storage failure raises a 503 (caller releases)."""
    asset, model = job.audio_asset, job.model_version
    if job.kind == ScoringJob.Kind.RECORD:
        profile = ScoringProfile.objects.filter(active=True, model_version=model).first()
        subject = record_jobs.build_payload(
            job, words_for(job.recording.twister, record_jobs.lang_for(job.owner), profile), profile
        )
    else:
        attempt = job.attempt
        profile = (
            attempt.scoring_profile
            or ScoringProfile.objects.filter(active=True, model_version=model).first()
        )
        focus = sorted({str(f).upper() for f in (attempt.twister.focus_sounds or [])})
        subject = {
            "attempt": {
                "id": str(attempt.public_id),
                "duration_ms": attempt.duration_ms,
                "device_score": attempt.score,
                "audio_sha256": attempt.audio_sha256,
                "lang": attempt.lang,
                "difficulty": attempt.twister.difficulty,
            },
            "twister": {"focus": focus, "words": expected_words(attempt, profile)},
            "device_words": [
                {"i": w.target_index, "status": w.status, "reason": w.reason}
                for w in attempt.words.filter(target_index__isnull=False).order_by("target_index")
            ],
        }
    return {
        "id": str(job.pk),
        "kind": job.kind,
        "lease_s": settings.SCORING_JOB_LEASE_S,
        "max_audio_s": settings.SCORING_MAX_AUDIO_S,
        "attempt": subject["attempt"],
        "audio": {
            "url": uploads.mint_download(
                asset.bucket, asset.path, settings.SCORING_AUDIO_URL_TTL_S
            ),
            "size_bytes": asset.size_bytes,
            "mime": asset.mime_type,
            "sha256": asset.checksum_sha256 or None,
        },
        "model": {
            "name": model.name,
            "sha256": model.sha256,
            "url": model.download_url,
            "size_bytes": model.size_bytes,
            "label_map_version": model.label_map_version,
            "label_map_url": label_map_url(model),
        },
        "profile": {
            "code": profile.code if profile else "",
            "thresholds": profile.thresholds if profile else {},
        },
        "twister": subject["twister"],
        "device_words": subject["device_words"],
    }


def claim_payload(worker_id: str = "") -> dict | None:
    """Claim + payload; a job whose payload cannot be built is failed (bad data) or released (storage)."""
    for _ in range(CLAIM_ATTEMPTS):
        job = claim(worker_id)
        if job is None:
            return None
        if not consent_ok(job):
            asset = None
            with transaction.atomic():
                fresh = (
                    ScoringJob.objects.select_for_update(of=("self",))
                    .select_related("audio_asset")
                    .get(pk=job.pk)
                )
                if fresh.status == RUNNING:
                    asset = _finish_without_verdict(fresh, EXPIRED, "consent_withdrawn")
            purge_audio(asset)  # after the commit: a rolled-back settle must not lose the clip
            continue
        try:
            return build_payload(job)
        except errors.ApiProblem:
            release_claim(job)  # storage outage: not the job's fault
            raise
        except ValueError:  # a word lost its pronunciation: the job can never run
            with transaction.atomic():
                fresh = ScoringJob.objects.select_for_update(of=("self",)).get(pk=job.pk)
                if fresh.status == RUNNING:
                    _finish_without_verdict(fresh, FAILED, "twister_unscorable")
    return None


# --- settle ---------------------------------------------------------------------------------------


@dataclass
class Settled:
    job: ScoringJob
    changed: bool
    purge: MediaAsset | None = None  # the spot-check clip to delete after the transaction commits


def _finish_without_verdict(job: ScoringJob, status: str, code: str) -> MediaAsset | None:
    """Terminal state with no judgement: the device result stands, the attempt is not punished."""
    now = timezone.now()
    job.status, job.error_code, job.finished_at, job.locked_until = status, code[:40], now, None
    job.save(update_fields=["status", "error_code", "finished_at", "locked_until"])
    if job.kind == ScoringJob.Kind.RECORD:
        return None  # the analysis audio belongs to the recording and expires with it
    Attempt.objects.filter(pk=job.attempt_id, verification_status=Verification.PENDING).update(
        verification_status=Verification.FAILED
    )
    return job.audio_asset


def fail(job: ScoringJob, code: str, *, retryable: bool = True) -> Settled:
    """The worker could not judge. Retryable and tries left: back in the queue. Otherwise final. Caller holds
    the job row lock and is in a transaction."""
    if retryable and job.tries < job.max_tries:
        job.status, job.error_code, job.locked_until = QUEUED, code[:40], None
        job.save(update_fields=["status", "error_code", "locked_until"])
        return Settled(job, True)
    asset = _finish_without_verdict(job, FAILED, code)
    return Settled(job, True, asset)


def validate_words(raw, targets: int) -> list[dict]:
    """Worker-reported per-word verdicts, validated field by field."""
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > 600:
        raise ValueError("words must be a list of at most 600 items")
    out, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("each word must be an object")
        i, status, reason = item.get("i"), item.get("status"), item.get("reason", "") or ""
        if not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < targets or i in seen:
            raise ValueError("word index out of range or repeated")
        if status not in WORD_STATUSES or reason not in WORD_REASONS:
            raise ValueError("unknown word status or reason")
        seen.add(i)
        out.append({"i": i, "status": status, "reason": reason})
    return out


def false_credits(attempt: Attempt, worker_words: list[dict]) -> list[int]:
    """Focus words the device credited but the worker heard as a swap (the slip the twister trains)."""
    device = {w.target_index: w.status for w in attempt.words.filter(target_index__isnull=False)}
    return [
        w["i"]
        for w in worker_words
        if w["reason"] == WordReason.FOCUS_SWAP
        and device.get(w["i"]) in (WordStatus.CORRECT, WordStatus.NEAR)
    ]


def settle_done(
    job: ScoringJob,
    profile: Profile,
    *,
    score: float | None,
    unscorable: str | None,
    words: list[dict],
    summary: dict,
    latency_ms: int | None,
) -> Settled:
    """Apply a worker verdict (D35). Caller holds the job and profile locks inside a transaction."""
    now = timezone.now()
    attempt = job.attempt
    job.tries = max(job.tries, 1)
    job.finished_at, job.locked_until, job.error_code = now, None, ""
    job.latency_ms = latency_ms
    job.result = {**summary, "unscorable": unscorable, "words": words, "score": score}
    asset = job.audio_asset

    if unscorable or score is None:
        job.status = DONE
        job.error_code = (unscorable or "no_score")[:40]
        job.save()
        Attempt.objects.filter(pk=attempt.pk).update(verification_status=Verification.FAILED)
        return Settled(job, True, asset)

    delta = round(attempt.score - float(score), 2)  # positive = the device was more generous
    credits = false_credits(attempt, words)
    tampered = delta > settings.SPOT_CHECK_MAX_DELTA or bool(credits)
    job.status = DONE
    job.result["delta"] = delta
    job.result["false_credit_words"] = credits
    job.save()
    attempt.spot_checked = True
    attempt.spot_check_delta = delta
    if tampered:
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
    log.info("spot_check.settled flagged=%s delta_bucket=%s", tampered, _bucket(delta))
    return Settled(job, True, asset)


def _bucket(delta: float) -> str:
    return "ge_15" if delta >= 15 else "5_15" if delta >= 5 else "-5_5" if delta > -5 else "lt_-5"


def purge_audio(asset: MediaAsset | None) -> None:
    """D41: the spot-check clip is deleted once the job settles. Storage trouble is retried by the
    asset's own expiry (`expires_at`), never by failing the settle."""
    if asset is None:
        return
    try:
        uploads.purge_asset(asset)
    except Exception:  # noqa: BLE001 - best effort; the expiry sweep owns the retry
        log.warning("spot_check.audio_purge_failed asset=%s", asset.pk)


# --- sweeper --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class SweepResult:
    requeued: int = 0
    failed: int = 0
    expired: int = 0
    requests_closed: int = 0


def sweep_leases(now: dt.datetime | None = None) -> tuple[int, int]:
    """Jobs running past `locked_until` go back to queued, or fail once `tries` reaches `max_tries`.
    Also run at the start of every claim, so a crashed worker's job is picked up within one poll."""
    now = now or timezone.now()
    requeued = failed = 0
    for job_id in list(
        ScoringJob.objects.filter(status=RUNNING, locked_until__lt=now).values_list("pk", flat=True)
    ):
        with transaction.atomic():
            job = (
                ScoringJob.objects.select_for_update(of=("self",))
                .select_related("audio_asset")
                .get(pk=job_id)
            )
            if job.status != RUNNING or job.locked_until >= now:
                continue  # finished or heartbeated while we were looking
            settled = fail(job, "lease_expired")
            if job.status == QUEUED:
                requeued += 1
            else:
                failed += 1
                transaction.on_commit(lambda a=settled.purge: purge_audio(a))
    return requeued, failed


def sweep(now: dt.datetime | None = None) -> SweepResult:
    """Housekeeping (run from `sweep_pending_attempts`). Safe to re-run.

    * lapsed leases (see `sweep_leases`);
    * queued jobs that can never run (audio purged, model retired) -> `expired`, attempt back to `device`
      standing (`failed`, not flagged);
    * requests whose audio window closed with no clip -> request cleared, nothing else changes.
    """
    now = now or timezone.now()
    requeued, failed = sweep_leases(now)
    expired = 0
    stuck = ScoringJob.objects.filter(status=QUEUED).filter(
        Q(audio_asset__isnull=True)
        | ~Q(audio_asset__status=MediaStatus.READY)
        | Q(model_version__active=False)
    )
    for job_id in list(stuck.values_list("pk", flat=True)):
        with transaction.atomic():
            job = (
                ScoringJob.objects.select_for_update(of=("self",))
                .select_related("audio_asset")
                .get(pk=job_id)
            )
            if job.status != QUEUED:
                continue
            code = "model_retired" if not job.model_version.active else "audio_gone"
            asset = _finish_without_verdict(job, EXPIRED, code)
            transaction.on_commit(lambda a=asset: purge_audio(a))
            expired += 1
    for job_id in list(ScoringJob.objects.filter(status=QUEUED).values_list("pk", flat=True)):
        with transaction.atomic():
            job = (
                ScoringJob.objects.select_for_update(of=("self",))
                .select_related("audio_asset", "attempt__profile", "recording__profile")
                .get(pk=job_id)
            )
            if job.status == QUEUED and not consent_ok(job):
                asset = _finish_without_verdict(job, EXPIRED, "consent_withdrawn")
                transaction.on_commit(lambda a=asset: purge_audio(a))
                expired += 1
    closed = Attempt.objects.filter(
        spot_check_requested_at__lt=now - audio_window(),
        verification_status=Verification.DEVICE,
        spot_checked=False,
    ).update(spot_check_requested_at=None)
    if requeued or failed or expired or closed:
        log.info(
            "scoring.jobs_swept requeued=%s failed=%s expired=%s requests_closed=%s",
            requeued,
            failed,
            expired,
            closed,
        )
    return SweepResult(requeued, failed, expired, closed)
