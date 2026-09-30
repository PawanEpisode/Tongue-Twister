"""Server-side scoring so leaderboards can't be trusted to the client."""

import re
from difflib import SequenceMatcher

_WORD = re.compile(r"[a-z0-9']+")

# Reference speaking speed (words/min) per difficulty for a full speed bonus.
REFERENCE_WPM = {1: 110, 2: 130, 3: 150, 4: 170}


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower().replace("’", "'"))


def accuracy(target: str, spoken: str) -> float:
    t, s = words(target), words(spoken)
    if not t or not s:
        return 0.0
    matched = sum(b.size for b in SequenceMatcher(a=t, b=s, autojunk=False).get_matching_blocks())
    # Penalise extra words a little so rambling doesn't score perfect.
    extra = max(0, len(s) - len(t))
    return max(0.0, min(1.0, (matched - 0.25 * extra) / len(t)))


def attempt_xp(score: int, difficulty: int, accuracy: float) -> int:
    return round(score / 4) + difficulty * 3 + (10 if accuracy >= 0.98 else 0)


def compute(target: str, spoken: str, duration_ms: int, difficulty: int) -> dict:
    acc = accuracy(target, spoken)
    minutes = max(duration_ms, 500) / 60000
    wpm = len(words(spoken)) / minutes
    speed = min(1.0, wpm / REFERENCE_WPM.get(difficulty, 130)) if acc >= 0.6 else 0.0
    score = round(acc * 70 + speed * 30)
    return {
        "accuracy": round(acc, 4),
        "wpm": round(wpm, 1),
        "score": score,
        "xp": attempt_xp(score, difficulty, acc),
    }
