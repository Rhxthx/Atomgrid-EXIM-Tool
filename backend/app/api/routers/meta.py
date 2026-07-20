"""Meta endpoints: root, health, dataset stats."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from app import __version__
from app.api.deps import get_db_dep
from app.auth.security import get_current_user
from app.database import DuckDBClient, iter_dict_rows
from app.models import TABLE, quote_ident
from app.schemas import DatasetStats
from app.utils import timer

log = logging.getLogger(__name__)

router = APIRouter(tags=["meta"])


@router.get("/", summary="API landing")
def root():
    """Returns a small index of useful endpoints."""
    return {
        "service": "EXIM Trade Intelligence API",
        "version": __version__,
        "docs": "/docs",
        "openapi": "/openapi.json",
        "endpoints": {
            "search":    ["/search", "/shipments", "/importer", "/exporter", "/supplier", "/hsn", "/country", "/product"],
            "analytics": ["/trends/monthly", "/top-importers", "/top-exporters", "/top-suppliers", "/top-buyers", "/country-analysis", "/hsn-analysis"],
            "advanced":  ["/suggest", "/similar", "/duplicates", "/keywords", "/supplier-concentration"],
            "meta":      ["/health", "/stats"],
        },
    }


@router.get("/health", summary="Liveness probe")
def health(db: DuckDBClient = Depends(get_db_dep)) -> dict:
    """Fast liveness probe — confirms DuckDB is openable and the table exists."""
    try:
        row = db.fetch_one(f"SELECT COUNT(*) FROM {TABLE}")
        rows = int(row[0]) if row else 0
        return {"status": "ok", "rows": rows}
    except Exception as e:  # noqa: BLE001
        log.error("Health check failed: %s", e)
        return {"status": "error", "detail": str(e)}


@router.get("/stats", response_model=DatasetStats, summary="Dataset summary")
def stats(
    db: DuckDBClient = Depends(get_db_dep),
    _user: dict = Depends(get_current_user),
) -> DatasetStats:
    """Single-query dataset overview — totals, distinct counts, date span,
    per-trade-type and per-HS-chapter row counts.
    """
    from app.config import get_settings
    settings = get_settings()
    with timer() as t:
        sql = (
            f"SELECT "
            f"  COUNT(*) AS total_rows, "
            f"  MIN({quote_ident('Date')}) AS date_min, "
            f"  MAX({quote_ident('Date')}) AS date_max, "
            f"  COUNT(DISTINCT {quote_ident('Importer')}) AS distinct_importers, "
            f"  COUNT(DISTINCT {quote_ident('Exporter')}) AS distinct_exporters, "
            f"  COUNT(DISTINCT {quote_ident('Supplier')}) AS distinct_suppliers, "
            f"  COUNT(DISTINCT {quote_ident('HSN')}) AS distinct_hsn, "
            f"  COUNT(DISTINCT COALESCE({quote_ident('Origin Country')}, "
            f"        {quote_ident('Destination Country')})) AS distinct_countries "
            f"FROM {TABLE}"
        )
        cols, rows = db.fetch_columns(sql)
        row = dict(zip(cols, rows[0])) if rows else {}

        trade_types: dict[str, int] = {}
        for tt, n in db.fetch_all(
            f"SELECT {quote_ident('Trade Type')}, COUNT(*) FROM {TABLE} GROUP BY 1"
        ):
            trade_types[tt or "unknown"] = int(n)

        hs_chapters: dict[str, int] = {}
        for chap, n in db.fetch_all(
            f"SELECT {quote_ident('HS Chapter')}, COUNT(*) FROM {TABLE} GROUP BY 1"
        ):
            hs_chapters[chap or "unknown"] = int(n)

        reporting_countries: dict[str, int] = {}
        market_coverage: dict[str, dict] = {}
        try:
            for rc, n, dmin, dmax in db.fetch_all(
                f"SELECT {quote_ident('Reporting Country')}, COUNT(*), "
                f"MIN({quote_ident('Date')}), MAX({quote_ident('Date')}) "
                f"FROM {TABLE} GROUP BY 1 ORDER BY 2 DESC"
            ):
                key = rc or "unknown"
                reporting_countries[key] = int(n)
                market_coverage[key] = {
                    "rows": int(n), "date_min": dmin, "date_max": dmax,
                }
        except Exception:  # noqa: BLE001 — column may be absent on older DBs
            pass

    return DatasetStats(
        total_rows=int(row.get("total_rows", 0)),
        date_min=row.get("date_min"),
        date_max=row.get("date_max"),
        distinct_importers=int(row.get("distinct_importers", 0)),
        distinct_exporters=int(row.get("distinct_exporters", 0)),
        distinct_suppliers=int(row.get("distinct_suppliers", 0)),
        distinct_hsn=int(row.get("distinct_hsn", 0)),
        distinct_countries=int(row.get("distinct_countries", 0)),
        trade_types=trade_types,
        hs_chapters=hs_chapters,
        reporting_countries=reporting_countries,
        market_coverage=market_coverage,
        user_export_cap=settings.user_export_cap,
        user_daily_exports=settings.user_daily_exports,
        duckdb_path=str(settings.duckdb_path),
        query_ms=t["ms"],
    )
