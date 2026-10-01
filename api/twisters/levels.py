"""XP -> level curve. The only place the formula lives, so swapping it for the softer
``200 * level ** 1.15`` (PRD 05 S1) touches nothing else. Deliberately free of model imports.
"""

XP_PER_LEVEL = 200


def level_for(xp: int) -> int:
    """Level 1 starts at 0 XP; every ``XP_PER_LEVEL`` adds one."""
    return 1 + xp // XP_PER_LEVEL


def level_floor(level: int) -> int:
    """XP at which ``level`` begins (inverse of ``level_for`` at the boundary)."""
    return (max(level, 1) - 1) * XP_PER_LEVEL


def level_progress(xp: int) -> tuple[int, int]:
    """``(xp earned inside the current level, xp the whole level is worth)`` for a progress bar."""
    level = level_for(xp)
    return xp - level_floor(level), level_floor(level + 1) - level_floor(level)
