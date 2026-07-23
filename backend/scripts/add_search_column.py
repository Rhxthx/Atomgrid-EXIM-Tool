"""One-shot migration: add a precomputed lowercase ``_search`` column.

Why:
    The /search endpoint OR's an ILIKE across 6 string columns (Importer,
    Exporter, Supplier, Buyer, Product Description, HSN).  DuckDB has no
    LIKE-aware index so this is always a full scan, and at 672k rows it
    costs ~1.2s.  Concatenating those 6 columns into one lowercase column
    and ILIKE-ing only that one column cuts the work to a single column
    scan — measured ~3-5x faster in practice.

Run once after Phase 1's main.py finishes building output/trade_database.duckdb:

    python -m scripts.add_search_column

The script is idempotent — it skips if ``_search`` already exists.
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

import duckdb

# Make ``app.*`` importable when running this file directly.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import get_settings  # noqa: E402
from app.models import TABLE  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


SEARCH_SOURCE_COLS = (
    "Importer",
    "Exporter",
    "Supplier",
    "Buyer",
    "Product Description",
    "HSN",
)


def main() -> int:
    settings = get_settings()
    db_path = settings.duckdb_path
    if not db_path.exists():
        log.error("DuckDB not found at %s", db_path)
        return 1

    log.info("Opening %s read-write", db_path)
    con = duckdb.connect(str(db_path), read_only=False)
    try:
        existing = {r[1] for r in con.execute(f"PRAGMA table_info({TABLE})").fetchall()}

        # --- _search: lowercased concat of the searchable columns ----------
        if "_search" in existing:
            log.info("_search column already present — skipping.")
        else:
            log.info("Adding _search column")
            con.execute(f'ALTER TABLE {TABLE} ADD COLUMN _search VARCHAR')
            # concat_ws skips NULLs cleanly so sparse rows get no stray separators.
            concat_expr = "lower(concat_ws(' | ', " + ", ".join(
                f'"{c}"' for c in SEARCH_SOURCE_COLS
            ) + "))"
            log.info("Populating _search (scans the full table once)")
            t0 = time.perf_counter()
            con.execute(f"UPDATE {TABLE} SET _search = {concat_expr}")
            log.info("  populated in %.1fs", time.perf_counter() - t0)

        # --- _pd_search: Product Description, lowercased with ALL punctuation
        # and spaces stripped, so a punctuation-insensitive product search
        # ("2,4-D" = "24D" = "2,4 d") is a single fast column scan (same shape
        # as _search — no query-time penalty). --------------------------------
        if "_pd_search" in existing:
            log.info("_pd_search column already present — skipping.")
        else:
            log.info("Adding _pd_search column")
            con.execute(f'ALTER TABLE {TABLE} ADD COLUMN _pd_search VARCHAR')
            log.info("Populating _pd_search (scans the full table once)")
            t0 = time.perf_counter()
            con.execute(
                f"UPDATE {TABLE} SET _pd_search = "
                f"nullif(regexp_replace(lower(coalesce(\"Product Description\", '')), "
                f"'[^a-z0-9]', '', 'g'), '')"
            )
            log.info("  populated in %.1fs", time.perf_counter() - t0)

        n, s_nn, pd_nn = con.execute(
            f"SELECT COUNT(*), COUNT(_search), COUNT(_pd_search) FROM {TABLE}"
        ).fetchone()
        log.info("Total rows: %s · _search: %s · _pd_search: %s",
                 f"{n:,}", f"{s_nn:,}", f"{pd_nn:,}")

        return 0
    finally:
        con.close()


if __name__ == "__main__":
    sys.exit(main())
