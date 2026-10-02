"""Register an exported acoustic model (tools/export_model) and, when asked, switch it on.

    python manage.py publish_acoustic_model out/<name>/manifest.json
    python manage.py publish_acoustic_model --json '<manifest.json contents>' --activate --bootstrap-profile sp-0

Registering is safe: a new model is inactive and nothing uses it. `--activate` is the switch (docs/features/13
section 3.1): it needs an active scoring profile for the model (or `--bootstrap-profile` to create one with the
engine's default thresholds), retires the previously active model, and is refused when the model's
`download_url` is not our own https storage. The model is identified by its sha-256 (D39); a row is never edited
in place, because every cached copy in browsers and workers is keyed by that hash.
"""

import json
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from twisters.models import AcousticModelVersion, ScoringProfile

SHA = re.compile(r"^[0-9a-f]{64}$")
FIELDS = (
    "name",
    "base_model",
    "licence",
    "quantization",
    "size_bytes",
    "sha256",
    "download_url",
    "label_map_version",
)


def parse_manifest(raw: str) -> dict:
    try:
        manifest = json.loads(raw)
    except ValueError as exc:
        raise CommandError(f"manifest is not valid JSON: {exc}") from exc
    model = manifest.get("model") if isinstance(manifest, dict) else None
    if not isinstance(model, dict):
        raise CommandError("manifest has no `model` block")
    missing = [k for k in FIELDS if model.get(k) in (None, "")]
    if missing:
        raise CommandError(f"manifest.model is missing {missing}")
    if not SHA.match(str(model["sha256"])):
        raise CommandError("model.sha256 must be a 64-character lowercase hex digest")
    if model["quantization"] not in AcousticModelVersion.Quantization.values:
        raise CommandError("model.quantization must be fp32, fp16 or int8")
    url = str(model["download_url"])
    if not url.startswith("https://") or "huggingface" in url:
        raise CommandError(
            "model.download_url must be https on our own storage (never Hugging Face)"
        )
    labels = manifest.get("label_map")
    if not isinstance(labels, dict) or labels.get("version") != model["label_map_version"]:
        raise CommandError("manifest has no label_map block matching model.label_map_version")
    return {k: model[k] for k in FIELDS}


class Command(BaseCommand):
    help = (
        "Register an exported acoustic model; --activate switches it on (see the module docstring)."
    )

    def add_arguments(self, parser):
        parser.add_argument("manifest", nargs="?", type=Path, help="path to manifest.json")
        parser.add_argument("--json", dest="inline", help="the manifest.json contents, inline")
        parser.add_argument("--activate", action="store_true")
        parser.add_argument(
            "--bootstrap-profile",
            metavar="CODE",
            help="create an active profile with default thresholds",
        )

    @transaction.atomic
    def handle(self, manifest=None, inline=None, activate=False, bootstrap_profile=None, **_):
        if bool(manifest) == bool(inline):
            raise CommandError("give exactly one of MANIFEST or --json")
        fields = parse_manifest(inline if inline else manifest.read_text("utf-8"))
        model, created = AcousticModelVersion.objects.select_for_update().get_or_create(
            sha256=fields["sha256"], defaults=fields
        )
        if not created:
            changed = [k for k in FIELDS if getattr(model, k) != fields[k]]
            if changed:
                raise CommandError(
                    f"{model.name} is already registered with different {changed}; a published model is "
                    "immutable. Export a new release instead."
                )
        self.stdout.write(
            f"{'registered' if created else 'already registered'}: {model.name} ({model.sha256[:12]})"
        )
        if bootstrap_profile:
            profile, made = ScoringProfile.objects.get_or_create(
                code=bootstrap_profile, defaults={"model_version": model, "active": False}
            )
            if profile.model_version_id != model.pk:
                raise CommandError(f"profile {bootstrap_profile!r} belongs to another model")
            self.stdout.write(f"{'created' if made else 'found'} profile {profile.code}")
        if not activate:
            return
        profiles = ScoringProfile.objects.filter(model_version=model)
        if bootstrap_profile:
            profiles.filter(code=bootstrap_profile).update(active=True)
        if not profiles.filter(active=True).exists():
            raise CommandError(
                "no active scoring profile for this model; calibrate one or pass --bootstrap-profile"
            )
        AcousticModelVersion.objects.exclude(pk=model.pk).filter(active=True).update(active=False)
        model.active = True
        model.released_at = model.released_at or timezone.now()
        model.save(update_fields=["active", "released_at"])
        self.stdout.write(self.style.SUCCESS(f"{model.name} is now the active model"))
