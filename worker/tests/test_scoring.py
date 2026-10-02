"""Spot-check scoring: payload parsing, audio quality, label map, model cache and the whole handler."""

from __future__ import annotations

import hashlib
import json
import math
import shutil
import wave
from pathlib import Path

import httpx
import numpy as np
import pytest

from twister_worker.context import JobContext
from twister_worker.engine import quality
from twister_worker.errors import JobFailed
from twister_worker.models import Limits
from twister_worker.scoring import audio, handler
from twister_worker.scoring.job import ScoringJob
from twister_worker.scoring.labels import LabelMap
from twister_worker.scoring.model import ModelStore, check_url

HAVE_FFMPEG = shutil.which("ffmpeg") is not None
need_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="ffmpeg not installed")

RAW = ["<pad>", "ʃ", "i", "s", "ɛ", "l", "z", "|"]
CLASSES = ["<b>", "SH", "IY", "S", "EH", "L", "Z"]
LABEL_MAP = {
    "version": "lm1",
    "blank": "<pad>",
    "vocab": RAW,
    "classes": CLASSES,
    "map": {"ʃ": "SH", "i": "IY", "s": "S", "ɛ": "EH", "l": "L", "z": "Z"},
    "drop": ["|"],
    "sources": {"vocab_sha256": "x"},
}
MODEL_BYTES = b"fake-onnx-model"
MODEL_SHA = hashlib.sha256(MODEL_BYTES).hexdigest()
SECONDS = 3.0
FRAMES = 150


