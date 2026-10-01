"""A deterministic generator for development, tests and any environment without a Gemini key (D24).

It never calls a network. The same topic and level always give the same twister, picked from a small
bank written for this purpose (every word is in the pronunciation lexicon, and a test keeps it that way).
"""

import hashlib

from ..models import Difficulty
from .drafts import Draft

# (difficulty, text, focus sounds)
BANK: tuple[tuple[int, str, list[str]], ...] = (
    (Difficulty.EASY, "Six slick snakes slid slowly by the sea.", ["s"]),
    (Difficulty.EASY, "Big blue bugs bounced by the brown barn.", ["b"]),
    (Difficulty.EASY, "Fresh fish fry fast on Friday for five fine friends.", ["f"]),
    (Difficulty.MEDIUM, "She sells silver shells beside the shiny shore.", ["s", "sh"]),
    (
        Difficulty.MEDIUM,
        "Three thin thieves thought thirty thick thoughts, then threw three thistles.",
        ["th"],
    ),
    (
        Difficulty.MEDIUM,
        "Red lorries roll round rural roads regularly, rattling rusty railway rails.",
        ["r", "l"],
    ),
    (Difficulty.HARD, "Cheerful children chew crunchy cheese chips in chilly churches.", ["ch"]),
    (Difficulty.HARD, "Quick quiet quails quarrel quietly over questionable quilts.", ["q"]),
    (Difficulty.HARD, "Whistling wizards wash warm woolly witches' watches weekly.", ["w"]),
    (
        Difficulty.INSANE,
        "Truly rural brave brothers bravely rolled the crooked red lorry through rough rain.",
        ["r"],
    ),
    (
        Difficulty.INSANE,
        "Sixth sick sheikhs' sixth sheep sheds thick thistles slowly, stressing sleepy shepherds.",
        ["s", "sh", "th"],
    ),
    (
        Difficulty.INSANE,
        "Unique New York sailors sell several sleek yellow yachts to nervous shy seamen.",
        ["s", "y"],
    ),
)
TIP = "Say it slowly first, then speed up once the repeated sounds feel smooth."


class FakeGenerator:
    def generate(
        self, topic: str, difficulty: int, language: str, words: int | None = None
    ) -> Draft:
        # Canned lines for tests and machines with no key. Language and length are accepted so the
        # call matches the real generator; they do not change which line is picked.
        del language, words
        level = [row for row in BANK if row[0] == difficulty] or list(BANK)
        digest = hashlib.sha256(f"{topic.casefold()}|{difficulty}".encode()).digest()
        _, text, sounds = level[digest[0] % len(level)]
        return Draft(text=text, tip=TIP, focus_sounds=list(sounds))
