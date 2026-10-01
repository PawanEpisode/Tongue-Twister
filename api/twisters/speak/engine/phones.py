"""ARPAbet confusion map: articulatory neighbours plus the twister's focus sounds (doc 10 §4.5)."""

from collections.abc import Collection, Sequence

_PAIRS = [
    ("S", "SH"), ("Z", "ZH"), ("S", "Z"), ("SH", "ZH"), ("S", "TH"), ("Z", "DH"), ("TH", "DH"),
    ("TH", "F"), ("DH", "V"), ("F", "V"), ("SH", "CH"), ("ZH", "JH"), ("CH", "JH"), ("CH", "T"),
    ("T", "D"), ("P", "B"), ("K", "G"), ("P", "T"), ("T", "K"), ("P", "K"), ("B", "D"), ("D", "G"),
    ("B", "G"), ("T", "TH"), ("D", "DH"), ("M", "N"), ("N", "NG"), ("M", "NG"), ("R", "L"),
    ("W", "V"), ("R", "W"), ("IY", "IH"), ("EH", "IH"), ("EH", "AE"), ("AA", "AO"), ("UW", "UH"),
    ("AH", "AA"), ("AO", "OW"), ("AH", "UH"),
]  # fmt: skip


def _build() -> dict[str, tuple[str, ...]]:
    table: dict[str, set[str]] = {}
    for a, b in _PAIRS:
        table.setdefault(a, set()).add(b)
        table.setdefault(b, set()).add(a)
    return {phone: tuple(sorted(others)) for phone, others in table.items()}


NEIGHBOURS = _build()


def confusables(phone: str, focus: Collection[str], vocab: Sequence[str]) -> list[str]:
    """Sorted, de-duplicated candidates a speaker might say instead of ``phone`` (only labels in ``vocab``)."""
    found = set(NEIGHBOURS.get(phone, ()))
    if phone in focus:
        found.update(focus)
    found.discard(phone)
    allowed = set(vocab)
    return sorted(q for q in found if q in allowed)
