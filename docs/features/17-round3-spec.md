# 17 - Round 3 build spec

Binding for agents. Sections are owned per agent; this file was started by A6.

## A6 — Speech engine groundwork (E3-2a / E3-2b), model-free

Owner: speech-core. Sources: `10` §3-§4, §9, §11; `09` E3-2a/E3-2b; `12` "Pending" item 5. Decisions D29-D31 in `11`.

### A6.1 Scope
Doc 10 defines the judge in terms of a CTC phoneme model. Everything that does not need weights, audio or a GPU is built here as **pure functions over a frame-posterior matrix** (`T x V` log-probabilities, `vocab[0]` = CTC blank), in Python (reference) and TypeScript (port), pinned by one shared vector file. **Not built** (needs a model or audio): label-map generation from `vocab.json` (E3-3), the ONNX runtime and Web Worker (E3-4), quality gates that need samples (SNR, clipping, sample rate), calibration of thresholds (E3-5), the worker container (E3-6). **Not wired**: no view, serializer, pipeline, flag or route imports the engine; Speak mode behaves exactly as before and `accurate_mode` stays off. Tests enforce that on both sides.

### A6.2 Files
| Python `api/twisters/speak/engine/` | TypeScript `web/src/lib/speak/engine/` | Content |
|---|---|---|
| `types.py` | `types.ts` | `Posteriors`, `Word`, `ScoringProfile` (thresholds), result dataclasses, verdict/status constants |
| `phones.py` | `phones.ts` | ARPAbet articulatory confusion map; `confusables(phone, focus, vocab)` (neighbours + focus sounds, sorted) |
| `ctc.py` | `ctc.ts` | `ctc_log_prob` (forward, log space), `forced_align` (Viterbi, half-open frame span per label) |
| `decode.py` | `decode.ts` | Pass 1: greedy free decode, phoneme edit alignment (earliest match wins), non-overlapping word windows, extra-speech runs |
| `gop.py` | `gop.ts` | LPP, LPR, peak log-prob, heard label; substitution test `delta(q)` and deletion test |
| `verdict.py` | `verdict.ts` | Phoneme verdicts, word status table (doc 10 §4.7), fusion with the text layer (§4.8) |
| `assess.py` | `assess.ts` | `assess(posteriors, words, focus, ...)` end to end; Score v2 via `twisters.speak.scoring.compute` (TS: `scoreStatuses`, same arithmetic) |
| `variants.py` | `variants.ts` | Interfaces `Pronouncer` (lexicon/G2P seam), `AcousticModel` (model seam); accent rules with protected contrasts; `expected_words(text, pronouncer, ...)` using the existing `tokenise`; unknown word blocks with `UnpronounceableWords` |
| `bench.py` | (none) | E3-2a synthetic-posterior bench: `realise` (words + edits: sub, del, blend, reduce, repeat_word, skip_word, pause, extra) and `synthesise` (deterministic, optional seeded noise) |

Tests: `api/tests/test_engine_units.py`, `api/tests/engine_vector_gen.py` (writes `api/tests/fixtures/engine_vectors.json`), `web/src/lib/speak/engine/engine.test.ts`.

### A6.3 Algorithm as built
1. Quality: no frames / no non-blank decode -> `no_speech`; blank-argmax share > 0.95 -> `nothing_recognised`; fewer than 50 % of words windowed -> `could_not_follow`. No score in those cases.
2. Pass 1: greedy decode -> edit-align (costs sub 10, gap 10; ties diagonal, then missed expected, then extra heard) against the first variant of every word -> one window per word (matched heard spans +- 7 frames, overlaps split at the midpoint). Insertion runs of >= 3 phones count as `extra` speech.
3. Pass 2: per window, every variant is force-aligned and scored with the CTC forward probability; the best wins, ties the earlier variant. A word whose window cannot hold any variant is `missed`.
4. Features for each phoneme from its span: peak frame +- 2 -> LPP, LPR, heard label; `peak_lp` = best target log-probability in the span.
5. Tests are run for focus phonemes, phonemes whose peak is below `tau_weak`, and phonemes where `heard != target`: `delta(q) = log P(y) - log P(y[i->q])` over the confusables (full sequence of the found words, so alignment errors cannot hide it) and the deletion delta.
6. Verdict: `substituted` (delta <= -tau_sub), `deleted` (<= -tau_del; the more negative wins, tie -> substituted), `uncertain` (<= -tau_uncertain), `weak` (peak_lp < tau_weak), else `ok`. Defaults 3.0 / 3.0 / 1.0 / -0.9 are placeholders.
7. Word: any focus substituted/deleted -> `wrong` + `focus_swap`; >= 2 non-focus errors -> `wrong`; 1 -> `near`; weak only -> `near` + `slurred`; uncertain never costs anything. Fusion: the text layer can only downgrade an uncertain `correct` to `near`/`uncertain` when it disagrees; it can never upgrade an acoustic error.
8. Score: Score v2 unchanged (credits, 0.7/0.2/0.1, focus gate 79), speaking duration from the first to the last found word, pauses > 700 ms between found words count against fluency.

### A6.4 Shared vectors and parity
`engine_vectors.json` holds: CTC cases (log-prob, spans), edit-align cases, window case, confusables, accent-rule and `expected_words` cases, and 20 assess cases (each stores its posterior matrix, 4 decimals, and the Python result). Python regenerates the file in a test (`test_fixture_is_current`), so it cannot drift from the reference; the TS suite requires identical statuses, reasons, verdicts, spans, score and counts, and floats (delta, LPP, LPR) within 2e-3. Independent of the vectors, the Python suite asserts behaviour (brute-force CTC, swap found, no false accusation on clean noisy reads, noise never turns a swap into `ok`, repeats, partial reads, silence).

### A6.5 Plugging a real model in later
Implement `AcousticModel` (E3-4: ONNX Runtime Web; E3-6: onnxruntime CPU), map labels with the generated `label_map.json` (E3-3) into the vocab the lexicon uses, supply a real `Pronouncer` (CMUdict + overrides via `twisters.speak.lexicon`), then call `assess`. Calibrate `ScoringProfile` on the gold set (E3-5) and store it as a `ScoringProfile` row.
