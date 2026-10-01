"""Score-card images (spec 15 S1.1): the PNG a shared score link unfurls to.

`render` is a pure function: a `ScoreCardPayload` and a size name in, PNG bytes out. No database, no
clock, no randomness, so the same inputs always give the same picture and `etag_for` can identify it
without rendering. The payload carries only what a stranger may see (score, speed, accuracy, the twister
text and, if the owner opted in, their public name); there is no avatar, no media and no e-mail to leak.

Everything is drawn at ``SUPERSAMPLE`` times the final size and scaled down, which anti-aliases the ring
and the text. Fonts are bundled (`twisters/assets/fonts`, licence beside them) because the serverless
host has none.
"""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import asdict, dataclass
from functools import cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Bump when the design changes so cached copies (and ETags) of the old picture are not reused.
RENDER_VERSION = 1
SUPERSAMPLE = 2
EXCERPT_MAX_CHARS = 120
ELLIPSIS = "…"
FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

BACKGROUND = (15, 23, 42)
PANEL = (30, 41, 59)
TRACK = (51, 65, 85)
TEXT = (241, 245, 249)
MUTED = (148, 163, 184)
BRAND = (250, 204, 21)
SCORE_COLOURS = (
    (90, (74, 222, 128)),
    (70, (250, 204, 21)),
    (0, (248, 113, 113)),
)  # (min score, RGB)


@dataclass(frozen=True)
class ScoreCardPayload:
    score: int
    accuracy: float  # 0..1
    wpm: float
    twister_text: str
    owner_name: str | None = None  # the opt-in public name only; None = anonymous


@dataclass(frozen=True)
class Layout:
    """Where things go, in final-size pixels."""

    width: int
    height: int
    ring_centre: tuple[int, int]
    ring_radius: int
    ring_thickness: int
    score_font: int
    text_origin: tuple[int, int]
    text_width: int
    text_font: int
    text_max_lines: int
    stats_origin: tuple[int, int]
    stats_gap: int
    owner_origin: tuple[int, int]
    centred: bool  # text and stats are centred on `*_origin[0]` rather than left-aligned there


LAYOUTS: dict[str, Layout] = {
    "og": Layout(
        width=1200,
        height=630,
        ring_centre=(250, 330),
        ring_radius=150,
        ring_thickness=30,
        score_font=118,
        text_origin=(480, 150),
        text_width=660,
        text_font=40,
        text_max_lines=5,
        stats_origin=(480, 470),
        stats_gap=200,
        owner_origin=(64, 570),
        centred=False,
    ),
    "square": Layout(
        width=1080,
        height=1080,
        ring_centre=(540, 330),
        ring_radius=180,
        ring_thickness=36,
        score_font=140,
        text_origin=(540, 570),
        text_width=880,
        text_font=42,
        text_max_lines=5,
        stats_origin=(540, 850),
        stats_gap=280,
        owner_origin=(540, 1010),
        centred=True,
    ),
}
SIZES = tuple(LAYOUTS)
DEFAULT_SIZE = "og"


@cache
def _font(bold: bool, size: int) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(str(FONT_DIR / name), size * SUPERSAMPLE)


def excerpt(text: str, limit: int = EXCERPT_MAX_CHARS) -> str:
    """Whitespace-normalised, at most ``limit`` characters including the ellipsis."""
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + ELLIPSIS


def _fit(text: str, font: ImageFont.FreeTypeFont, width: int) -> str:
    """Shorten ``text`` with an ellipsis until it is at most ``width`` final pixels wide."""
    limit = width * SUPERSAMPLE
    while text and font.getlength(text) > limit:
        text = text[:-2].rstrip() + ELLIPSIS if len(text) > 1 else ""
    return text


def wrap(text: str, font: ImageFont.FreeTypeFont, width: int, max_lines: int) -> list[str]:
    """Greedy word wrap to ``width`` final pixels. A word wider than a line is split by characters, and
    anything beyond ``max_lines`` is dropped with an ellipsis on the last line."""
    limit = width * SUPERSAMPLE
    lines: list[str] = []
    line = ""
    for word in text.split():
        while font.getlength(word) > limit:  # a single unbreakable monster of a word
            cut = max(
                1,
                next((i for i in range(len(word), 0, -1) if font.getlength(word[:i]) <= limit), 1),
            )
            if line:
                lines.append(line)
                line = ""
            lines.append(word[:cut])
            word = word[cut:]
        candidate = f"{line} {word}".strip()
        if font.getlength(candidate) <= limit:
            line = candidate
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = _fit(lines[-1] + ELLIPSIS, font, width)
    return lines


