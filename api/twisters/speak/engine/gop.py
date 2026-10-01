"""GOP-style features and the alignment-free substitution / deletion tests (doc 10 §4.5)."""

from dataclasses import dataclass

from .ctc import NEG_INF, ctc_log_prob


@dataclass(frozen=True)
class Features:
    lpp: float  # mean log p(target) over the peak +- radius frames
    lpr: float  # lpp minus the mean of the best competing non-blank class
    peak_lp: (
        float  # best log p(target) inside the aligned span (CTC is peaky: durations are not used)
    )
    heard: int  # highest non-blank class over those frames


def features(
    logp: list[list[float]],
    window: tuple[int, int],
    span: tuple[int, int],
    label: int,
    blank: int,
    radius: int,
) -> Features:
    peak = span[0]
    for t in range(span[0], span[1]):
        if logp[t][label] > logp[peak][label]:
            peak = t
    start = max(window[0], peak - radius)
    end = min(window[1], peak + radius + 1)
    count = end - start
    vocab_size = len(logp[0])
    target_sum = 0.0
    rival_sum = 0.0
    class_sum = [0.0] * vocab_size
    for t in range(start, end):
        row = logp[t]
        target_sum += row[label]
        rival = NEG_INF
        for q in range(vocab_size):
            if q == blank:
                continue
            class_sum[q] += row[q]
            if q != label and row[q] > rival:
                rival = row[q]
        rival_sum += rival
    lpp = target_sum / count
    heard = -1
    for q in range(vocab_size):
        if q != blank and (heard < 0 or class_sum[q] > class_sum[heard]):
            heard = q
    return Features(lpp, lpp - rival_sum / count, logp[peak][label], heard)


@dataclass(frozen=True)
class Tests:
    base: float
    sub_delta: float | None  # most negative delta over the confusables
    sub_label: int | None
    del_delta: float | None


def substitution_tests(
    logp: list[list[float]], sequence: list[int], position: int, candidates: list[int], blank: int
) -> Tests:
    """delta(q) = log P(y|X) - log P(y[i->q]|X); strongly negative means the audio fits q better than y."""
    base = ctc_log_prob(logp, sequence, blank)
    best: float | None = None
    best_label: int | None = None
    for q in candidates:
        swapped = [*sequence[:position], q, *sequence[position + 1 :]]
        delta = base - ctc_log_prob(logp, swapped, blank)
        if best is None or delta < best:
            best, best_label = delta, q
    deletion: float | None = None
    if len(sequence) > 1:
        deletion = base - ctc_log_prob(
            logp, [*sequence[:position], *sequence[position + 1 :]], blank
        )
    return Tests(base, best, best_label, deletion)
