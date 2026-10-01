"""CTC forward probability and Viterbi forced alignment over a log-posterior matrix (doc 10 §4.3).

The lattice is the standard one: blank, label, blank, ... Ties in Viterbi prefer the shorter step (stay, then
advance one, then skip a blank), and the final state prefers the last label, so the TypeScript port agrees.
"""

import math

NEG_INF = -math.inf


def logaddexp(a: float, b: float) -> float:
    if a == NEG_INF:
        return b
    if b == NEG_INF:
        return a
    hi = a if a > b else b
    return hi + math.log1p(math.exp(-abs(a - b)))


def _extended(labels: list[int], blank: int) -> list[int]:
    ext = [blank] * (2 * len(labels) + 1)
    for k, label in enumerate(labels):
        ext[2 * k + 1] = label
    return ext


def ctc_log_prob(logp: list[list[float]], labels: list[int], blank: int = 0) -> float:
    """log P(labels | X) summed over every CTC alignment."""
    frames = len(logp)
    if frames == 0:
        return 0.0 if not labels else NEG_INF
    ext = _extended(labels, blank)
    size = len(ext)
    prev = [NEG_INF] * size
    prev[0] = logp[0][blank]
    if size > 1:
        prev[1] = logp[0][ext[1]]
    for t in range(1, frames):
        row = logp[t]
        cur = [NEG_INF] * size
        for s in range(size):
            acc = prev[s]
            if s >= 1:
                acc = logaddexp(acc, prev[s - 1])
            if s >= 2 and ext[s] != blank and ext[s] != ext[s - 2]:
                acc = logaddexp(acc, prev[s - 2])
            cur[s] = acc + row[ext[s]] if acc != NEG_INF else NEG_INF
        prev = cur
    return logaddexp(prev[size - 1], prev[size - 2]) if size > 1 else prev[0]


def forced_align(
    logp: list[list[float]], labels: list[int], blank: int = 0
) -> list[tuple[int, int]] | None:
    """Best path through ``labels``: a half-open frame span per label, or None when it cannot fit."""
    frames = len(logp)
    if not labels:
        return []
    if frames == 0:
        return None
    ext = _extended(labels, blank)
    size = len(ext)
    prev = [NEG_INF] * size
    prev[0] = logp[0][blank]
    prev[1] = logp[0][ext[1]]
    back: list[list[int]] = [[0] * size]
    for t in range(1, frames):
        row = logp[t]
        cur = [NEG_INF] * size
        step = [0] * size
        for s in range(size):
            best, how = prev[s], 0
            if s >= 1 and prev[s - 1] > best:
                best, how = prev[s - 1], 1
            if s >= 2 and ext[s] != blank and ext[s] != ext[s - 2] and prev[s - 2] > best:
                best, how = prev[s - 2], 2
            if best != NEG_INF:
                cur[s] = best + row[ext[s]]
                step[s] = how
        prev = cur
        back.append(step)
    state = size - 1
    if prev[size - 2] > prev[size - 1]:
        state = size - 2
    if prev[state] == NEG_INF:
        return None
    path = [0] * frames
    for t in range(frames - 1, -1, -1):
        path[t] = state
        state -= back[t][state]
    spans: list[list[int]] = [[-1, -1] for _ in labels]
    for t, s in enumerate(path):
        if s % 2 == 1:
            span = spans[(s - 1) // 2]
            if span[0] < 0:
                span[0] = t
            span[1] = t + 1
    return [(a, b) for a, b in spans]
