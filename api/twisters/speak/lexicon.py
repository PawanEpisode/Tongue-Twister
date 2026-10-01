"""Word -> ARPAbet pronunciations: CMUdict, then suffix and compound rules (docs/features/10 §3.2).

Overrides (`TwisterPronunciation`) are applied by the caller and win over everything here. A twister
cannot be published while one of its words resolves to nothing (checked by `build_pronunciations`).
"""

from collections.abc import Callable
from functools import lru_cache

SIBILANTS = {"S", "Z", "SH", "ZH", "CH", "JH"}
VOICELESS = {"P", "T", "K", "F", "TH", "S", "SH", "CH"}
MIN_COMPOUND_PART = 3

Variants = list[list[str]]


@lru_cache(maxsize=1)
def cmudict_entries() -> dict[str, Variants]:
    try:
        import cmudict
    except ImportError as exc:  # pragma: no cover - dev/CI dependency, see requirements-dev.txt
        raise RuntimeError("The CMUdict lexicon is missing: pip install cmudict") from exc
    return {
        word: [[p.rstrip("012") for p in variant] for variant in variants]
        for word, variants in cmudict.dict().items()
    }


def _plural(base: list[str]) -> list[str]:
    last = base[-1]
    if last in SIBILANTS:
        return [*base, "IH", "Z"]
    return [*base, "S" if last in VOICELESS else "Z"]


def _past(base: list[str]) -> list[str]:
    last = base[-1]
    if last in ("T", "D"):
        return [*base, "IH", "D"]
    return [*base, "T" if last in VOICELESS else "D"]


def _with(suffix: list[str]) -> Callable[[list[str]], list[str]]:
    return lambda base: [*base, *suffix]


# (spelling suffix, spelling of the base to try, phone builder). Tried in order; first hit wins.
_SUFFIXES: list[tuple[str, list[str], Callable[[list[str]], list[str]]]] = [
    ("'s", [""], _plural),  # possessives and "is"/"has" contractions: Sam's, pickle's
    ("ies", ["y"], _plural),
    ("es", ["", "e"], _plural),
    ("s", [""], _plural),
    ("ied", ["y"], _past),
    ("ed", ["", "e"], _past),
    ("ing", ["", "e"], _with(["IH", "NG"])),
    ("ily", ["y"], _with(["AH", "L", "IY"])),
    ("ly", [""], _with(["L", "IY"])),
    ("ness", [""], _with(["N", "AH", "S"])),
    ("less", [""], _with(["L", "AH", "S"])),
    ("ish", ["", "e"], _with(["IH", "SH"])),
    ("ers", ["", "e"], lambda b: [*_with(["ER"])(b), "Z"]),
    ("er", ["", "e"], _with(["ER"])),
]


def _bases(word: str, suffix: str, endings: list[str]):
    stem = word[: -len(suffix)]
    for ending in endings:
        yield stem + ending
    if len(stem) > 2 and stem[-1] == stem[-2]:  # formatted -> format, hiccuping -> hiccup
        yield stem[:-1]


def lookup(word: str, *, _depth: int = 0) -> Variants:
    """All pronunciations for one normalised word, or [] when nothing (rule-based) resolves it."""
    entries = cmudict_entries()
    if word in entries:
        return entries[word]
    if "'" in word:
        base, _, tail = word.partition("'")
        if tail == "s" and base:
            return [_plural(v) for v in lookup(base, _depth=_depth)]
        word = word.replace("'", "")
        return entries.get(word, [])
    if _depth > 1:
        return []
    for suffix, endings, build in _SUFFIXES:
        if not word.endswith(suffix) or len(word) <= len(suffix) + 1:
            continue
        for base in _bases(word, suffix, endings):
            found = lookup(base, _depth=_depth + 1) if base != word else []
            if found:
                return [build(v) for v in found]
    return _compound(word, entries)


def _compound(word: str, entries: dict[str, Variants]) -> Variants:
    for cut in range(len(word) - MIN_COMPOUND_PART, MIN_COMPOUND_PART - 1, -1):
        head, tail = word[:cut], word[cut:]
        if head in entries and tail in entries:
            return [h + t for h in entries[head][:1] for t in entries[tail][:1]]
    return []


def format_variant(variant: list[str]) -> str:
    return " ".join(variant)
