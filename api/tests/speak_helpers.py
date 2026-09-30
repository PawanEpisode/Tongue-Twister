"""Shared builders for the Speak & Score API tests."""

import datetime as dt
import uuid

from django.utils import timezone

SLUG = "she-sells-seashells"
TEXT = "She sells seashells by the seashore."
GOOD = "she sells seashells by the seashore"
SWAP = "she shells seashells by the seashore"


def attempt_body(**over):
    return {
        "client_attempt_id": str(uuid.uuid4()),
        "twister": SLUG,
        "transcript": GOOD,
        "duration_ms": 4000,
        **over,
    }


def submit(client, **over):
    return client.post("/api/v1/attempts/", attempt_body(**over), format="json")


def days_ago(n: float) -> str:
    return (timezone.now() - dt.timedelta(days=n)).isoformat()
