"""Pass 1 of the two-pass alignment (doc 10 §4.4): free decode, phoneme edit alignment, word windows."""

from collections.abc import Sequence

COST_SUB = 10
COST_GAP = 10


def greedy_decode(logp: list[list[float]], blank: int = 0) -> list[tuple[int, int, int]]:
    """Argmax per frame, repeats collapsed, blanks dropped: ``(label, start, end)`` with a half-open frame span."""
    out: list[list[int]] = []
    last = blank
    for t, row in enumerate(logp):
        best = 0
        for q in range(1, len(row)):
            if row[q] > row[best]:
                best = q
        if best == blank:
            last = blank
            continue
        if best == last and out:
            out[-1][2] = t + 1
        else:
            out.append([best, t, t + 1])
        last = best
    return [(a, b, c) for a, b, c in out]


def edit_align(
    expected: Sequence[str], heard: Sequence[str]
) -> list[tuple[int | None, int | None]]:
    """Phoneme edit alignment as ``(expected_index, heard_index)`` rows.

    Costs are integers; ties resolve diagonal first, then a missed expected phone, then an extra heard one
    (the same order as the word aligner in ``twisters.speak.alignment``).
    """
    n, m = len(expected), len(heard)
    # cost[i][j] = cheapest alignment of expected[i:] with heard[j:]; walking forward then prefers the
    # earliest match, so a repeated phrase is credited to its first repetition.
    cost = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        cost[i][m] = (n - i) * COST_GAP
    for j in range(m - 1, -1, -1):
        cost[n][j] = (m - j) * COST_GAP
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            sub = 0 if expected[i] == heard[j] else COST_SUB
            cost[i][j] = min(
                cost[i + 1][j + 1] + sub, cost[i + 1][j] + COST_GAP, cost[i][j + 1] + COST_GAP
            )
    rows: list[tuple[int | None, int | None]] = []
    i = j = 0
    while i < n or j < m:
        if i < n and j < m:
            sub = 0 if expected[i] == heard[j] else COST_SUB
            if cost[i][j] == cost[i + 1][j + 1] + sub:
                rows.append((i, j))
                i, j = i + 1, j + 1
                continue
        if i < n and cost[i][j] == cost[i + 1][j] + COST_GAP:
            rows.append((i, None))
            i += 1
        else:
            rows.append((None, j))
            j += 1
    return rows


def extra_runs(rows: Sequence[tuple[int | None, int | None]], minimum: int) -> int:
    """Runs of at least ``minimum`` consecutive extra heard phones (unexpected speech)."""
    runs = 0
    length = 0
    for i, j in rows:
        if i is None and j is not None:
            length += 1
            continue
        if length >= minimum:
            runs += 1
        length = 0
    if length >= minimum:
        runs += 1
    return runs


def word_windows(
    rows: Sequence[tuple[int | None, int | None]],
    word_of: Sequence[int],
    segments: Sequence[tuple[int, int, int]],
    words: int,
    frames: int,
    pad: int,
) -> list[tuple[int, int] | None]:
    """A half-open frame window per word (None when no heard phone was matched to it); windows never overlap."""
    core: list[list[int] | None] = [None] * words
    for i, j in rows:
        if i is None or j is None:
            continue
        _, start, end = segments[j]
        w = word_of[i]
        if core[w] is None:
            core[w] = [start, end]
        else:
            core[w][0] = min(core[w][0], start)
            core[w][1] = max(core[w][1], end)
    windows: list[list[int] | None] = [
        None if c is None else [max(0, c[0] - pad), min(frames, c[1] + pad)] for c in core
    ]
    last: list[int] | None = None
    for window in windows:
        if window is None:
            continue
        if last is not None and window[0] < last[1]:
            mid = (window[0] + last[1]) // 2
            last[1] = mid
            window[0] = mid
        last = window
    return [None if w is None else (w[0], w[1]) for w in windows]