def make_wav(path: Path, *, seconds=SECONDS, speech=True, level=0.3) -> bytes:
    """Bursts of noisy voiced-ish sound separated by near-silence: passes the quality gate."""
    rng = np.random.default_rng(7)
    n = int(16_000 * seconds)
    sig = rng.normal(0, 1e-4, n)
    if speech:
        t = np.arange(n) / 16_000
        voiced = np.sin(2 * np.pi * 180 * t) + 0.5 * np.sin(2 * np.pi * 360 * t)
        gate = (np.sin(2 * np.pi * 2.5 * t) > -0.2).astype(float)
        sig = sig + level * gate * voiced / 1.5
    pcm = (np.clip(sig, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16_000)
        w.writeframes(pcm.tobytes())
    return path.read_bytes()


def logits_for(phones: list[str], frames=FRAMES) -> np.ndarray:
    """(frames, V) logits that say `phones` in order, 3 frames each with a blank between."""
    out = np.zeros((frames, len(RAW)))
    out[:, 0] = 6.0
    pos = 20
    for phone in phones:
        col = RAW.index({v: k for k, v in LABEL_MAP["map"].items()}[phone])
        for f in range(pos, pos + 3):
            out[f, 0], out[f, col] = 0.0, 9.0
        pos += 5
    return out


class FakeSession:
    def __init__(self, phones: list[str]):
        self.phones = phones

    def get_inputs(self):
        return [type("I", (), {"name": "input_values"})()]

    def run(self, _outputs, feeds):
        samples = feeds["input_values"]
        assert samples.dtype == np.float32 and samples.shape[0] == 1
        return [logits_for(self.phones, frames=samples.shape[1] // 320)[None]]


class Cloud:
    """The three URLs a claim points at."""

    def __init__(self, wav: bytes, model: bytes = MODEL_BYTES, label_map=None):
        self.routes = {
            "/audio": wav,
            "/model.onnx": model,
            "/label_map.json": json.dumps(label_map or LABEL_MAP).encode(),
        }
        self.hits: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.hits.append(request.url.path)
        body = self.routes.get(request.url.path)
        return httpx.Response(200, content=body) if body is not None else httpx.Response(404)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self))


def payload(wav: bytes, **over) -> dict:
    sha = hashlib.sha256(wav).hexdigest()
    base = {
        "id": "11111111-1111-1111-1111-111111111111",
        "kind": "spot_check",
        "lease_s": 60,
        "max_audio_s": 90,
        "attempt": {
            "id": "22222222-2222-2222-2222-222222222222",
            "duration_ms": int(SECONDS * 1000),
            "device_score": 95.0,
            "audio_sha256": sha,
            "lang": "en",
            "difficulty": 2,
        },
        "audio": {
            "url": "https://store.test/audio?sig=1",
            "size_bytes": len(wav),
            "mime": "audio/wav",
            "sha256": sha,
        },
        "model": {
            "name": "w2v-test",
            "sha256": MODEL_SHA,
            "url": "https://models.test/model.onnx",
            "size_bytes": len(MODEL_BYTES),
            "label_map_version": "lm1",
            "label_map_url": "https://models.test/label_map.json",
        },
        "profile": {"code": "sp-test", "thresholds": {"tau_sub": 3.0}},
        "twister": {
            "focus": ["S", "SH"],
            "words": [
                {"text": "she", "variants": [["SH", "IY"]]},
                {"text": "sells", "variants": [["S", "EH", "L", "Z"]]},
            ],
        },
        "device_words": [],
    }
    base.update(over)
    return base


def run_job(settings, tmp_path, wav, phones, **over):
    cloud = over.pop("cloud", None) or Cloud(wav)
    job = ScoringJob.from_payload(payload(wav, **over))
    store = ModelStore(
        tmp_path / "models",
        threads=1,
        allowed_hosts=(),
        api_base_url=settings.api_base_url,
        max_model_bytes=10_000_000,
        session_factory=lambda _path, _threads: FakeSession(phones),
    )
    ctx = JobContext(settings, Limits(max_height=0, max_s=90))
    return handler.handle(job, ctx, cloud.client(), store), cloud, store


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr("twister_worker.retry.time.sleep", lambda _: None)


GOOD = ["SH", "IY", "S", "EH", "L", "Z"]
SWAPPED = ["SH", "IY", "SH", "EH", "L", "Z"]  # "sells" said as "shells"


# --- payload ---------------------------------------------------------------------------------------


def test_a_valid_payload_parses(tmp_path):
    job = ScoringJob.from_payload(payload(make_wav(tmp_path / "a.wav")))
    assert [w.text for w in job.words] == ["she", "sells"] and job.focus == {"S", "SH"}


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.pop("model"),
        lambda p: p["twister"].update(words=[]),
        lambda p: p["twister"]["words"][0].update(variants=[]),
        lambda p: p["audio"].update(url="ftp://x/y"),
        lambda p: p["model"].update(sha256="nothex"),
        lambda p: p.update(id="bad id!"),
        lambda p: p["attempt"].update(duration_ms=True),
        lambda p: p.update(lease_s=0),
    ],
)
def test_malformed_payloads_are_permanent_job_invalid(tmp_path, mutate):
    data = payload(make_wav(tmp_path / "a.wav"))
    mutate(data)
    with pytest.raises(JobFailed) as exc:
        ScoringJob.from_payload(data)
    assert exc.value.code == "job_invalid" and not exc.value.retryable


# --- audio quality -----------------------------------------------------------------------------------


def test_engine_gates_map_to_inconclusive_codes_and_carry_their_measurements():
    t = np.arange(48_000) / 16_000
    speech = (0.3 * np.sin(2 * np.pi * 200 * t) * (np.sin(2 * np.pi * 2.5 * t) > -0.2)).astype(
        np.float32
    )
    assert quality.signal_gate(speech.tolist(), 16_000).ok
    silent = quality.signal_gate([0.0] * 16_000, 16_000)
    assert audio.unscorable_for(silent) == "low_quality" and silent.gate == quality.TOO_QUIET
    assert audio.unscorable_for(quality.signal_gate([], 16_000)) == "no_speech"
    details = audio.gate_details(silent, 1000)
    assert details["gate"] == "too_quiet" and details["ok"] is False and "loud_dbfs" in details


def test_normalise_gives_zero_mean_unit_variance():
    out = audio.normalise(np.random.default_rng(0).normal(3, 5, 4000).astype(np.float32))
    assert abs(float(out.mean())) < 1e-3 and abs(float(out.std()) - 1) < 1e-3


# --- label map ---------------------------------------------------------------------------------------


