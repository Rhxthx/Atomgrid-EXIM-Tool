"""Argentina imports endpoints.

Argentina customs import data lives in its own table (``argentina_imports``)
because its schema differs from the India ``shipments`` table (Spanish
agrochemical taxonomy, FOB/CIF in USD, 2016-2026).  These endpoints are
self-contained and degrade gracefully if the table hasn't been loaded.
"""

from __future__ import annotations

import logging
import math
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api.deps import get_db_dep
from app.database import DuckDBClient, iter_dict_rows
from app.utils import timer

log = logging.getLogger(__name__)

router = APIRouter(prefix="/argentina", tags=["argentina"])

TABLE = "argentina_imports"

# Columns the user may sort by (whitelist guards against SQL injection).
SORTABLE = {
    "date", "importer", "origin_country", "active_ingredient_en", "brand",
    "quantity", "fob_unit_usd", "fob_total_usd", "cif_unit_usd",
    "cif_total_usd", "year",
}

# Columns returned in the shipment list (kept lean for the table).
LIST_COLS = [
    "date", "importer", "origin_country", "destination_country", "type",
    "active_ingredient_en", "brand", "formulation", "segment", "presentation",
    "quantity", "unit", "fob_unit_usd", "fob_total_usd",
    "cif_unit_usd", "cif_total_usd",
]

# Full column set for the "complete download" (everything meaningful).
EXPORT_COLS = [
    "date", "year", "importer", "importer_unified", "origin_country",
    "destination_country", "type", "active_ingredient", "active_ingredient_en",
    "brand", "formulation", "segment", "presentation", "quantity", "unit",
    "fob_unit_usd", "fob_total_usd", "cif_unit_usd", "cif_total_usd",
    "transport",
]
EXPORT_ROW_CAP = 1_000_000


def _table_exists(db: DuckDBClient) -> bool:
    row = db.fetch_one(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = ?",
        [TABLE],
    )
    return bool(row and row[0])


# Columns the free-text search scans.
_SEARCH_COLS = [
    "importer", "active_ingredient_en", "active_ingredient",
    "brand", "origin_country", "type",
]


def _q_clause(q: str) -> tuple[str, list]:
    """Parse a free-text query supporting AND / OR between terms.

    Examples:
        "glyphosate AND china"  -> both terms must match (somewhere)
        "atrazine OR paraquat"  -> either term matches
        "glyphosate"            -> single term
    Each term matches if it appears in ANY searchable column (ILIKE).
    Whichever operator appears first wins (no mixed-precedence parsing).
    """
    q = q.strip()
    if not q:
        return "", []
    if re.search(r"\bOR\b", q, flags=re.I):
        terms, op = re.split(r"\s+OR\s+", q, flags=re.I), "OR"
    else:
        terms, op = re.split(r"\s+AND\s+", q, flags=re.I), "AND"

    term_clauses: list[str] = []
    binds: list = []
    for term in (t.strip() for t in terms):
        if not term:
            continue
        ors = " OR ".join(f"{c} ILIKE ?" for c in _SEARCH_COLS)
        term_clauses.append(f"({ors})")
        binds += [f"%{term}%"] * len(_SEARCH_COLS)
    if not term_clauses:
        return "", []
    return "(" + f" {op} ".join(term_clauses) + ")", binds


def _where(params: dict) -> tuple[str, list]:
    """Build a WHERE clause + bind values from optional filters."""
    clauses: list[str] = []
    binds: list = []

    if params.get("q"):
        qc, qb = _q_clause(params["q"])
        if qc:
            clauses.append(qc)
            binds += qb
    if params.get("type"):
        clauses.append("type = ?")
        binds.append(params["type"])
    if params.get("importer"):
        clauses.append("importer ILIKE ?")
        binds.append(f"%{params['importer']}%")
    if params.get("origin_country"):
        clauses.append("origin_country ILIKE ?")
        binds.append(f"%{params['origin_country']}%")
    if params.get("active_ingredient"):
        clauses.append("(active_ingredient_en ILIKE ? OR active_ingredient ILIKE ?)")
        binds += [f"%{params['active_ingredient']}%"] * 2
    if params.get("date_from"):
        clauses.append("date >= ?")
        binds.append(params["date_from"])
    if params.get("date_to"):
        clauses.append("date <= ?")
        binds.append(params["date_to"])
    if params.get("year"):
        clauses.append("year = ?")
        binds.append(params["year"])

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, binds


