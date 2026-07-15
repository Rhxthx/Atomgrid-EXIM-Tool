"""Centralised WHERE-clause builder + paginated shipment listing.

Every search/filter endpoint calls into here so the SQL is generated in
exactly one place.  All user input is parameterised — no string formatting
of values into the SQL.
"""

from __future__ import annotations

import logging
from typing import Any

from app.database import DuckDBClient, iter_dict_rows
from app.models import (
    PARTY_COLUMNS,
    SEARCHABLE_TEXT_COLUMNS,
    SHIPMENT_COLUMNS,
    SORTABLE_COLUMNS,
    TABLE,
    quote_ident,
)
from app.schemas.filters import FilterParams
from app.utils import timer

log = logging.getLogger(__name__)


# Detected once at startup — if the optional _search column exists (created
# by scripts/add_search_column.py) we route free-text 'q' through it instead
# of OR-ing across 6 columns.  ~3-5x faster in practice.
_search_column_present: bool | None = None


def _has_search_column(db: DuckDBClient) -> bool:
    global _search_column_present
    if _search_column_present is not None:
        return _search_column_present
    try:
        rows = db.fetch_all(f"PRAGMA table_info({TABLE})")
        _search_column_present = any(r[1] == "_search" for r in rows)
    except Exception:  # noqa: BLE001
        _search_column_present = False
    if _search_column_present:
        log.info("Fast-path enabled: _search column found")
    else:
        log.info(
            "Slow-path: _search column missing — run "
            "`python -m scripts.add_search_column` for a ~3-5x speedup"
        )
    return _search_column_present


# ---------------------------------------------------------------------------
# WHERE-clause builder
# ---------------------------------------------------------------------------

def build_where(
    f: FilterParams,
    *,
    use_search_column: bool = False,
) -> tuple[str, list[Any], dict[str, Any]]:
    """Return ``(where_sql, params, filters_applied)``.

    ``where_sql`` starts with ``WHERE`` and is empty when no filters set.
    ``filters_applied`` is a dict suitable for putting in the response Meta.

    When ``use_search_column`` is True and a free-text 'q' is set, the
    query targets the precomputed lowercase ``_search`` column (one column
    scan) instead of OR-ing across 6 source columns.  Caller is responsible
    for confirming the column exists.
    """
    clauses: list[str] = []
    params: list[Any] = []
    applied: dict[str, Any] = {}

    # ----- free-text 'q' ---------------------------------------------------
    if f.q:
        applied["q"] = f.q
        if use_search_column:
            clauses.append("_search LIKE ?")
            params.append(f"%{f.q.lower()}%")
        else:
            q_pattern = f"%{f.q}%"
            sub = []
            for col in SEARCHABLE_TEXT_COLUMNS:
                sub.append(f"{quote_ident(col)} ILIKE ?")
                params.append(q_pattern)
            clauses.append("(" + " OR ".join(sub) + ")")

    # ----- party substring filters -----------------------------------------
    for fname, col in (
        ("importer", "Importer"),
        ("exporter", "Exporter"),
        ("supplier", "Supplier"),
        ("buyer", "Buyer"),
        ("port", "Port"),
    ):
        v: str | None = getattr(f, fname)
        if v:
            applied[fname] = v
            clauses.append(f"{quote_ident(col)} ILIKE ?")
            params.append(f"%{v}%")

    # ----- HSN — prefix match ----------------------------------------------
    if f.hsn:
        applied["hsn"] = f.hsn
        clauses.append(f"{quote_ident('HSN')} ILIKE ?")
        params.append(f"{f.hsn}%")

    if f.hs_chapter:
        applied["hs_chapter"] = f.hs_chapter
        clauses.append(f"{quote_ident('HS Chapter')} = ?")
        params.append(f.hs_chapter)

    # ----- countries -------------------------------------------------------
    if f.country:
        applied["country"] = f.country
        clauses.append(
            f"({quote_ident('Origin Country')} ILIKE ? "
            f"OR {quote_ident('Destination Country')} ILIKE ? "
            f"OR {quote_ident('Country')} ILIKE ?)"
        )
        params.extend([f"%{f.country}%"] * 3)

    if f.origin_country:
        applied["origin_country"] = f.origin_country
        clauses.append(f"{quote_ident('Origin Country')} ILIKE ?")
        params.append(f"%{f.origin_country}%")

    if f.destination_country:
        applied["destination_country"] = f.destination_country
        clauses.append(f"{quote_ident('Destination Country')} ILIKE ?")
        params.append(f"%{f.destination_country}%")

    # ----- trade type ------------------------------------------------------
    if f.trade_type:
        applied["trade_type"] = f.trade_type.value
        clauses.append(f"{quote_ident('Trade Type')} = ?")
        params.append(f.trade_type.value)

    # ----- reporting country (customs feed) --------------------------------
    if f.reporting_country:
        applied["reporting_country"] = f.reporting_country
        clauses.append(f"{quote_ident('Reporting Country')} = ?")
        params.append(f.reporting_country.upper())

    # ----- date range ------------------------------------------------------
    if f.date_from:
        applied["date_from"] = f.date_from.isoformat()
        clauses.append(f"{quote_ident('Date')} >= ?")
        params.append(f.date_from)
    if f.date_to:
        applied["date_to"] = f.date_to.isoformat()
        clauses.append(f"{quote_ident('Date')} <= ?")
        params.append(f.date_to)

    # ----- numeric ranges --------------------------------------------------
    for fname, col, op in (
        ("min_value", "Value", ">="),
        ("max_value", "Value", "<="),
        ("min_quantity", "Quantity", ">="),
        ("max_quantity", "Quantity", "<="),
    ):
        v = getattr(f, fname)
        if v is not None:
            applied[fname] = v
            clauses.append(f"{quote_ident(col)} {op} ?")
            params.append(v)

    where_sql = ""
    if clauses:
        where_sql = "WHERE " + " AND ".join(clauses)
    return where_sql, params, applied


