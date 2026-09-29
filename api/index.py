# Vercel serverless entrypoint (Python runtime looks for `app`).
from config.wsgi import application as app  # noqa: F401
