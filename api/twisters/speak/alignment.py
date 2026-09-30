"""Needleman-Wunsch alignment of spoken words to target words (PRD 03 §5.1).

Costs are integers (x10) so both implementations — this one and ``web/src/lib/speak/align.ts`` —
tie-break identically: diagonal first, then a missed target word, then an extra spoken word.
Ties resolve towards the earliest match, so a repeated phrase credits its first repetition.
"""

from collections.abc import Callable, Collection, Sequence
from dataclasses import dataclass

from ..models import WordStatus
from .similarity import Match, classify

COST_NEAR = 3
COST_WRONG = 10
COST_GAP = 10


@dataclass(frozen=True)
class SpokenToken:
    """One recognised word. `raw` differs from `text` when several spoken words were merged."""

    text: str
    index: int
    raw: str = ""

    @property
    def heard(self) -> str:
        return self.raw or self.text


@dataclass(frozen=True)
class Aligned:
    target_index: int | None
    spoken_index: int | None
    target_word: str
    spoken_word: str
    match: Match

    @property
    def status(self) -> str:
        return self.match.status

    @property
    def reason(self) -> str:
        return self.match.reason


def merge_split_compounds(targets: Sequence[str], spoken: Sequence[str]) -> list[SpokenToken]:
    """'sea' + 'shells' -> 'seashells' when the twister has that compound (recognisers split them)."""
    wanted = set(targets)
    out: list[SpokenToken] = []
    i = 0
    while i < len(spoken):
        joined = spoken[i] + spoken[i + 1] if i + 1 < len(spoken) else ""
        if joined and joined in wanted and spoken[i] not in wanted:
            out.append(SpokenToken(joined, i, f"{spoken[i]} {spoken[i + 1]}"))
            i += 2
        else:
            out.append(SpokenToken(spoken[i], i))
            i += 1
    return out


def _pair_cost(match: Match) -> int:
    if match.status == WordStatus.CORRECT:
        return 0
    return COST_NEAR if match.status == WordStatus.NEAR else COST_WRONG


def align(
    targets: Sequence[str],
    spoken: Sequence[SpokenToken],
    classifier: Callable[[str, str], Match] | None = None,
    *,
    focus: Collection[str] = (),
    accepted: dict[str, Collection[str]] | None = None,
) -> list[Aligned]:
    accepted = accepted or {}
    if classifier is None:

        def classifier(t: str, s: str) -> Match:
            return classify(t, s, focus, accepted.get(t, ()))

    cache: dict[tuple[str, str], Match] = {}

    def compare(t: str, s: str) -> Match:
        key = (t, s)
        if key not in cache:
            cache[key] = classifier(t, s)
        return cache[key]

    n, m = len(targets), len(spoken)
    # cost[i][j] = cheapest way to align targets[i:] with spoken[j:]; walking forward from (0, 0)
    # therefore credits the *earliest* repetition of a repeated phrase and calls later ones extra.
    cost = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        cost[i][m] = (n - i) * COST_GAP
    for j in range(m - 1, -1, -1):
        cost[n][j] = (m - j) * COST_GAP
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            diag = cost[i + 1][j + 1] + _pair_cost(compare(targets[i], spoken[j].text))
            cost[i][j] = min(diag, cost[i + 1][j] + COST_GAP, cost[i][j + 1] + COST_GAP)

    out: list[Aligned] = []
    i = j = 0
    while i < n or j < m:
        if i < n and j < m:
            match = compare(targets[i], spoken[j].text)
            if cost[i][j] == cost[i + 1][j + 1] + _pair_cost(match):
                tok = spoken[j]
                out.append(Aligned(i, tok.index, targets[i], tok.heard, match))
                i, j = i + 1, j + 1
                continue
        if i < n and cost[i][j] == cost[i + 1][j] + COST_GAP:
            out.append(Aligned(i, None, targets[i], "", Match(WordStatus.MISSED)))
            i += 1
        else:
            tok = spoken[j]
            out.append(Aligned(None, tok.index, "", tok.heard, Match(WordStatus.EXTRA)))
            j += 1
    return out
