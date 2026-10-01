"""Interfaces a real model, lexicon or G2P plugs into, plus accent rewrite rules (doc 10 §3.2, §4.2).

``Pronouncer`` is the lexicon seam (CMUdict, overrides, build-time G2P all satisfy it). ``AcousticModel`` is the
seam for the wav2vec2 export (E3-3/E3-4). Accent rules widen the accepted variants but are switched off when
they would neutralise a contrast the twister trains (the *protected contrast* rule).
"""

from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from ..normalise import tokenise
from .types import Posteriors, Word

MAX_VARIANTS = 8


class Pronouncer(Protocol):
    def variants(self, word: str) -> list[list[str]] | None:
        """ARPAbet variants without stress, or None when the word has no pronunciation."""


class AcousticModel(Protocol):
    def posteriors(self, samples: Sequence[float], sample_rate: int) -> Posteriors:
        """Frame log-posteriors (50 frames per second, blank first) for a mono clip."""


class UnpronounceableWords(ValueError):
    def __init__(self, words: list[str]):
        super().__init__(f"no pronunciation for: {', '.join(words)}")
        self.words = words


@dataclass(frozen=True)
class DictPronouncer:
    table: Mapping[str, list[list[str]]]

    def variants(self, word: str) -> list[list[str]] | None:
        found = self.table.get(word)
        return [list(v) for v in found] if found else None


@dataclass(frozen=True)
class AccentRule:
    """``src -> dst`` everywhere in a variant. Off when any of ``protects`` is a focus sound of the twister."""

    src: str
    dst: str
    protects: tuple[str, ...] = ()


def expand_variants(
    variants: list[list[str]], rules: Sequence[AccentRule], focus: Collection[str]
) -> list[list[str]]:
    """Original variants first, then one rewritten copy per active rule and variant; de-duplicated and capped."""
    active = [r for r in rules if not any(p in focus for p in r.protects)]
    out: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()

    def add(variant: list[str]) -> None:
        key = tuple(variant)
        if key not in seen and len(out) < MAX_VARIANTS:
            seen.add(key)
            out.append(variant)

    for variant in variants:
        add(list(variant))
    for variant in variants:
        for rule in active:
            if rule.src in variant:
                add([rule.dst if p == rule.src else p for p in variant])
    return out


def expected_words(
    text: str,
    pronouncer: Pronouncer,
    *,
    rules: Sequence[AccentRule] = (),
    focus: Collection[str] = (),
    normalise: Callable[[str], list[str]] = tokenise,
) -> list[Word]:
    """Normalise ``text`` and look every word up; a word without a pronunciation blocks the whole attempt."""
    tokens = normalise(text)
    missing = [t for t in tokens if not pronouncer.variants(t)]
    if missing:
        raise UnpronounceableWords(sorted(set(missing)))
    return [Word(t, expand_variants(pronouncer.variants(t) or [], rules, focus)) for t in tokens]
