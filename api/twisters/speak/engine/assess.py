"""Whole-attempt assessment from a posterior matrix: two-pass alignment, tests, verdicts, score (doc 10 §4.4-4.9)."""

from collections.abc import Collection, Sequence

from ..scoring import compute
from .ctc import ctc_log_prob, forced_align
from .decode import edit_align, extra_runs, greedy_decode, word_windows
from .gop import features, substitution_tests
from .phones import confusables
from .types import (
    DELETED,
    EXTRA,
    FRAME_MS,
    MISSED,
    SUBSTITUTED,
    Assessment,
    PhonemeResult,
    Posteriors,
    ScoringProfile,
    Word,
    WordResult,
)
from .verdict import fuse, phoneme_verdict, word_status


def _unscorable(reason: str, words: Sequence[Word]) -> Assessment:
    results = [WordResult(i, w.text, MISSED, "", False, 0, 0, 0) for i, w in enumerate(words)]
    return Assessment(reason, results, 0, 0.0, 0.0, 0.0, 0, False, 0, 0)


def _usable(words: Sequence[Word], index: dict[str, int]) -> list[list[tuple[int, list[int]]]]:
    """Per word: ``(variant_index, label ids)`` for every variant whose phones the model can emit."""
    out = []
    for word in words:
        keep = [
            (v, [index[p] for p in variant])
            for v, variant in enumerate(word.variants)
            if variant and all(p in index for p in variant)
        ]
        if not keep:
            raise ValueError(f"no variant of {word.text!r} uses phones in the model vocabulary")
        out.append(keep)
    return out


def assess(
    post: Posteriors,
    words: Sequence[Word],
    focus: Collection[str] = (),
    profile: ScoringProfile | None = None,
    text_matches: Sequence[bool | None] | None = None,
    *,
    duration_ms: int | None = None,
    difficulty: int = 2,
) -> Assessment:
    profile = profile or ScoringProfile()
    logp = post.logp
    frames = post.frames
    if frames == 0 or not words:
        return _unscorable("no_speech", words)
    index = post.index()
    usable = _usable(words, index)

    blank_frames = 0
    for row in logp:
        best = 0
        for q in range(1, len(row)):
            if row[q] > row[best]:
                best = q
        blank_frames += best == 0
    segments = greedy_decode(logp)
    if not segments:
        return _unscorable("no_speech", words)
    if blank_frames / frames > profile.blank_ratio_max:
        return _unscorable("nothing_recognised", words)

    # Pass 1: free decode against the first variant of every word, then one window per word.
    flat: list[str] = []
    word_of: list[int] = []
    for w, word in enumerate(words):
        for phone in word.variants[usable[w][0][0]]:
            flat.append(phone)
            word_of.append(w)
    rows = edit_align(flat, [post.vocab[label] for label, _, _ in segments])
    windows = word_windows(rows, word_of, segments, len(words), frames, profile.pad_frames)
    if sum(w is not None for w in windows) / len(words) < profile.min_coverage:
        return _unscorable("could_not_follow", words)
    extras = extra_runs(rows, profile.extra_min_phones)

    # Pass 2: constrained Viterbi inside each window; the best variant wins (ties: the earlier one).
    chosen: list[tuple[int, list[int], list[tuple[int, int]]] | None] = []
    for w, window in enumerate(windows):
        pick = None
        if window is not None:
            piece = logp[window[0] : window[1]]
            best_score = None
            for v, labels in usable[w]:
                spans = forced_align(piece, labels)
                if spans is None:
                    continue
                score = ctc_log_prob(piece, labels)
                if best_score is None or score > best_score:
                    best_score = score
                    pick = (v, labels, [(a + window[0], b + window[0]) for a, b in spans])
        chosen.append(pick)

    sequence: list[int] = []
    offsets: dict[int, int] = {}
    for w, pick in enumerate(chosen):
        if pick is not None:
            offsets[w] = len(sequence)
            sequence.extend(pick[1])

    results: list[WordResult] = []
    for w, word in enumerate(words):
        pick = chosen[w]
        window = windows[w]
        if pick is None or window is None:
            results.append(WordResult(w, word.text, MISSED, "", False, 0, 0, 0))
            continue
        v, labels, spans = pick
        phones: list[PhonemeResult] = []
        for k, (label, span) in enumerate(zip(labels, spans, strict=True)):
            name = post.vocab[label]
            feat = features(logp, window, span, label, 0, profile.peak_radius)
            is_focus = name in focus
            heard = post.vocab[feat.heard]
            sub_delta = del_delta = None
            sub_label = None
            if is_focus or feat.peak_lp < profile.tau_weak or heard != name:
                cands = [index[q] for q in confusables(name, focus, post.vocab)]
                tests = substitution_tests(logp, sequence, offsets[w] + k, cands, 0)
                sub_delta, sub_label, del_delta = tests.sub_delta, tests.sub_label, tests.del_delta
            verdict, _ = phoneme_verdict(profile, feat.peak_lp, sub_delta, del_delta)
            if verdict == SUBSTITUTED and sub_label is not None:
                heard = post.vocab[sub_label]
            elif verdict == DELETED:
                heard = ""
            tested = [d for d in (sub_delta, del_delta) if d is not None]
            phones.append(
                PhonemeResult(
                    name,
                    heard,
                    verdict,
                    span[0],
                    span[1],
                    min(tested) if tested else None,
                    feat.lpp,
                    feat.lpr,
                    is_focus,
                )
            )
        status, reason, uncertain = word_status(phones)
        results.append(
            WordResult(
                w, word.text, status, reason, uncertain, v, spans[0][0], spans[-1][1], phones
            )
        )

    if text_matches is not None:
        for res in results:
            match = text_matches[res.index] if res.index < len(text_matches) else None
            res.status, res.reason = fuse(res.status, res.reason, res.uncertain, match)

    found = [r for r in results if r.status != MISSED]
    pause = 0
    for prev, nxt in zip(found, found[1:], strict=False):
        gap = (nxt.start - prev.end) * FRAME_MS
        if gap > profile.long_pause_ms:
            pause += gap
    if duration_ms is None:
        duration_ms = (found[-1].end - found[0].start) * FRAME_MS if found else 0
    statuses = [r.status for r in results] + [EXTRA] * extras
    reasons = [r.reason for r in results] + [""] * extras
    score = compute(
        statuses,
        reasons,
        target_words=len(words),
        spoken_words=len(found),
        duration_ms=duration_ms,
        long_pause_ms=min(pause, duration_ms),
        difficulty=difficulty,
    )
    return Assessment(
        None,
        results,
        extras,
        score.accuracy,
        score.speed,
        score.fluency,
        score.score,
        score.focus_gated,
        min(pause, duration_ms),
        duration_ms,
    )
