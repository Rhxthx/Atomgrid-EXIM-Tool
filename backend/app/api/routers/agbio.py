"""AG-Bio market endpoints.

Aggregated crop-protection market-value data lives in its own table
(``ag_bio_market``) because its shape is fundamentally different from the
shipment-level EXIM tables: one row per (product, country) with a per-crop
USD-millions value breakdown — no HSN, no importer/exporter, no per-shipment
quantity. These endpoints are self-contained and degrade gracefully if the
table hasn't been loaded (see scripts/load_agbio.py).
"""

from __future__ import annotations

import logging
import math

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db_dep
from app.database import DuckDBClient, iter_dict_rows
from app.utils import timer

log = logging.getLogger(__name__)

router = APIRouter(prefix="/agbio", tags=["agbio"])

TABLE = "ag_bio_market"

# Values are USD millions ("AI Value (m.)" in the source report).
CROP_COLS = [
    "cereals", "cotton", "maize", "oilseed_rape", "other_crops", "other_fv",
    "pome_stone_fruit", "potato", "rice", "soybean", "sugar_beet",
    "sugarcane", "sunflower", "vine",
]
LIST_COLS = ["product", "type", "country"] + CROP_COLS + ["total_usd_m"]

SORTABLE = {"product", "type", "country", "total_usd_m"}


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
        clauses.append("(product ILIKE ? OR country ILIKE ? OR type ILIKE ?)")
        binds += [q, q, q]
    if params.get("product"):
        clauses.append("product ILIKE ?")
        binds.append(f"%{params['product']}%")
    if params.get("country"):
        clauses.append("country ILIKE ?")
        binds.append(f"%{params['country']}%")
    if params.get("type"):
        clauses.append("type ILIKE ?")
        binds.append(f"%{params['type']}%")

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, binds


@router.get("/stats", summary="AG-Bio market dataset summary")
def agbio_stats(db: DuckDBClient = Depends(get_db_dep)) -> dict:
    if not _table_exists(db):
        return {"available": False, "total_rows": 0}

    with timer() as t:
        head = db.fetch_one(
            f"SELECT count(*), count(DISTINCT product), count(DISTINCT country), "
            f"sum(total_usd_m) FROM {TABLE}"
        )
        top_products = [
            {"name": r[0], "total_usd_m": float(r[1] or 0)}
            for r in db.fetch_all(
                f"SELECT product, sum(total_usd_m) FROM {TABLE} "
                f"GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
            )
        ]
        top_countries = [
            {"name": r[0], "total_usd_m": float(r[1] or 0)}
            for r in db.fetch_all(
                f"SELECT country, sum(total_usd_m) FROM {TABLE} "
                f"GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
            )
        ]
        type_breakdown = [
            {"code": r[0], "count": int(r[1])}
            for r in db.fetch_all(
                f"SELECT type, count(*) FROM {TABLE} GROUP BY 1 ORDER BY 2 DESC"
            )
        ]

    return {
        "available": True,
        "total_rows": int(head[0] or 0),
        "distinct_products": int(head[1] or 0),
        "distinct_countries": int(head[2] or 0),
        "total_value_usd_m": float(head[3] or 0),
        "top_products": top_products,
        "top_countries": top_countries,
        "type_breakdown": type_breakdown,
        "query_ms": t["ms"],
    }


@router.get("/search", summary="Search AG-Bio market rows by product/country/type")
def agbio_search(
    db: DuckDBClient = Depends(get_db_dep),
    q: str | None = Query(None, description="Free-text across product/country/type"),
    product: str | None = Query(None, description="Product (active ingredient) substring"),
    country: str | None = Query(None, description="Country substring"),
    type: str | None = Query(None, description="Pesticide category substring, e.g. Herbicide"),
    sort_by: str = Query("total_usd_m", description="Sort column"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> dict:
    if not _table_exists(db):
        return {"meta": {"total": 0, "page": page, "page_size": page_size,
                         "total_pages": 0, "available": False}, "data": []}

    params = {"q": q, "product": product, "country": country, "type": type}
    where, binds = _where(params)
    order_col = sort_by if sort_by in SORTABLE else "total_usd_m"
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


@router.get("/breakdown", summary="Top products & countries by value over the current filter")
def agbio_breakdown(
    db: DuckDBClient = Depends(get_db_dep),
    q: str | None = Query(None),
    product: str | None = Query(None, description="Product substring — narrows the ranking to this product"),
    country: str | None = Query(None, description="Country substring — narrows the ranking to this country"),
    type: str | None = Query(None),
    limit: int = Query(10, ge=1, le=50),
) -> dict:
    """Dynamic rankings that follow the current search:

    - filter by a COUNTRY -> ``top_products`` lists that country's biggest
      products by AI value (USD millions);
    - filter by a PRODUCT -> ``top_countries`` lists that product's biggest
      markets;
    - no filter -> both are the global Top-N.

    Both lists are always returned (computed over the same WHERE); the frontend
    decides which to show based on what the user searched.
    """
    if not _table_exists(db):
        return {"available": False, "top_products": [], "top_countries": []}

    params = {"q": q, "product": product, "country": country, "type": type}
    where, binds = _where(params)

    with timer() as t:
        top_products = [
            {"name": r[0], "total_usd_m": float(r[1] or 0)}
            for r in db.fetch_all(
                f"SELECT product, sum(total_usd_m) FROM {TABLE}{where} "
                f"GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT ?",
                binds + [limit],
            )
        ]
        top_countries = [
            {"name": r[0], "total_usd_m": float(r[1] or 0)}
            for r in db.fetch_all(
                f"SELECT country, sum(total_usd_m) FROM {TABLE}{where} "
                f"GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT ?",
                binds + [limit],
            )
        ]

    return {
        "available": True,
        "top_products": top_products,
        "top_countries": top_countries,
        "query_ms": t["ms"],
    }
