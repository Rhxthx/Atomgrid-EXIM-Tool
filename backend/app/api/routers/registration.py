"""Global Registration endpoints.

Read-only, cross-country pesticide/plant-protection product REGISTRATION data
normalised from 21 national registries into one table (``global_registration``).
Same isolation pattern as ag_bio_market: its own table, self-contained router,
degrades gracefully if the table hasn't been loaded (see
scripts/load_global_registration.py).
"""

from __future__ import annotations

import logging
import math

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db_dep
from app.database import DuckDBClient, iter_dict_rows
from app.utils import timer

log = logging.getLogger(__name__)

router = APIRouter(prefix="/registration", tags=["registration"])

TABLE = "global_registration"

# Common (normalised) columns shown in the table; raw_json carries every
# original country-specific field for the expand/details panel.
LIST_COLS = [
    "country", "product", "active_ingredient", "concentration", "company",
    "status", "registration_no", "formulation_type", "origin", "raw_json",
]
SORTABLE = {"country", "product", "active_ingredient", "company", "status", "registration_no"}


def _table_exists(db: DuckDBClient) -> bool:
    row = db.fetch_one(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = ?",
        [TABLE],
    )
    return bool(row and row[0])


def _where(params: dict) -> tuple[str, list]:
    clauses: list[str] = []
    binds: list = []

    if params.get("q"):
        q = f"%{params['q']}%"
        clauses.append("(product ILIKE ? OR active_ingredient ILIKE ? OR company ILIKE ?)")
        binds += [q, q, q]
    if params.get("active_ingredient"):
        clauses.append("active_ingredient ILIKE ?")
        binds.append(f"%{params['active_ingredient']}%")
    if params.get("product"):
        clauses.append("product ILIKE ?")
        binds.append(f"%{params['product']}%")
    if params.get("company"):
        clauses.append("company ILIKE ?")
        binds.append(f"%{params['company']}%")
    if params.get("country"):
        clauses.append("country = ?")
        binds.append(params["country"])

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, binds


@router.get("/stats", summary="Global Registration dataset summary")
def registration_stats(db: DuckDBClient = Depends(get_db_dep)) -> dict:
    if not _table_exists(db):
        return {"available": False, "total_rows": 0, "countries": []}

    with timer() as t:
        head = db.fetch_one(
            f"SELECT count(*), count(DISTINCT country), "
            f"count(DISTINCT active_ingredient) FROM {TABLE}"
        )
        countries = [
            {"name": r[0], "count": int(r[1])}
            for r in db.fetch_all(
                f"SELECT country, count(*) FROM {TABLE} "
                f"WHERE country IS NOT NULL GROUP BY 1 ORDER BY 1"
            )
        ]

    return {
        "available": True,
        "total_rows": int(head[0] or 0),
        "distinct_countries": int(head[1] or 0),
        "distinct_active_ingredients": int(head[2] or 0),
        "countries": countries,
        "query_ms": t["ms"],
    }


@router.get("/search", summary="Search registrations by ingredient/product/company/country")
def registration_search(
    db: DuckDBClient = Depends(get_db_dep),
    q: str | None = Query(None, description="Free text across product/active ingredient/company"),
    active_ingredient: str | None = Query(None, description="Active-ingredient substring"),
    product: str | None = Query(None, description="Product / trade-name substring"),
    company: str | None = Query(None, description="Company / registrant substring"),
    country: str | None = Query(None, description="Exact country name"),
    sort_by: str = Query("country", description="Sort column"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> dict:
    if not _table_exists(db):
        return {"meta": {"total": 0, "page": page, "page_size": page_size,
                         "total_pages": 0, "available": False}, "data": []}

    params = {"q": q, "active_ingredient": active_ingredient, "product": product,
              "company": company, "country": country}
    where, binds = _where(params)
    order_col = sort_by if sort_by in SORTABLE else "country"
    order = f' ORDER BY {order_col} {"ASC" if sort_order == "asc" else "DESC"} NULLS LAST'
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
