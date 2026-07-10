"""FastAPI dependencies."""

from __future__ import annotations

from fastapi import Depends

from app.config import Settings, get_settings
from app.database import DuckDBClient, get_db


def get_db_dep(settings: Settings = Depends(get_settings)) -> DuckDBClient:
    return get_db(settings)