@router.get("/stats", summary="Argentina imports dataset summary")
def argentina_stats(db: DuckDBClient = Depends(get_db_dep)) -> dict:
    if not _table_exists(db):
        return {"available": False, "total_rows": 0}

    with timer() as t:
        head = db.fetch_one(
            f"SELECT count(*), count(DISTINCT importer), "
            f"count(DISTINCT origin_country), min(date), max(date), "
            f"sum(cif_total_usd) FROM {TABLE}"
        )
        top_origins = [
            {"name": r[0], "count": int(r[1])}
            for r in db.fetch_all(
                f"SELECT origin_country, count(*) FROM {TABLE} "
                f"WHERE origin_country IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
            )
        ]
        top_ingredients = [
            {"name": r[0], "count": int(r[1])}
            for r in db.fetch_all(
                f"SELECT active_ingredient_en, count(*) FROM {TABLE} "
                f"WHERE active_ingredient_en IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
            )
        ]
        top_importers = [
            {"name": r[0], "cif_total_usd": float(r[1] or 0)}
            for r in db.fetch_all(
                f"SELECT importer, sum(cif_total_usd) FROM {TABLE} "
                f"WHERE importer IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
            )
        ]
        # TECNICO = technical active ingredient, FORMULADO = formulation
        type_breakdown = [
            {"code": r[0], "count": int(r[1])}
            for r in db.fetch_all(
                f"SELECT type, count(*) FROM {TABLE} GROUP BY 1 ORDER BY 2 DESC"
            )
        ]

    return {
        "available": True,
        "total_rows": int(head[0] or 0),
        "distinct_importers": int(head[1] or 0),
        "distinct_origin_countries": int(head[2] or 0),
        "date_min": head[3],
        "date_max": head[4],
        "total_cif_usd": float(head[5] or 0),
        "top_origins": top_origins,
        "top_ingredients": top_ingredients,
        "top_importers": top_importers,
        "type_breakdown": type_breakdown,
        "query_ms": t["ms"],
    }


@router.get("/shipments", summary="List Argentina import rows with filters")
def argentina_shipments(
    db: DuckDBClient = Depends(get_db_dep),
    q: str | None = Query(None, description="Search across importer/ingredient/brand/origin/type; supports AND / OR between terms"),
    type: str | None = Query(None, description="Filter by product type: TECNICO (technical) or FORMULADO (formulation)"),
    importer: str | None = None,
    origin_country: str | None = None,
    active_ingredient: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    year: int | None = None,
    sort_by: str = Query("date", description="Sort column"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> dict:
    if not _table_exists(db):
        return {"meta": {"total": 0, "page": page, "page_size": page_size,
                         "total_pages": 0, "available": False}, "data": []}

    params = {
        "q": q, "type": type, "importer": importer, "origin_country": origin_country,
        "active_ingredient": active_ingredient, "date_from": date_from,
        "date_to": date_to, "year": year,
    }
    where, binds = _where(params)
    order_col = sort_by if sort_by in SORTABLE else "date"
    order = f' ORDER BY {order_col} {"ASC" if sort_order == "asc" else "DESC"}'
    offset = (page - 1) * page_size

    with timer() as t:
        total = int(db.fetch_one(f"SELECT count(*) FROM {TABLE}{where}", binds)[0])
        cols = ", ".join(LIST_COLS)
        sql = f"SELECT {cols} FROM {TABLE}{where}{order} LIMIT ? OFFSET ?"
        names, rows = db.fetch_columns(sql, binds + [page_size, offset])
        data = list(iter_dict_rows(names, rows))

    return {
        "meta": {
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": math.ceil(total / page_size) if page_size else 0,
            "query_ms": t["ms"],
            "available": True,
        },
        "data": data,
    }


@router.get("/export", summary="Export ALL matching Argentina rows as CSV")
def argentina_export(
    db: DuckDBClient = Depends(get_db_dep),
    q: str | None = None,
    type: str | None = None,
    importer: str | None = None,
    origin_country: str | None = None,
    active_ingredient: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    year: int | None = None,
    sort_by: str = "date",
    sort_order: str = "desc",
) -> StreamingResponse:
    """Stream every Argentina row matching the filters as a UTF-8 CSV (opens in
    Excel). Not paginated — reflects exactly what the user searched. Capped at
    1,000,000 rows for safety.
    """
    import csv
    import io

    if not _table_exists(db):
        raise HTTPException(status_code=404, detail="Argentina data not loaded")

    params = {
        "q": q, "type": type, "importer": importer, "origin_country": origin_country,
        "active_ingredient": active_ingredient, "date_from": date_from,
        "date_to": date_to, "year": year,
    }
    where, binds = _where(params)
    order_col = sort_by if sort_by in SORTABLE else "date"
    order = f' ORDER BY {order_col} {"ASC" if sort_order == "asc" else "DESC"}'
    cols = ", ".join(EXPORT_COLS)
    sql = f"SELECT {cols} FROM {TABLE}{where}{order} LIMIT {EXPORT_ROW_CAP}"

    cur = db.cursor()
    cur.execute(sql, binds)
    header = [d[0] for d in cur.description]

    def _drain(buf) -> str:
        s = buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        return s

    def _rows():
        buf = io.StringIO()
        writer = csv.writer(buf)
        yield "﻿"                    # BOM for Excel
        writer.writerow(header)
        yield _drain(buf)
        while True:
            batch = cur.fetchmany(10_000)
            if not batch:
                break
            for row in batch:
                writer.writerow(["" if v is None else v for v in row])
            yield _drain(buf)

    return StreamingResponse(
        _rows(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="argentina_imports_export.csv"'
        },
    )
