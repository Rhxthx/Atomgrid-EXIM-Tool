"""Analytical aggregations: top entities, monthly trends, country/HSN analysis.

All functions share the WHERE-clause builder from :mod:`app.services.search`
so the same filter set works everywhere.
"""

from __future__ import annotations

import logging
from typing import Any

from app.database import DuckDBClient, iter_dict_rows
from app.models import PARTY_COLUMNS, TABLE, quote_ident
from app.schemas.filters import FilterParams
from app.utils import timer

from .search import build_where

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Top entities (importers / exporters / suppliers / buyers)
# ---------------------------------------------------------------------------

def top_entities(
    db: DuckDBClient,
    *,
    entity: str,
    f: FilterParams,
    limit: int = 25,
) -> tuple[list[dict], int, float, dict]:
    """Return top-N entities by total declared value.

    ``entity`` must be one of the party columns (Importer/Exporter/Supplier/
    Buyer); validated by the router before calling here.
    """
    if entity not in PARTY_COLUMNS:
        raise ValueError(f"Unsupported entity '{entity}'")

    with timer() as t:
        where, params, applied = build_where(f)
        # Exclude null entities from the ranking — they're rows whose party
        # column genuinely wasn't present in the source file.
        non_null_clause = f"{quote_ident(entity)} IS NOT NULL"
        full_where = f"{where} AND {non_null_clause}" if where else f"WHERE {non_null_clause}"

        # COUNT(DISTINCT entity) gives the universe size for response metadata.
        total_sql = (
            f"SELECT COUNT(DISTINCT {quote_ident(entity)}) "
            f"FROM {TABLE} {full_where}"
        )
        total_row = db.fetch_one(total_sql, params)
        total = int(total_row[0]) if total_row else 0

        sql = (
            f"SELECT {quote_ident(entity)} AS name, "
            f"       COUNT(*) AS shipments, "
            f"       SUM({quote_ident('Value')}) AS total_value, "
            f"       SUM({quote_ident('Quantity')}) AS total_quantity "
            f"FROM {TABLE} {full_where} "
            f"GROUP BY {quote_ident(entity)} "
            f"ORDER BY total_value DESC NULLS LAST "
            f"LIMIT {int(limit)}"
        )
        cols, rows = db.fetch_columns(sql, params)
        data = list(iter_dict_rows(cols, rows))

    return data, total, t["ms"], applied


# ---------------------------------------------------------------------------
# Monthly trends
# ---------------------------------------------------------------------------

def monthly_trend(
    db: DuckDBClient,
    f: FilterParams,
    *,
    group_by: list[str] | None = None,
) -> tuple[list[dict], float, dict]:
    """Aggregate shipments by month with optional secondary grouping.

    ``group_by`` may contain any subset of ``["Trade Type", "HS Chapter"]``.
    """
    group_by = group_by or []
    safe_group: list[str] = []
    for g in group_by:
        if g in {"Trade Type", "HS Chapter", "Origin Country", "Destination Country"}:
            safe_group.append(g)

    with timer() as t:
        where, params, applied = build_where(f)
        # Drop rows with NULL Date — they'd collapse into one nonsensical bucket.
        date_filter = f"{quote_ident('Date')} IS NOT NULL"
        full_where = f"{where} AND {date_filter}" if where else f"WHERE {date_filter}"

        select_extra = ""
        group_extra = ""
        if safe_group:
            cols_sql = ", ".join(quote_ident(c) for c in safe_group)
            select_extra = ", " + cols_sql
            group_extra = ", " + cols_sql

        sql = (
            f"SELECT DATE_TRUNC('month', {quote_ident('Date')})::DATE AS month"
            f"{select_extra}, "
            f"       COUNT(*) AS shipments, "
            f"       SUM({quote_ident('Value')}) AS total_value, "
            f"       SUM({quote_ident('Quantity')}) AS total_quantity "
            f"FROM {TABLE} {full_where} "
            f"GROUP BY month{group_extra} "
            f"ORDER BY month{group_extra}"
        )
        cols, rows = db.fetch_columns(sql, params)
        data = list(iter_dict_rows(cols, rows))

    return data, t["ms"], applied


# ---------------------------------------------------------------------------
# Country analysis
# ---------------------------------------------------------------------------

def country_analysis(
    db: DuckDBClient,
    f: FilterParams,
    *,
    limit: int = 50,
) -> tuple[list[dict], int, float, dict]:
    """Aggregate by COALESCE(Origin, Destination) country × trade type.

    This is the canonical "counterparty country" view: for imports the
    counterparty is the origin country; for exports it's the destination.
    """
    with timer() as t:
        where, params, applied = build_where(f)

        sql = (
            f"WITH base AS ( "
            f"  SELECT COALESCE({quote_ident('Origin Country')}, "
            f"                 {quote_ident('Destination Country')}, "
            f"                 {quote_ident('Country')}) AS country, "
            f"         {quote_ident('Trade Type')} AS trade_type, "
            f"         {quote_ident('Value')} AS value, "
            f"         {quote_ident('Quantity')} AS quantity, "
            f"         {quote_ident('Importer')} AS importer, "
            f"         {quote_ident('Exporter')} AS exporter "
            f"  FROM {TABLE} {where} "
            f") "
            f"SELECT country, trade_type, "
            f"       COUNT(*) AS shipments, "
            f"       SUM(value) AS total_value, "
            f"       SUM(quantity) AS total_quantity, "
            f"       COUNT(DISTINCT importer) AS unique_importers, "
            f"       COUNT(DISTINCT exporter) AS unique_exporters "
            f"FROM base WHERE country IS NOT NULL "
            f"GROUP BY country, trade_type "
            f"ORDER BY total_value DESC NULLS LAST "
            f"LIMIT {int(limit)}"
        )
        cols, rows = db.fetch_columns(sql, params)
        data = list(iter_dict_rows(cols, rows))
        total = len(data)

    return data, total, t["ms"], applied


# ---------------------------------------------------------------------------
# HSN analysis
# ---------------------------------------------------------------------------

def hsn_analysis(
    db: DuckDBClient,
    f: FilterParams,
    *,
    limit: int = 50,
) -> tuple[list[dict], int, float, dict]:
    """Aggregate by HSN code with top counterparty per row.

    DuckDB's ``arg_max(party, value)`` returns the party with the highest
    value within each HSN group — handy for "biggest player by HSN" views.
    """
    with timer() as t:
        where, params, applied = build_where(f)
        non_null = f"{quote_ident('HSN')} IS NOT NULL"
        full_where = f"{where} AND {non_null}" if where else f"WHERE {non_null}"

        sql = (
            f"SELECT {quote_ident('HSN')} AS hsn, "
            f"       MAX({quote_ident('HS Chapter')}) AS hs_chapter, "
            f"       MAX({quote_ident('Trade Type')}) AS trade_type, "
            f"       COUNT(*) AS shipments, "
            f"       SUM({quote_ident('Value')}) AS total_value, "
            f"       SUM({quote_ident('Quantity')}) AS total_quantity, "
            f"       arg_max({quote_ident('Importer')}, {quote_ident('Value')}) AS top_importer, "
            f"       arg_max({quote_ident('Exporter')}, {quote_ident('Value')}) AS top_exporter "
            f"FROM {TABLE} {full_where} "
            f"GROUP BY {quote_ident('HSN')} "
            f"ORDER BY total_value DESC NULLS LAST "
            f"LIMIT {int(limit)}"
        )
        cols, rows = db.fetch_columns(sql, params)
        data = list(iter_dict_rows(cols, rows))
        total = len(data)

    return data, total, t["ms"], applied
