# Build from the worker/ directory:  docker build -t twister-worker worker/
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --create-home worker

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
# Readable by the non-root user whatever the checkout's file modes are (a 0600 file on the build host
# would otherwise fail at import with PermissionError).
COPY --chown=worker:worker --chmod=a+rX twister_worker ./twister_worker

USER worker

# The runner touches this file on every loop tick and job heartbeat; the healthcheck reads its age.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-m", "twister_worker.health"]

CMD ["python", "-m", "twister_worker"]
