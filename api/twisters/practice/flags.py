import hashlib

from ..models import FeatureFlag, Profile


def _bucket(code: str, profile_id) -> int:
    """Stable 0-99 bucket per (flag, user): raising rollout_pct only ever adds users."""
    return int(hashlib.sha256(f"{code}:{profile_id}".encode()).hexdigest()[:8], 16) % 100


def is_on(flag: FeatureFlag, profile: Profile | None) -> bool:
    if not flag.enabled:  # kill switch beats everything
        return False
    if profile is None:  # anonymous visitors only see fully rolled-out flags
        return flag.rollout_pct >= 100
    return str(profile.pk) in flag.allow_list or _bucket(flag.code, profile.pk) < flag.rollout_pct


def evaluate(profile: Profile | None) -> dict[str, bool]:
    return {f.code: is_on(f, profile) for f in FeatureFlag.objects.all()}


def enabled(code: str, profile: Profile | None) -> bool:
    """One flag by code; a flag that has not been created yet is off."""
    flag = FeatureFlag.objects.filter(code=code).first()
    return flag is not None and is_on(flag, profile)


def switched_on(code: str) -> bool:
    """Kill-switch state only, ignoring allow-list and rollout. For anonymous surfaces (public share
    pages) that must keep working for a link's audience whoever was allowed to create it."""
    return FeatureFlag.objects.filter(code=code, enabled=True).exists()
