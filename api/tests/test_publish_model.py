"""`publish_acoustic_model`: registering is safe, activating is guarded, published rows are immutable."""

import json

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from twisters.models import AcousticModelVersion, ScoringProfile

SHA = "c" * 64


def manifest(**over):
    model = {
        "name": "w2v-espeak-lv60-int8-r1",
        "base_model": "facebook/wav2vec2-lv-60-espeak-cv-ft",
        "licence": "Apache-2.0",
        "quantization": "int8",
        "size_bytes": 300_000_000,
        "sha256": SHA,
        "download_url": "https://x.supabase.co/storage/v1/object/public/models/w2v/w2v.onnx",
        "label_map_version": "lm1",
        **over,
    }
    return {
        "model": model,
        "label_map": {"version": "lm1", "path": "label_map.json", "sha256": "d" * 64},
    }


def publish(data, *args):
    call_command("publish_acoustic_model", "--json", json.dumps(data), *args)


@pytest.mark.django_db
def test_registering_creates_an_inactive_model_and_is_repeatable():
    publish(manifest())
    publish(manifest())
    model = AcousticModelVersion.objects.get(sha256=SHA)
    assert not model.active and model.released_at is None


@pytest.mark.django_db
def test_a_registered_model_cannot_be_changed_in_place():
    publish(manifest())
    with pytest.raises(CommandError, match="immutable"):
        publish(manifest(download_url="https://elsewhere.example.com/w2v.onnx"))


@pytest.mark.django_db
@pytest.mark.parametrize(
    "bad",
    [
        {"download_url": "http://x.supabase.co/m.onnx"},
        {"download_url": "https://huggingface.co/facebook/m.onnx"},
        {"sha256": "XYZ"},
        {"quantization": "int4"},
        {"licence": ""},
    ],
)
def test_bad_manifests_are_refused_before_anything_is_written(bad):
    with pytest.raises(CommandError):
        publish(manifest(**bad))
    assert not AcousticModelVersion.objects.exists()


@pytest.mark.django_db
def test_a_manifest_without_a_matching_label_map_is_refused():
    data = manifest()
    data["label_map"]["version"] = "lm2"
    with pytest.raises(CommandError, match="label_map"):
        publish(data)


@pytest.mark.django_db
def test_activation_needs_an_active_profile():
    with pytest.raises(CommandError, match="active scoring profile"):
        publish(manifest(), "--activate")
    assert not AcousticModelVersion.objects.filter(active=True).exists()


@pytest.mark.django_db
def test_activation_with_a_bootstrap_profile_retires_the_previous_model():
    old = AcousticModelVersion.objects.create(
        name="old",
        base_model="b",
        licence="l",
        quantization="int8",
        size_bytes=1,
        sha256="a" * 64,
        active=True,
    )
    publish(manifest(), "--activate", "--bootstrap-profile", "sp-0")
    old.refresh_from_db()
    new = AcousticModelVersion.objects.get(sha256=SHA)
    assert new.active and new.released_at and not old.active
    assert ScoringProfile.objects.get(code="sp-0").active


@pytest.mark.django_db
def test_exactly_one_source_is_required(tmp_path):
    with pytest.raises(CommandError, match="exactly one"):
        call_command("publish_acoustic_model")
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest()))
    call_command("publish_acoustic_model", str(path))
    assert AcousticModelVersion.objects.filter(sha256=SHA).exists()
