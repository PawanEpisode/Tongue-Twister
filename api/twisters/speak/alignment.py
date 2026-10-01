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

# Order lock (mirrors web/src/lib/speak/align.ts): a pair may sit at most MAX_SKIP target words past
# the last accepted one. A longer jump is believed only when RESYNC_RUN correct words follow it;
# otherwise it is an echo of a repeated word and is undone.
MAX_SKIP = 6
RESYNC_RUN = 3


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


# Words a recogniser writes where a contraction's "'s" was said: "Sam is", "Sam has", "Sam s".
CONTRACTION_TAILS = frozenset({"is", "has", "s"})


def _merged(spoken: Sequence[str], i: int, wanted: set[str]) -> str:
    """The twister word that `spoken[i]` and `spoken[i + 1]` jointly say, or ''."""
    if i + 1 >= len(spoken) or spoken[i] in wanted:
        return ""
    compound = spoken[i] + spoken[i + 1]
    if compound in wanted:
        return compound  # 'sea' + 'shells' -> 'seashells'
    contraction = f"{spoken[i]}'s"
    if spoken[i + 1] in CONTRACTION_TAILS and contraction in wanted:
        return contraction  # 'sam' + 'is' -> "sam's"
    return ""


def merge_split_compounds(targets: Sequence[str], spoken: Sequence[str]) -> list[SpokenToken]:
    """Rejoin words a recogniser splits: 'sea' + 'shells' -> 'seashells', 'sam' + 'is' -> "sam's"."""
    wanted = set(targets)
    out: list[SpokenToken] = []
    i = 0
    while i < len(spoken):
        joined = _merged(spoken, i, wanted)
        if joined:
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


def _is_pair(row: Aligned) -> bool:
    return row.target_index is not None and row.spoken_index is not None


def _is_credited(row: Aligned) -> bool:
    return _is_pair(row) and row.status in (WordStatus.CORRECT, WordStatus.NEAR)


def _demote(row: Aligned) -> list[Aligned]:
    """Split a pair that broke the order lock into the target it did not earn and the stray word."""
    return [
        Aligned(row.target_index, None, row.target_word, "", Match(WordStatus.MISSED)),
        Aligned(None, row.spoken_index, "", row.spoken_word, Match(WordStatus.EXTRA)),
    ]


def enforce_order(rows: Sequence[Aligned]) -> list[Aligned]:
    """Keep credit in reading order: a repeated word cannot be claimed far from the speaker."""
    out: list[Aligned] = []
    last = -1
    for k, row in enumerate(rows):
        if not _is_pair(row):
            out.append(row)
            continue
        jump = row.target_index - last - 1
        run = 0
        while k + run < len(rows) and _is_credited(rows[k + run]):
            run += 1
        if jump <= MAX_SKIP or (_is_credited(row) and run >= RESYNC_RUN):
            last = row.target_index
            out.append(row)
        else:
            out.extend(_demote(row))
    return out


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
    return enforce_order(out)
