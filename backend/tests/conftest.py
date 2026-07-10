"""Pytest fixtures — point the service at the live Phase 1 DuckDB."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture(scope="session")
def client():
    # Point at the project-level DuckDB built by Phase 1.
    duckdb_path = BACKEND_ROOT.parent / "output" / "trade_database.duckdb"
    if not duckdb_path.exists():
        pytest.skip(f"DuckDB not found at {duckdb_path} — run Phase 1 first")
    os.environ["EXIM_DUCKDB_PATH"] = str(duckdb_path)

    # Clear cached settings/DB so the env var actually takes effect.
    from app.config import get_settings
    from app.database.duckdb_client import reset_db_for_tests
    get_settings.cache_clear()
    reset_db_for_tests()

    from fastapi.testclient import TestClient
    from app.factory import create_app

    return TestClient(create_app())
