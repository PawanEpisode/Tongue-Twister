"""Production installs only `requirements.txt` (Vercel). Anything imported at request time must be listed there,
not only in `requirements-dev.txt`, or the first request that needs it fails with a 500 in production."""

from pathlib import Path

API = Path(__file__).resolve().parent.parent
RUNTIME_IMPORTS = {"cmudict": "pronunciations (speak v2, spot checks, record scoring)"}


def names(path: Path) -> set[str]:
    out = set()
    for line in path.read_text().splitlines():
        line = line.split("#")[0].strip()
        if line and not line.startswith("-"):
            out.add(line.split("[")[0].split(">")[0].split("=")[0].split("<")[0].strip().lower())
    return out


def test_request_time_dependencies_are_in_the_production_requirements():
    missing = sorted(set(RUNTIME_IMPORTS) - names(API / "requirements.txt"))
    assert missing == [], (
        f"add to api/requirements.txt: {[(m, RUNTIME_IMPORTS[m]) for m in missing]}"
    )