def _order_by_clause(f: FilterParams) -> str:
    """Whitelisted ORDER BY.  Default ordering is Date DESC for recency."""
    col = f.sort_by if f.sort_by in SORTABLE_COLUMNS else "Date"
    direction = "ASC" if f.sort_order.value == "asc" else "DESC"
    # NULLS LAST on DESC keeps the "no date" rows out of the way; consistent
    # across DuckDB versions.
    return f"ORDER BY {quote_ident(col)} {direction} NULLS LAST"


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------

ALL_COLS_SQL = ", ".join(quote_ident(c) for c in SHIPMENT_COLUMNS)


def count_shipments(db: DuckDBClient, f: FilterParams) -> int:
    where, params, _ = build_where(f, use_search_column=_has_search_column(db))
    sql = f"SELECT COUNT(*) FROM {TABLE} {where}"
    row = db.fetch_one(sql, params)
    return int(row[0]) if row else 0


def list_shipments(
    db: DuckDBClient,
    f: FilterParams,
) -> tuple[list[dict], int, float, dict]:
    """Return ``(rows, total, query_ms, filters_applied)``.

    Two SQL passes — one COUNT(*), one paginated SELECT.  Counter-intuitively
    this beats a single ``COUNT(*) OVER ()`` window query on DuckDB: the
    window form forces materialisation of every matching row's full string
    columns before LIMIT, whereas the standalone COUNT only touches row
    addresses.  Measured: ~2x slower with the window form on a 6-column
    ILIKE-OR over 672k rows.
    """
    with timer() as t:
        where, params, applied = build_where(f, use_search_column=_has_search_column(db))

        total_sql = f"SELECT COUNT(*) FROM {TABLE} {where}"
        row = db.fetch_one(total_sql, params)
        total = int(row[0]) if row else 0

        if total == 0:
            return [], 0, t["ms"], applied

        order_by = _order_by_clause(f)
        offset = (f.page - 1) * f.page_size
        sql = (
            f"SELECT {ALL_COLS_SQL} FROM {TABLE} {where} "
            f"{order_by} LIMIT {int(f.page_size)} OFFSET {int(offset)}"
        )
        cols, rows = db.fetch_columns(sql, params)
        data = list(iter_dict_rows(cols, rows))

    return data, total, t["ms"], applied


def aggregate_shipments(db: DuckDBClient, f: FilterParams) -> dict:
    """Totals over ALL rows matching the filters — not just one page.

    Returns shipment count, summed Quantity and Value, and the mean per-unit
    USD price. Uses the same WHERE builder as the paginated search so the
    numbers reflect exactly what the user searched. ``Quantity``/``Value``/
    ``Unit Price USD`` are stored as DOUBLE; SQL ``AVG`` ignores NULLs, so the
    average is over rows that actually have a unit price.
    """
    with timer() as t:
        where, params, _ = build_where(f, use_search_column=_has_search_column(db))
        sql = (
            f"SELECT COUNT(*) AS count, "
            f"SUM({quote_ident('Quantity')}) AS total_quantity, "
            f"SUM({quote_ident('Value')}) AS total_value, "
            f"AVG({quote_ident('Unit Price USD')}) AS avg_unit_price_usd "
            f"FROM {TABLE} {where}"
        )
        row = db.fetch_one(sql, params)

    def _num(v) -> float | None:
        return float(v) if v is not None else None

    return {
        "count": int(row[0]) if row and row[0] is not None else 0,
        "total_quantity": _num(row[1]) if row else None,
        "total_value": _num(row[2]) if row else None,
        "avg_unit_price_usd": _num(row[3]) if row else None,
        "query_ms": t["ms"],
    }


# Safety cap so an unfiltered export can't exhaust memory / exceed Excel's
# ~1,048,576-row sheet limit. Filtered searches are almost always far below.
EXPORT_ROW_CAP = 1_000_000


def export_shipments_csv(db: DuckDBClient, f: FilterParams, *, row_cap: int = EXPORT_ROW_CAP):
    """Stream rows matching the current filters as CSV (not just one page).

    Uses the same WHERE builder as the paginated search, so the export reflects
    exactly what the user searched. Rows are fetched in batches and written
    incrementally, so even large exports stay memory-safe.

    ``row_cap`` bounds how many rows are written — admins get the full
    ``EXPORT_ROW_CAP``; non-admins are limited to a small per-role cap set by
    the caller.
    """
    import csv
    import io

    where, params, _ = build_where(f, use_search_column=_has_search_column(db))
    order_by = _order_by_clause(f)
    sql = (
        f"SELECT {ALL_COLS_SQL} FROM {TABLE} {where} "
        f"{order_by} LIMIT {int(row_cap)}"
    )
    cur = db.cursor()
    cur.execute(sql, params)
    header = [d[0] for d in cur.description]

    def _drain(buf) -> str:
        s = buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        return s

    def _rows():
        buf = io.StringIO()
        writer = csv.writer(buf)
        yield "﻿"                    # BOM so Excel reads UTF-8 correctly
        writer.writerow(header)
        yield _drain(buf)
        while True:
            batch = cur.fetchmany(10_000)
            if not batch:
                break
            for row in batch:
                writer.writerow(["" if v is None else v for v in row])
            yield _drain(buf)

    return _rows()
