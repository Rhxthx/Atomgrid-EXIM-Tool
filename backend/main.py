"""Uvicorn entry point.

    python -m uvicorn main:app --reload --port 8000

or run this file directly:

    python main.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Make ``app.*`` importable when running this file directly.
BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.factory import create_app

app = create_app()


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("EXIM_HOST", "127.0.0.1")
    port = int(os.environ.get("EXIM_PORT", "8000"))
    reload = os.environ.get("EXIM_RELOAD", "false").lower() in {"1", "true", "yes"}
    uvicorn.run("main:app", host=host, port=port, reload=reload)
