"""Vercel serverless entry point.

Wraps the FastAPI app with Mangum so Vercel's Python runtime can call it as an
ASGI handler. All /api/* requests are rewritten here by vercel.json.
"""
import sys
from pathlib import Path

# Ensure the backend package is importable from the project root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402  (import after sys.path mutation)
from mangum import Mangum  # noqa: E402

handler = Mangum(app, lifespan="off")
