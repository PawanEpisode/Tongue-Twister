import json
import logging

from twister_worker.logging_setup import JsonFormatter, log


def test_json_lines_have_event_and_fields():
    record = logging.getLogger("t").makeRecord(
        "t", logging.INFO, "f", 1, "job_started", (), None, extra={"fields": {"job_id": "j"}}
    )
    out = json.loads(JsonFormatter().format(record))
    assert out["event"] == "job_started" and out["job_id"] == "j" and out["level"] == "info"


def test_exception_logs_type_only():
    try:
        raise ValueError("https://secret.example/?token=abc")
    except ValueError:
        import sys

        record = logging.getLogger("t").makeRecord(
            "t", logging.ERROR, "f", 1, "boom", (), sys.exc_info()
        )
    text = JsonFormatter().format(record)
    assert "ValueError" in text and "secret.example" not in text


def test_log_helper(caplog):
    with caplog.at_level(logging.INFO):
        log(logging.getLogger("x"), logging.INFO, "hello", n=1)
    assert caplog.records[0].fields == {"n": 1}
