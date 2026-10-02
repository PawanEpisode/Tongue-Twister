#!/usr/bin/env python3
"""Build `label_map.json` from the model's `vocab.json` (docs/features/10 section 4.1, features/13 section 3.1).

The acoustic model emits raw espeak-IPA labels; the pronunciation engine reasons over ARPAbet classes. This is
the table between them, generated from reviewed rules (`label_map_rules.json`) and *never* guessed: a label
the rules do not cover stops the export, listing exactly what to add (or to pass via `--overrides`). A map
that leaves an engine class with no source label also stops the export, because that sound could then never
be heard and every word containing it would be marked wrong.

    python label_map.py --vocab out/<name>/vocab.json --version lm1 --out out/<name>/label_map.json
    python label_map.py --check out/<name>            # label_map.json agrees with vocab.json (also run by --verify)

Format (read by web/src/lib/speak/engine/runtime/labelMap.ts and worker/twister_worker/scoring/labels.py):
    {"version", "blank", "vocab": [raw labels by id], "classes": ["<b>", ...], "map": {raw: class},
     "drop": [raw, ...], "sources": {"vocab_sha256", "rules_sha256", "generator"}}
Dropped labels (word delimiters, glottal stop, British centring diphthongs, ...) and the blank all count as
blank at inference time: no evidence for or against any phone.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import unicodedata
from pathlib import Path
from typing import Any

GENERATOR = "label-map/1"
RULES_PATH = Path(__file__).with_name("label_map_rules.json")
ENGINE_BLANK = "<b>"
# Characters removed before looking a label up: stress, length, tie bars, and modifier letters that colour a
# phone without changing which phone it is (aspiration, palatalisation, labialisation, ...).
_MODIFIERS = set("ˈˌːˑ͜͡‿ʰʲʷˠˤⁿˀʼ")
_MAX_ENGINE_CLASSES = 64


class LabelMapError(Exception):
    """A user-facing failure; the message says what to fix."""


def load_rules(path: Path = RULES_PATH) -> dict[str, Any]:
    rules = json.loads(path.read_text("utf-8"))
    classes = rules["classes"]
    if classes[0] != ENGINE_BLANK or len(set(classes)) != len(classes) or len(classes) > _MAX_ENGINE_CLASSES:
        raise LabelMapError("rules: classes must start with the engine blank and be unique")
    bad = sorted({c for c in rules["map"].values() if c not in classes})
    if bad:
        raise LabelMapError(f"rules: map targets unknown classes {bad}")
    return rules


def normalise(label: str) -> str:
    """`ˈaɪ` -> `aɪ`, `t͡ʃ` -> `tʃ`, `ã` -> `a`, `iː` -> `i`."""
    decomposed = unicodedata.normalize("NFD", label)
    kept = [c for c in decomposed if c not in _MODIFIERS and unicodedata.category(c) != "Mn"]
    return unicodedata.normalize("NFC", "".join(kept))


def sha256_json(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def ordered_vocab(vocab: dict[str, int]) -> list[str]:
    ids = sorted(vocab.values())
    if ids != list(range(len(ids))):
        raise LabelMapError("vocab ids must be exactly 0..n-1 with no gaps or duplicates")
    out = [""] * len(ids)
    for label, i in vocab.items():
        out[i] = label
    return out


def classify(label: str, rules: dict[str, Any], overrides: dict[str, Any]) -> tuple[str, str | None]:
    """('map', class) | ('drop', None) | ('unmapped', None)."""
    if label in overrides.get("drop", []):
        return "drop", None
    if label in overrides.get("map", {}):
        return "map", overrides["map"][label]
    if label in rules["drop"]:
        return "drop", None
    base = normalise(label)
    if base == "":
        return "drop", None  # nothing but marks (a bare length mark, a stress mark)
    if base in overrides.get("drop", []) or base in rules["drop"]:
        return "drop", None
    if base in overrides.get("map", {}):
        return "map", overrides["map"][base]
    if base in rules["map"]:
        return "map", rules["map"][base]
    return "unmapped", None


def build(
    vocab: dict[str, int],
    *,
    version: str,
    rules: dict[str, Any] | None = None,
    overrides: dict[str, Any] | None = None,
    require_coverage: bool = True,
) -> dict[str, Any]:
    rules = rules or load_rules()
    overrides = overrides or {}
    bad_override = sorted({c for c in overrides.get("map", {}).values() if c not in rules["classes"]})
    if bad_override:
        raise LabelMapError(f"overrides target unknown classes {bad_override}")
    labels = ordered_vocab(vocab)
    blank = rules["blank"]
    if blank not in vocab:
        raise LabelMapError(f"the vocab has no blank label {blank!r}")
    mapping: dict[str, str] = {}
    dropped: list[str] = []
    unmapped: list[str] = []
    for label in labels:
        if label == blank:
            continue
        kind, target = classify(label, rules, overrides)
        if kind == "map" and target is not None:
            mapping[label] = target
        elif kind == "drop":
            dropped.append(label)
        else:
            unmapped.append(label)
    problems = []
    if unmapped:
        problems.append(
            f"{len(unmapped)} label(s) have no rule: {unmapped}. Add them to label_map_rules.json (reviewed) or "
            'pass --overrides FILE with {"map": {"label": "CLASS"}, "drop": ["label"]}.'
        )
    if require_coverage:
        covered = set(mapping.values())
        missing = [c for c in rules["classes"][1:] if c not in covered and c not in rules.get("optional_classes", [])]
        if missing:
            problems.append(
                f"no label maps to {missing}: those sounds could never be heard. Check the rules against the "
                "vocab (is this the right model?)"
            )
    if problems:
        raise LabelMapError("\n".join(problems))
    return {
        "version": version,
        "blank": blank,
        "vocab": labels,
        "classes": rules["classes"],
        "map": mapping,
        "drop": sorted(dropped),
        "sources": {
            "vocab_sha256": sha256_json(vocab),
            "rules_sha256": sha256_json({"rules": rules, "overrides": overrides}),
            "generator": GENERATOR,
        },
    }


def check(label_map: dict[str, Any], vocab: dict[str, int]) -> list[str]:
    """Consistency of an existing label_map.json with the vocab it claims to describe."""
    problems = []
    try:
        if label_map["vocab"] != ordered_vocab(vocab):
            problems.append("label_map vocab order differs from vocab.json")
        if label_map["sources"]["vocab_sha256"] != sha256_json(vocab):
            problems.append("label_map was built from a different vocab.json")
        classes = label_map["classes"]
        if classes[0] != ENGINE_BLANK or len(set(classes)) != len(classes):
            problems.append("classes must start with the engine blank and be unique")
        known = set(label_map["vocab"])
        accounted = set(label_map["map"]) | set(label_map["drop"]) | {label_map["blank"]}
        if known != accounted:
            problems.append(f"labels not accounted for: {sorted(known - accounted)}")
        if set(label_map["map"]) & set(label_map["drop"]):
            problems.append("a label is both mapped and dropped")
        if any(c not in classes for c in label_map["map"].values()):
            problems.append("map targets a class that is not in classes")
    except (KeyError, TypeError, ValueError) as exc:
        problems.append(f"label_map.json is malformed: {exc!r}")
    return problems


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Generate or check label_map.json.")
    p.add_argument("--vocab", type=Path, help="vocab.json written by export_model.py")
    p.add_argument("--version", default="lm1")
    p.add_argument("--overrides", type=Path, help='{"map": {"label": "CLASS"}, "drop": ["label"]}')
    p.add_argument("--out", type=Path)
    p.add_argument("--partial", action="store_true", help="skip the every-class-is-covered check (tests only)")
    p.add_argument("--check", type=Path, metavar="DIR", help="verify DIR/label_map.json against DIR/vocab.json")
    args = p.parse_args(argv)
    try:
        if args.check:
            vocab = json.loads((args.check / "vocab.json").read_text("utf-8"))
            lm = json.loads((args.check / "label_map.json").read_text("utf-8"))
            problems = check(lm, vocab)
            for line in problems:
                print(f"FAIL {line}")
            print("OK" if not problems else f"{len(problems)} problem(s)")
            return 1 if problems else 0
        if not args.vocab or not args.out:
            p.error("--vocab and --out are required")
        vocab = json.loads(args.vocab.read_text("utf-8"))
        overrides = json.loads(args.overrides.read_text("utf-8")) if args.overrides else None
        lm = build(vocab, version=args.version, overrides=overrides, require_coverage=not args.partial)
    except (LabelMapError, OSError, ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    args.out.write_text(json.dumps(lm, ensure_ascii=False, indent=2) + "\n", "utf-8")
    print(f"wrote {args.out}: {len(lm['map'])} mapped, {len(lm['drop'])} dropped, {len(lm['classes']) - 1} classes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
