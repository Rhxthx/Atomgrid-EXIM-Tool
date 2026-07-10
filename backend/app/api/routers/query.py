"""Advanced query-builder endpoints.

Three endpoints:

  GET  /api/query/fields      → metadata for UI dropdowns
  POST /api/query/explain     → SQL preview without execution (debug)
  POST /api/query             → run query, return paginated shipments
"""

from __future__ import annotations

import logging
import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_db_dep
from app.database import DuckDBClient, iter_dict_rows
from app.models import SHIPMENT_COLUMNS, TABLE, quote_ident
from app.schemas import Meta, PaginatedShipments, ShipmentRecord
from app.schemas.query import (
    FieldsResponse,
    QueryExplainResponse,
    QueryRequest,
)
from app.services.query_builder import (
    FIELDS,
    QueryBuildError,
    SORTABLE_API_FIELDS,
    build_where,
    explain_sql,
    list_fields,
)
from app.utils import timer

log = logging.getLogger(__name__)

router = APIRouter(prefix="/query", tags=["query-builder"])

_ALL_COLS = ", ".join(quote_ident(c) for c in SHIPMENT_COLUMNS)


@router.get("/fields", response_model=FieldsResponse, summary="List queryable fields")
def get_fields() -> FieldsResponse:
    """Returned to the frontend at page load to drive the column +
    operator dropdowns.  Includes per-field operator lists so the UI can
    show only operators that make sense for the chosen column type.
    """
    return FieldsResponse(fields=list_fields())


@router.post(
    "/explain",
    response_model=QueryExplainResponse,
    summary="Preview SQL without executing",
)
def explain(req: QueryRequest) -> QueryExplainResponse:
    """Renders the SQL that ``/api/query`` would issue, with parameters
    still bound as positional ``?`` placeholders.  Handy when debugging
    why a complex query returns unexpected rows.
    """
    try:
        sql, params = explain_sql(req.where, base=TABLE)
    except QueryBuildError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return QueryExplainResponse(sql=sql, params=params)


@router.post(
    "",
    response_model=PaginatedShipments,
    summary="Run an advanced filter tree against shipments",
)
def run_query(
    req: QueryRequest,
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    """Same response shape as ``/api/search`` so the existing DataTable
    component works without changes."""

    try:
        where_sql, params = build_where(req.where)
    except QueryBuildError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Sort-by uses API field names (snake_case) — translate to the
    # quoted column name.  Reject anything outside the whitelist.
    sort_col_sql = quote_ident("Date")
    if req.sort_by:
        if req.sort_by not in SORTABLE_API_FIELDS:
            raise HTTPException(
                status_code=400,
                detail=f"sort_by must be one of: {sorted(SORTABLE_API_FIELDS)}",
            )
        sort_col_sql = quote_ident(FIELDS[req.sort_by].column)
    direction = "ASC" if req.sort_order == "asc" else "DESC"
    order_by = f"ORDER BY {sort_col_sql} {direction} NULLS LAST"

    with timer() as t:
        # Single-pass query — count via a single COUNT() and then a LIMIT
        # SELECT.  Both reuse the same WHERE so DuckDB caches the filter.
        total_row = db.fetch_one(f"SELECT COUNT(*) FROM {TABLE} {where_sql}", params)
        total = int(total_row[0]) if total_row else 0

        rows: list[dict[str, Any]] = []
        if total > 0:
            offset = (req.page - 1) * req.page_size
            sql = (
                f"SELECT {_ALL_COLS} FROM {TABLE} {where_sql} "
                f"{order_by} LIMIT {int(req.page_size)} OFFSET {int(offset)}"
            )
            cols, data = db.fetch_columns(sql, params)
            rows = list(iter_dict_rows(cols, data))

    applied = _summarise_filters(req)
    return PaginatedShipments(
        meta=Meta(
            total=total,
            page=req.page,
            page_size=req.page_size,
            total_pages=math.ceil(total / req.page_size) if req.page_size else 0,
            query_ms=t["ms"],
            filters_applied=applied,
        ),
        data=[ShipmentRecord(**r) for r in rows],
    )


def _summarise_filters(req: QueryRequest) -> dict[str, Any]:
    """Flatten the tree into a small summary for the response metadata —
    not the full tree (which would be redundant since the client sent it)
    but a count + a sample so logs are readable.
    """
    if req.where is None:
        return {}

    def count_nodes(node, *, conditions: int = 0, groups: int = 0):
        if node.type == "condition":
            return conditions + 1, groups
        groups += 1
        for child in node.conditions:
            conditions, groups = count_nodes(child, conditions=conditions, groups=groups)
        return conditions, groups

    n_cond, n_groups = count_nodes(req.where)
    return {
        "conditions": n_cond,
        "groups": n_groups,
        "root_logic": req.where.logic.value,
    }
