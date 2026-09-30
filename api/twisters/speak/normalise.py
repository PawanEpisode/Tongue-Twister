"""Text normalisation shared (by spec + test vectors) with ``web/src/lib/speak/normalise.ts``.

Both sides must tokenise a twister and a transcript identically, otherwise a word that looks
right on the client is scored wrong on the server. The rules are PRD 03 §6.1; the data
(spelling variants, homophone groups, fillers) is ``data/equivalents.json``.
"""

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).parent / "data" / "equivalents.json"

_APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "`": "'", "´": "'"})
_SEPARATORS = re.compile(r"[-‐‑‒–—_/\\]")
_TOKEN = re.compile(r"[^\W_]+(?:'[^\W_]+)*")
_ORDINAL = re.compile(r"^(\d+)(st|nd|rd|th)$")

_ONES = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen"
).split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
_ORDINAL_IRREGULAR = {
    "one": "first",
    "two": "second",
    "three": "third",
    "five": "fifth",
    "eight": "eighth",
    "nine": "ninth",
    "twelve": "twelfth",
}
MAX_SPELLED = 999_999


@lru_cache(maxsize=1)
def equivalents() -> dict:
    return json.loads(_DATA.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _spelling() -> dict[str, str]:
    return equivalents()["spelling"]


@lru_cache(maxsize=1)
def _fillers() -> frozenset[str]:
    return frozenset(equivalents()["fillers"])


@lru_cache(maxsize=1)
def _homophone_groups() -> dict[str, frozenset[str]]:
    """word -> every word (itself included) it can be confused with."""
    index: dict[str, set[str]] = {}
    for group in equivalents()["homophones"]:
        for word in group:
            index.setdefault(word, set()).update(group)
    return {word: frozenset(group) for word, group in index.items()}


def homophones(word: str) -> frozenset[str]:
    """Words a recogniser may return for `word` (contractions ignore the apostrophe: they're = there)."""
    return _homophone_groups().get(word.replace("'", ""), frozenset((word,)))


def spell_number(n: int) -> list[str]:
    """0..999 999 as words ('one hundred twenty three'); bigger numbers are read digit by digit."""
    if n < 0 or n > MAX_SPELLED:
        return [_ONES[int(d)] for d in str(abs(n))]
    if n < 20:
        return [_ONES[n]]
    if n < 100:
        tens, ones = divmod(n, 10)
        return [_TENS[tens]] + ([_ONES[ones]] if ones else [])
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        return [_ONES[hundreds], "hundred"] + (spell_number(rest) if rest else [])
    thousands, rest = divmod(n, 1000)
    return spell_number(thousands) + ["thousand"] + (spell_number(rest) if rest else [])


def _ordinal(n: int) -> list[str]:
    words = spell_number(n)
    last = words[-1]
    if last in _ORDINAL_IRREGULAR:
        words[-1] = _ORDINAL_IRREGULAR[last]
    elif last.endswith("y"):
        words[-1] = last[:-1] + "ieth"
    else:
        words[-1] = last + "th"
    return words


def _expand(token: str) -> list[str]:
    if token.isdigit():
        return spell_number(int(token))
    match = _ORDINAL.match(token)
    if match:
        return _ordinal(int(match.group(1)))
    return [token]


def _strip_marks(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def canonical(token: str) -> str:
    """Apostrophes at the edges of a token are quote marks, not part of the word."""
    token = token.strip("'")
    return _spelling().get(token, token)


def tokenise(text: str) -> list[str]:
    """Lower-case words: no punctuation (inner apostrophes kept), numerals spelled, spelling unified, fillers dropped."""
    text = _strip_marks(text.translate(_APOSTROPHES)).lower()
    text = _SEPARATORS.sub(" ", text)
    out: list[str] = []
    for raw in _TOKEN.findall(text):
        for token in _expand(raw.strip("'")):
            token = canonical(token)
            if token and token not in _fillers():
                out.append(token)
    return out
