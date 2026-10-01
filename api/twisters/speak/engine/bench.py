"""Synthetic-posterior test bench (E3-2a): frame posteriors from a described read, no model and no audio.

A *read* is a list of items; ``realise`` turns words plus edits into that list, ``synthesise`` turns the list into
a log-posterior matrix. Everything is deterministic: the optional noise uses a small integer generator, so a seed
reproduces a matrix on any machine. (The TypeScript port consumes stored matrices, not this generator.)
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

from .types import BLANK, Posteriors, Word

PEAK = 0.9
LABEL_FRAMES = 2
GAP_FRAMES = 1
FLOOR = 1e-6


@dataclass(frozen=True)
class Item:
    """One realised sound: a phone (``mix`` blends in a second one), silence (phone ``""``), or a weak phone."""

    phone: str
    frames: int = LABEL_FRAMES
    peak: float = PEAK
    mix: str = ""
    share: float = 0.0


@dataclass(frozen=True)
class Edit:
    kind: str  # sub | del | blend | reduce | repeat_word | pause | extra | skip_word
    word: int = 0
    pos: int = 0
    phone: str = ""
    value: float = 0.0
    phones: tuple[str, ...] = field(default_factory=tuple)


def realise(
    words: Sequence[Word], edits: Sequence[Edit] = (), variant: Sequence[int] = ()
) -> list[Item]:
    """Words (first variant unless ``variant`` says otherwise) -> items, applying the edits."""
    by_word = [[e for e in edits if e.word == w] for w in range(len(words))]
    items: list[Item] = []
    for w, word in enumerate(words):
        mine = by_word[w]
        if any(e.kind == "skip_word" for e in mine):
            continue
        phones = word.variants[variant[w] if w < len(variant) else 0]
        word_items: list[Item] = []
        for pos, phone in enumerate(phones):
            item = Item(phone)
            for e in mine:
                if e.pos != pos:
                    continue
                if e.kind == "sub":
                    item = Item(e.phone)
                elif e.kind == "del":
                    item = Item("", 0)
                elif e.kind == "blend":
                    item = Item(phone, mix=e.phone, share=e.value)
                elif e.kind == "reduce":
                    item = Item(phone, 1, e.value or 0.45)
            if item.frames:
                word_items.append(item)
        items.extend(word_items)
        for e in mine:
            if e.kind == "repeat_word":
                items.append(Item("", 3))
                items.extend(Item(p) for p in phones)
            elif e.kind == "extra":
                items.extend(Item(p) for p in e.phones)
            elif e.kind == "pause":
                items.append(Item("", int(e.value)))
        items.append(Item("", 2))
    return items


class _Lcg:
    """Numerical Recipes constants; ``uniform()`` is in [-1, 1)."""

    def __init__(self, seed: int):
        self.state = seed & 0xFFFFFFFF

    def uniform(self) -> float:
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state / 2147483648 - 1.0


def synthesise(
    items: Sequence[Item],
    vocab: Sequence[str],
    *,
    noise: float = 0.0,
    seed: int = 1,
    lead: int = 3,
    tail: int = 3,
) -> Posteriors:
    """Rows: a label frame puts ``peak`` on the phone (and ``share`` of it on a blend), the rest on blank."""
    names = (BLANK, *[v for v in vocab if v != BLANK])
    index = {n: i for i, n in enumerate(names)}
    rng = _Lcg(seed)
    rows: list[list[float]] = []

    def push(weights: dict[str, float]) -> None:
        raw = [FLOOR] * len(names)
        for name, w in weights.items():
            raw[index[name]] += w
        if noise:
            raw = [r * math.exp(noise * rng.uniform()) for r in raw]
        total = sum(raw)
        rows.append([round(math.log(r / total), 4) for r in raw])

    for _ in range(lead):
        push({BLANK: 1.0})
    for item in items:
        for _ in range(item.frames):
            if not item.phone:
                push({BLANK: 1.0})
            elif item.mix:
                push(
                    {
                        item.phone: item.peak * (1 - item.share),
                        item.mix: item.peak * item.share,
                        BLANK: 1 - item.peak,
                    }
                )
            else:
                push({item.phone: item.peak, BLANK: 1 - item.peak})
        if item.phone:
            for _ in range(GAP_FRAMES):
                push({BLANK: 1.0})
    for _ in range(tail):
        push({BLANK: 1.0})
    return Posteriors(tuple(names), rows)


def silence(frames: int, vocab: Sequence[str]) -> Posteriors:
    return synthesise([Item("", frames)], vocab, lead=0, tail=0)