def test_collapse_sums_labels_that_share_a_class_and_treats_delimiters_as_blank():
    lm = LabelMap.from_json(json.dumps(LABEL_MAP))
    logits = np.full((1, len(RAW)), -20.0)
    logits[0, RAW.index("|")] = 5.0
    out = lm.collapse(logits)
    assert out.shape == (1, len(CLASSES)) and out[0, 0] == pytest.approx(0.0, abs=1e-3)
    assert math.isclose(float(np.exp(out).sum()), 1.0, rel_tol=1e-6)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["map"].pop("ʃ"),
        lambda d: d.update(classes=["SH", "<b>"]),
        lambda d: d.update(vocab=["<pad>", "<pad>"]),
        lambda d: d.pop("version"),
    ],
)
def test_bad_label_maps_are_permanent(mutate):
    data = json.loads(json.dumps(LABEL_MAP))
    mutate(data)
    with pytest.raises(JobFailed) as exc:
        LabelMap.from_json(json.dumps(data))
    assert exc.value.code == "label_map_invalid" and not exc.value.retryable


def test_collapse_rejects_a_model_of_the_wrong_width():
    lm = LabelMap.from_json(json.dumps(LABEL_MAP))
    with pytest.raises(JobFailed) as exc:
        lm.collapse(np.zeros((3, 5)))
    assert exc.value.code == "model_mismatch"


# --- url policy ----------------------------------------------------------------------------------------


def test_url_policy():
    check_url("https://a.supabase.co/x", allowed_hosts=("supabase.co",), api_base_url="https://api")
    with pytest.raises(JobFailed):
        check_url("http://a.supabase.co/x", allowed_hosts=(), api_base_url="https://api")
    with pytest.raises(JobFailed):
        check_url("https://evil.test/x", allowed_hosts=("supabase.co",), api_base_url="https://api")
    with pytest.raises(JobFailed):
        check_url(
            "https://notsupabase.co/x", allowed_hosts=("supabase.co",), api_base_url="https://api"
        )
    check_url("http://localhost:54321/x", allowed_hosts=(), api_base_url="http://localhost:8000")


# --- end to end ------------------------------------------------------------------------------------------


