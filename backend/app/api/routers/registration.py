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
    "status", "registration_no", "formulation_type", "category", "origin", "raw_json",
]
SORTABLE = {"country", "product", "active_ingredient", "company", "status",
            "registration_no", "category"}

# Operators for the active-ingredient logical builder (op|value pairs).
_AI_OPS = {
    "contains":    ("active_ingredient ILIKE ?", lambda v: f"%{v}%"),
    "notcontains": ("(active_ingredient IS NULL OR active_ingredient NOT ILIKE ?)", lambda v: f"%{v}%"),
    "equals":      ("lower(active_ingredient) = lower(?)", lambda v: v),
    "notequals":   ("(active_ingredient IS NULL OR lower(active_ingredient) <> lower(?))", lambda v: v),
}


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
    if params.get("category"):
        clauses.append("category = ?")
        binds.append(params["category"])

    # Active-ingredient logical builder: a list of "op|value" conditions joined
    # by AND / OR (each condition may itself be a negation via not-contains /
    # not-equals). The whole group is ANDed with the other filters.
    conds = params.get("ai_conds") or []
    join = "OR" if str(params.get("ai_join", "and")).lower() == "or" else "AND"
    sub_clauses: list[str] = []
    sub_binds: list = []
    for cond in conds:
        op, _, val = str(cond).partition("|")
        op, val = op.strip().lower(), val.strip()
        if not val or op not in _AI_OPS:
            continue
        sql, mk = _AI_OPS[op]
        sub_clauses.append(sql)
        sub_binds.append(mk(val))
    if sub_clauses:
        clauses.append("(" + f" {join} ".join(sub_clauses) + ")")
        binds.extend(sub_binds)

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


def _filter_params(q, active_ingredient, product, company, country, category,
                   ai, ai_join) -> dict:
    return {"q": q, "active_ingredient": active_ingredient, "product": product,
            "company": company, "country": country, "category": category,
            "ai_conds": ai, "ai_join": ai_join}


@router.get("/search", summary="Search registrations by ingredient/product/company/country")
def registration_search(
    db: DuckDBClient = Depends(get_db_dep),
    q: str | None = Query(None, description="Free text across product/active ingredient/company"),
    active_ingredient: str | None = Query(None, description="Active-ingredient substring"),
    product: str | None = Query(None, description="Product / trade-name substring"),
    company: str | None = Query(None, description="Company / registrant substring"),
    country: str | None = Query(None, description="Exact country name"),
    category: str | None = Query(None, description="Technical / Formulation / Unknown"),
    ai: list[str] | None = Query(None, description="AI conditions as 'op|value' (op: contains/notcontains/equals/notequals)"),
    ai_join: str = Query("and", description="Join AI conditions with 'and' or 'or'"),
    sort_by: str = Query("country", description="Sort column"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> dict:
    if not _table_exists(db):
        return {"meta": {"total": 0, "page": page, "page_size": page_size,
                         "total_pages": 0, "available": False}, "data": []}

    params = _filter_params(q, active_ingredient, product, company, country,
                            category, ai, ai_join)
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


@router.get("/breakdown", summary="Registration/country counts for the current filters (dynamic KPIs)")
def registration_breakdown(
    db: DuckDBClient = Depends(get_db_dep),
    q: str | None = Query(None),
    active_ingredient: str | None = Query(None),
    product: str | None = Query(None),
    company: str | None = Query(None),
    country: str | None = Query(None),
    category: str | None = Query(None),
    ai: list[str] | None = Query(None),
    ai_join: str = Query("and"),
) -> dict:
    """Totals for whatever the user is searching: number of registrations,
    number of distinct countries, and the matching countries with their counts.
    """
    if not _table_exists(db):
        return {"available": False, "total": 0, "distinct_countries": 0, "countries": []}

    params = _filter_params(q, active_ingredient, product, company, country,
                            category, ai, ai_join)
    where, binds = _where(params)

    with timer() as t:
        total = int(db.fetch_one(f"SELECT count(*) FROM {TABLE}{where}", binds)[0])
        countries = [
            {"name": r[0], "count": int(r[1])}
            for r in db.fetch_all(
                f"SELECT country, count(*) FROM {TABLE}{where} "
                f"GROUP BY 1 ORDER BY 2 DESC", binds
            )
        ]

    return {
        "available": True,
        "total": total,
        "distinct_countries": len(countries),
        "countries": countries,
        "query_ms": t["ms"],
    }
