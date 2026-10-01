"""Data shapes shared by the engine modules (mirrored in ``web/src/lib/speak/engine/types.ts``)."""

from dataclasses import dataclass, field

BLANK = "<b>"
FRAME_MS = 20

# Phoneme verdicts (match ``twisters.models.PhonemeVerdict`` values; a test pins that).
OK = "ok"
WEAK = "weak"
SUBSTITUTED = "substituted"
DELETED = "deleted"
UNCERTAIN = "uncertain"

# Word statuses and reasons (match ``WordStatus`` / ``WordReason``).
CORRECT = "correct"
NEAR = "near"
WRONG = "wrong"
MISSED = "missed"
EXTRA = "extra"
FOCUS_SWAP = "focus_swap"
SLURRED = "slurred"


@dataclass(frozen=True)
class Posteriors:
    """Log-probabilities per frame (T x V). ``vocab[0]`` is the CTC blank; rows need not sum to one."""

    vocab: tuple[str, ...]
    logp: list[list[float]]

    @property
    def frames(self) -> int:
        return len(self.logp)

    def index(self) -> dict[str, int]:
        return {label: i for i, label in enumerate(self.vocab)}


@dataclass(frozen=True)
class Word:
    """An expected word: its normalised spelling and its accepted pronunciations (ARPAbet, no stress)."""

    text: str
    variants: list[list[str]]


@dataclass(frozen=True)
class ScoringProfile:
    """Thresholds. Placeholders until the gold set calibrates them (E3-5); precision first (doc 10 §4.6)."""

    name: str = "sp-default-0"
    tau_sub: float = 3.0  # substituted when delta <= -tau_sub
    tau_del: float = 3.0
    tau_uncertain: float = 1.0  # abstention band: -tau_sub < delta <= -tau_uncertain
    tau_weak: float = -0.9  # peak log-probability of the target below this = slurred
    pad_frames: int = 7  # +-150 ms word window padding
    peak_radius: int = 2
    min_coverage: float = 0.5
    extra_min_phones: int = 3
    blank_ratio_max: float = 0.95
    long_pause_ms: int = 700


@dataclass
class PhonemeResult:
    target: str
    heard: str
    verdict: str
    start: int  # frames, half open
    end: int
    delta: float | None
    lpp: float
    lpr: float
    focus: bool


@dataclass
class WordResult:
    index: int
    text: str
    status: str
    reason: str
    uncertain: bool
    variant: int
    start: int
    end: int
    phonemes: list[PhonemeResult] = field(default_factory=list)


@dataclass
class Assessment:
    unscorable: str | None
    words: list[WordResult]
    extras: int
    accuracy: float
    speed: float
    fluency: float
    score: int
    focus_gated: bool
    long_pause_ms: int
    duration_ms: int