@need_ffmpeg
def test_a_clean_read_scores_high_with_every_word_credited(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav")
    body, _, _ = run_job(settings, tmp_path, wav, GOOD)
    assert body["status"] == "done" and "unscorable" not in body or body.get("unscorable") is None
    assert [w["status"] for w in body["words"]] == ["correct", "correct"]
    assert body["score"] >= 80 and body["model_sha256"] == MODEL_SHA
    assert body["engine_version"].startswith("e-") and body["latency_ms"] >= 0


@need_ffmpeg
def test_a_focus_swap_is_caught_and_capped(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav")
    body, _, _ = run_job(settings, tmp_path, wav, SWAPPED)
    sells = next(w for w in body["words"] if w["i"] == 1)
    assert sells["status"] == "wrong" and sells["reason"] == "focus_swap"
    assert body["score"] <= 79


@need_ffmpeg
def test_silence_is_inconclusive_not_a_fail(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav", speech=False)
    body, _, _ = run_job(settings, tmp_path, wav, GOOD)
    assert (
        body["status"] == "done" and body["unscorable"] == "low_quality" and body["score"] is None
    )
    assert body["quality"]["gate"] == "too_quiet"


@need_ffmpeg
def test_a_clip_that_is_not_the_scored_one_is_a_mismatch(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav")
    other = make_wav(tmp_path / "b.wav", level=0.2)
    cloud = Cloud(other)  # the store serves different bytes than the claim describes
    body, _, _ = run_job(settings, tmp_path, wav, GOOD, cloud=cloud)
    assert body["unscorable"] == "audio_mismatch"


@need_ffmpeg
def test_a_clip_of_the_wrong_length_is_a_mismatch(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav", seconds=6)
    body, _, _ = run_job(settings, tmp_path, wav, GOOD)  # the attempt says 3 s
    assert body["unscorable"] == "audio_mismatch"


@need_ffmpeg
def test_undecodable_bytes_are_reported_as_unreadable(settings, tmp_path):
    junk = b"not audio at all" * 40
    data = payload(junk)
    job = ScoringJob.from_payload(data)
    store = ModelStore(
        tmp_path / "m",
        threads=1,
        allowed_hosts=(),
        api_base_url="https://api.test",
        max_model_bytes=10**7,
        session_factory=lambda *_: FakeSession(GOOD),
    )
    ctx = JobContext(settings, Limits(max_height=0, max_s=90))
    with pytest.raises(JobFailed) as exc:
        handler.handle(job, ctx, Cloud(junk).client(), store)
    assert exc.value.code == "audio_unreadable"


@need_ffmpeg
def test_the_model_is_downloaded_once_and_then_reused(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav")
    _, cloud, store = run_job(settings, tmp_path, wav, GOOD)
    assert cloud.hits.count("/model.onnx") == 1
    job = ScoringJob.from_payload(payload(wav))
    handler.handle(job, JobContext(settings, Limits(max_height=0, max_s=90)), cloud.client(), store)
    assert cloud.hits.count("/model.onnx") == 1  # in memory
    fresh = ModelStore(
        tmp_path / "models",
        threads=1,
        allowed_hosts=(),
        api_base_url=settings.api_base_url,
        max_model_bytes=10**7,
        session_factory=lambda *_: FakeSession(GOOD),
    )
    fresh.get(job.model, JobContext(settings, Limits(max_height=0, max_s=90)), cloud.client())
    assert cloud.hits.count("/model.onnx") == 1  # from disk, hash re-verified


def test_a_model_with_the_wrong_hash_is_never_loaded(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav")
    cloud = Cloud(wav, model=b"x" * len(MODEL_BYTES))
    job = ScoringJob.from_payload(payload(wav))
    loaded = []
    store = ModelStore(
        tmp_path / "m",
        threads=1,
        allowed_hosts=(),
        api_base_url=settings.api_base_url,
        max_model_bytes=10**7,
        session_factory=lambda *a: loaded.append(a),
    )
    with pytest.raises(JobFailed) as exc:
        store.get(job.model, JobContext(settings, Limits(max_height=0, max_s=90)), cloud.client())
    assert exc.value.code == "model_corrupt" and loaded == []
    assert (
        list((tmp_path / "m").glob("*.onnx")) == [] and list((tmp_path / "m").glob("*.part")) == []
    )


def test_a_label_map_of_another_version_is_refused(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav")
    cloud = Cloud(wav, label_map={**LABEL_MAP, "version": "lm2"})
    job = ScoringJob.from_payload(payload(wav))
    store = ModelStore(
        tmp_path / "m",
        threads=1,
        allowed_hosts=(),
        api_base_url=settings.api_base_url,
        max_model_bytes=10**7,
        session_factory=lambda *_: FakeSession(GOOD),
    )
    with pytest.raises(JobFailed) as exc:
        store.get(job.model, JobContext(settings, Limits(max_height=0, max_s=90)), cloud.client())
    assert exc.value.code == "label_map_mismatch"


def test_threshold_overrides_are_applied_and_junk_is_ignored(tmp_path):
    data = payload(make_wav(tmp_path / "a.wav"))
    data["profile"]["thresholds"] = {
        "tau_sub": 5,
        "pad_frames": 9,
        "evil": 1,
        "tau_del": float("nan"),
        "tau_weak": True,
    }
    profile = handler.build_profile(ScoringJob.from_payload(data))
    assert profile.tau_sub == 5.0 and profile.pad_frames == 9 and profile.tau_del == 3.0
    assert profile.tau_weak == -0.9 and profile.name == "sp-test"


# --- record jobs (A5): the whole take, trimmed here, with full verdicts ------------------------------------


def record_payload(wav: bytes, **over) -> dict:
    data = payload(wav, kind="record")
    data["attempt"].update(device_score=None, audio_sha256=None)
    data["audio"].update(sha256=None)
    for key, value in over.items():
        data["attempt"][key] = value
    return data


def run_record(settings, tmp_path, wav, phones, **over):
    cloud = Cloud(wav)
    job = ScoringJob.from_payload(record_payload(wav, **over))
    store = ModelStore(
        tmp_path / "models",
        threads=1,
        allowed_hosts=(),
        api_base_url=settings.api_base_url,
        max_model_bytes=10_000_000,
        session_factory=lambda _path, _threads: FakeSession(phones),
    )
    ctx = JobContext(settings, Limits(max_height=0, max_s=90))
    return handler.handle(job, ctx, cloud.client(), store)


def padded_wav(path: Path, *, lead_s: float, tail_s: float) -> bytes:
    """The speech burst pattern with silence either side, as a countdown and a reach for stop leave it."""
    make_wav(path)
    with wave.open(str(path), "rb") as w:
        core = w.readframes(w.getnframes())

    def quiet(seconds: float) -> bytes:
        noise = np.random.default_rng(3).normal(0, 1e-4, int(16_000 * seconds))
        return (noise * 32767).astype("<i2").tobytes()

    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16_000)
        w.writeframes(quiet(lead_s) + core + quiet(tail_s))
    return path.read_bytes()


def test_a_record_payload_parses_without_any_claimed_hash(tmp_path):
    job = ScoringJob.from_payload(record_payload(make_wav(tmp_path / "a.wav")))
    assert job.kind == "record" and job.attempt_audio_sha256 is None and job.audio.sha256 is None


def test_an_unknown_job_kind_is_permanent(tmp_path):
    data = payload(make_wav(tmp_path / "a.wav"), kind="mine_bitcoin")
    with pytest.raises(JobFailed) as exc:
        ScoringJob.from_payload(data)
    assert exc.value.code == "job_invalid"


@need_ffmpeg
def test_a_record_take_returns_full_verdicts_and_the_scored_length(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav")
    body = run_record(settings, tmp_path, wav, GOOD)
    assert body["status"] == "done" and body["score"] >= 80
    assert [w["status"] for w in body["words"]] == ["correct", "correct"]
    first = body["words"][0]
    assert first["i"] == 0 and first["target"] == "she" and first["end_ms"] > first["start_ms"]
    assert first["phonemes"] and {"t", "verdict", "start_ms", "end_ms"} <= set(first["phonemes"][0])
    assert 300 <= body["duration_ms"] <= 3000


@need_ffmpeg
def test_a_record_take_is_trimmed_to_the_speech(settings, tmp_path):
    wav = padded_wav(tmp_path / "p.wav", lead_s=1.5, tail_s=1.5)  # 6 s on disk, 3 s of read
    body = run_record(settings, tmp_path, wav, GOOD, duration_ms=6000)
    assert body["status"] == "done" and body.get("unscorable") is None
    assert body["duration_ms"] < 4000  # silence either side is gone (150 ms of context stays)
    assert [w["status"] for w in body["words"]] == ["correct", "correct"]


@need_ffmpeg
def test_a_record_swap_reports_the_heard_sound(settings, tmp_path):
    body = run_record(settings, tmp_path, make_wav(tmp_path / "a.wav"), SWAPPED)
    sells = next(w for w in body["words"] if w["i"] == 1)
    assert sells["status"] == "wrong" and sells["reason"] == "focus_swap"
    swapped = next(p for p in sells["phonemes"] if p["verdict"] == "substituted")
    assert swapped["t"] == "S" and swapped["heard"] == "SH" and swapped["delta"] < 0


@need_ffmpeg
def test_record_audio_length_is_a_coarse_check(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav")  # 3 s of audio
    assert run_record(settings, tmp_path, wav, GOOD, duration_ms=3500)["status"] == "done"
    far = run_record(settings, tmp_path, wav, GOOD, duration_ms=9000)
    assert far["unscorable"] == "audio_mismatch"


@need_ffmpeg
def test_record_silence_is_inconclusive(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav", speech=False)
    body = run_record(settings, tmp_path, wav, GOOD)
    assert body["unscorable"] == "low_quality" and body["score"] is None


@need_ffmpeg
def test_a_spot_check_without_any_hash_is_still_refused(settings, tmp_path):
    wav = make_wav(tmp_path / "a.wav")
    data = payload(wav)
    data["attempt"]["audio_sha256"] = None
    data["audio"]["sha256"] = None
    job = ScoringJob.from_payload(data)
    store = ModelStore(
        tmp_path / "m",
        threads=1,
        allowed_hosts=(),
        api_base_url=settings.api_base_url,
        max_model_bytes=10**7,
        session_factory=lambda *_: FakeSession(GOOD),
    )
    ctx = JobContext(settings, Limits(max_height=0, max_s=90))
    assert handler.handle(job, ctx, Cloud(wav).client(), store)["unscorable"] == "audio_mismatch"
