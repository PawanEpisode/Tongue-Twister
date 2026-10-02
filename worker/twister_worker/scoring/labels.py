"""`label_map.json`: the model's raw (IPA) output labels -> the engine's ARPAbet classes (doc 10 §4.1)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import numpy as np

from ..engine.types import BLANK
from ..errors import JobFailed


@dataclass(frozen=True)
class LabelMap:
    version: str
    classes: tuple[str, ...]  # classes[0] is the CTC blank (BLANK)
    matrix: np.ndarray  # (V, C) float32 0/1: raw label -> class
    vocab_sha256: str

    @classmethod
    def from_json(cls, raw: bytes | str) -> LabelMap:
        try:
            return cls._parse(json.loads(raw))
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise JobFailed(
                "label_map_invalid", f"unusable label map: {type(exc).__name__}"
            ) from exc

    @classmethod
    def _parse(cls, data: dict[str, Any]) -> LabelMap:
        vocab: list[str] = data["vocab"]
        classes: list[str] = data["classes"]
        mapping: dict[str, str] = data["map"]
        drop = set(data.get("drop", []))
        blank = data["blank"]
        if classes[0] != BLANK or len(set(classes)) != len(classes):
            raise ValueError("classes must start with the blank and be unique")
        if len(set(vocab)) != len(vocab) or blank not in vocab:
            raise ValueError("vocab must be unique and contain the blank")
        position = {c: i for i, c in enumerate(classes)}
        matrix = np.zeros((len(vocab), len(classes)), dtype=np.float32)
        for row, label in enumerate(vocab):
            if label == blank or label in drop:
                # Silence and word delimiters carry no phone: they count as blank.
                matrix[row, 0] = 1.0
            elif label in mapping and mapping[label] in position:
                matrix[row, position[mapping[label]]] = 1.0
            else:
                raise ValueError(f"unmapped label {label!r}")
        return cls(
            version=str(data["version"]),
            classes=tuple(classes),
            matrix=matrix,
            vocab_sha256=str((data.get("sources") or {}).get("vocab_sha256", "")),
        )

    def collapse(self, logits: np.ndarray) -> np.ndarray:
        """(T, V) raw logits -> (T, C) log class posteriors: softmax over the raw labels, sum the labels that
        share a class, take logs. Rows sum to one over the classes."""
        if logits.ndim != 2 or logits.shape[1] != self.matrix.shape[0]:
            raise JobFailed("model_mismatch", "model output width does not match the label map")
        shifted = logits - logits.max(axis=1, keepdims=True)
        probs = np.exp(shifted.astype(np.float64))
        probs /= probs.sum(axis=1, keepdims=True)
        merged = probs @ self.matrix.astype(np.float64)
        return np.log(np.maximum(merged, 1e-12))
