"""DuckDB connection manager.

DuckDB connections are not thread-safe, but cursors are.  The recommended
pattern (per DuckDB docs) is to open one read-only connection at startup and
hand out ``connection.cursor()`` per request.  Each cursor inherits the
shared catalog/buffer pool and is safe to use concurrently.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Iterator

import duckdb

from app.config import Settings, get_settings

log = logging.getLogger(__name__)


class DuckDBClient:
    """Thin wrapper around the shared DuckDB connection.

    Use :meth:`cursor` for query execution — returns a thread-local cursor
    backed by the singleton connection.
    """

    def __init__(self, db_path: Path, read_only: bool = True) -> None:
        if not db_path.exists():
            raise FileNotFoundError(
                f"DuckDB file not found: {db_path}\n"
                "Run the Phase 1 pipeline (main.py at project root) first."
            )
        self.db_path = db_path
        self.read_only = read_only
        self._lock = threading.Lock()
        log.info("Opening DuckDB %s (read_only=%s)", db_path, read_only)
        self._conn = duckdb.connect(str(db_path), read_only=read_only)
        # Light-touch tuning — DuckDB auto-picks threads but make it explicit.
        try:
            self._conn.execute("PRAGMA enable_object_cache")
        except Exception:  # noqa: BLE001 — pragma not present on older versions
            pass

    def cursor(self) -> duckdb.DuckDBPyConnection:
        """Return a fresh cursor.  Cursors are cheap and thread-safe."""
        return self._conn.cursor()

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------
    # Convenience helpers used by the service layer
    # ------------------------------------------------------------------

    def fetch_all(self, sql: str, params: list | None = None) -> list[tuple]:
        cur = self.cursor()
        cur.execute(sql, params or [])
        return cur.fetchall()

    def fetch_one(self, sql: str, params: list | None = None) -> tuple | None:
        cur = self.cursor()
        cur.execute(sql, params or [])
        return cur.fetchone()

    def fetch_columns(self, sql: str, params: list | None = None) -> tuple[list[str], list[tuple]]:
        """Return (column_names, rows).  Used by row-to-dict helpers."""
        cur = self.cursor()
        cur.execute(sql, params or [])
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        return cols, rows


# ---------------------------------------------------------------------------
# Module-level singleton — created on first access.  Tests reset via
# ``reset_db_for_tests`` if they need a different DB path.
# ---------------------------------------------------------------------------

_db_singleton: DuckDBClient | None = None
_singleton_lock = threading.Lock()


def get_db(settings: Settings | None = None) -> DuckDBClient:
    """Return the process-wide :class:`DuckDBClient`."""
    global _db_singleton
    if _db_singleton is None:
        with _singleton_lock:
            if _db_singleton is None:
                s = settings or get_settings()
                _db_singleton = DuckDBClient(s.duckdb_path, read_only=s.read_only)
    return _db_singleton


def reset_db_for_tests() -> None:
    """Close + clear the singleton.  Test-only helper."""
    global _db_singleton
    with _singleton_lock:
        if _db_singleton is not None:
            _db_singleton.close()
        _db_singleton = None


def iter_dict_rows(cols: list[str], rows: list[tuple]) -> Iterator[dict]:
    """Convert raw DuckDB rows into dicts on the fly."""
    for r in rows:
        yield dict(zip(cols, r))