def _score_colour(score: int) -> tuple[int, int, int]:
    return next(colour for floor, colour in SCORE_COLOURS if score >= floor)


class _Canvas:
    """A drawing surface in final-size coordinates, backed by a supersampled image."""

    def __init__(self, width: int, height: int):
        self.image = Image.new("RGB", (width * SUPERSAMPLE, height * SUPERSAMPLE), BACKGROUND)
        self.draw = ImageDraw.Draw(self.image)

    @staticmethod
    def _s(value: float) -> int:
        return round(value * SUPERSAMPLE)

    def text(self, xy, text, font, fill, anchor="la"):
        self.draw.text((self._s(xy[0]), self._s(xy[1])), text, font=font, fill=fill, anchor=anchor)

    def ring(self, centre, radius, thickness, fraction, colour):
        box = [self._s(centre[0] - radius), self._s(centre[1] - radius)]
        box += [self._s(centre[0] + radius), self._s(centre[1] + radius)]
        self.draw.ellipse(box, outline=TRACK, width=self._s(thickness))
        if fraction > 0:
            self.draw.arc(box, -90, -90 + 360 * fraction, fill=colour, width=self._s(thickness))

    def rule(self, x0, y0, x1, y1, fill):
        self.draw.rectangle([self._s(x0), self._s(y0), self._s(x1), self._s(y1)], fill=fill)

    def png(self, width: int, height: int) -> bytes:
        small = self.image.resize((width, height), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        small.save(out, format="PNG")
        return out.getvalue()


def _stat(canvas: _Canvas, origin, value: str, label: str, anchor: str) -> None:
    canvas.text(origin, value, _font(True, 58), TEXT, anchor)
    canvas.text((origin[0], origin[1] + 74), label, _font(False, 26), MUTED, anchor)


def render(payload: ScoreCardPayload, size: str = DEFAULT_SIZE) -> bytes:
    """The score card as PNG bytes. ``size`` must be one of ``SIZES``."""
    layout = LAYOUTS[size]
    canvas = _Canvas(layout.width, layout.height)
    pad = 64

    canvas.rule(0, 0, layout.width, 10, BRAND)
    canvas.text((pad, 44), "Twister", _font(True, 44), BRAND)

    cx, cy = layout.ring_centre
    colour = _score_colour(payload.score)
    canvas.ring(
        layout.ring_centre, layout.ring_radius, layout.ring_thickness, payload.score / 100, colour
    )
    canvas.text((cx, cy - 6), str(payload.score), _font(True, layout.score_font), TEXT, "mm")
    canvas.text((cx, cy + layout.ring_radius * 0.55), "SCORE", _font(False, 24), MUTED, "mm")

    anchor = "ma" if layout.centred else "la"
    body_font = _font(False, layout.text_font)
    quote = f"“{excerpt(payload.twister_text)}”"
    x, y = layout.text_origin
    for line in wrap(quote, body_font, layout.text_width, layout.text_max_lines):
        canvas.text((x, y), line, body_font, TEXT, anchor)
        y += round(layout.text_font * 1.45)

    sx, sy = layout.stats_origin
    stats = (
        (f"{round(payload.accuracy * 100)}%", "accuracy"),
        (str(round(payload.wpm)), "words per minute"),
    )
    for index, (value, label) in enumerate(stats):
        offset = (
            (index - (len(stats) - 1) / 2) * layout.stats_gap
            if layout.centred
            else index * layout.stats_gap
        )
        _stat(canvas, (sx + offset, sy), value, label, anchor)

    if payload.owner_name:
        name = _fit(f"Shared by {payload.owner_name}", _font(False, 28), layout.text_width)
        canvas.text(
            layout.owner_origin, name, _font(False, 28), MUTED, "ma" if layout.centred else "la"
        )
    return canvas.png(layout.width, layout.height)


def etag_for(payload: ScoreCardPayload, size: str) -> str:
    """Strong validator for the picture ``render(payload, size)`` would produce, without rendering it."""
    material = json.dumps(
        [RENDER_VERSION, size, asdict(payload)], sort_keys=True, ensure_ascii=True
    )
    return f'"{hashlib.sha256(material.encode()).hexdigest()[:32]}"'
