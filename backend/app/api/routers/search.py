"""Search endpoints — the public surface for shipment lookup.

All endpoints share the same ``FilterParams`` dependency, so any filter
(date range, country, HSN, value range, etc.) works on every route.  The
purpose of the field-specific routes (``/importer``, ``/hsn`` …) is
ergonomics: a caller passing ``/importer?name=foo`` doesn't have to know
which underlying filter that maps to.
"""

from __future__ import annotations

import logging
import math

from fastapi import APIRouter, Depends, HTTPException, Query

from fastapi.responses import StreamingResponse

from app.api.deps import get_db_dep
from app.auth.security import get_current_user
from app.config import Settings, get_settings
from app.database import DuckDBClient
from app.schemas import Meta, PaginatedShipments, ShipmentAggregate, ShipmentRecord
from app.schemas.filters import FilterParams, filter_params_dep
from app.services.search import (
    EXPORT_ROW_CAP,
    aggregate_shipments,
    export_shipments_csv,
    list_shipments,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["search"])


def _build_response(
    data: list[dict],
    total: int,
    query_ms: float,
    filters_applied: dict,
    page: int,
    page_size: int,
) -> PaginatedShipments:
    return PaginatedShipments(
        meta=Meta(
            total=total,
            page=page,
            page_size=page_size,
            total_pages=math.ceil(total / page_size) if page_size else 0,
            query_ms=query_ms,
            filters_applied=filters_applied,
        ),
        data=[ShipmentRecord(**row) for row in data],
    )


@router.get("/search", response_model=PaginatedShipments, summary="Global search")
def search_all(
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    """Search shipments with any combination of filters.

    The free-text ``q`` parameter is OR'd across Importer, Exporter,
    Supplier, Buyer, Product Description and HSN (all ILIKE, case-
    insensitive partial match).
    """
    data, total, ms, applied = list_shipments(db, filters)
    return _build_response(data, total, ms, applied, filters.page, filters.page_size)


@router.get(
    "/shipments",
    response_model=PaginatedShipments,
    summary="List shipments with filters (alias of /search)",
)
def shipments(
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    data, total, ms, applied = list_shipments(db, filters)
    return _build_response(data, total, ms, applied, filters.page, filters.page_size)


@router.get(
    "/aggregate",
    response_model=ShipmentAggregate,
    summary="Aggregate totals over ALL rows matching the filters",
)
def aggregate(
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> ShipmentAggregate:
    """Count, summed quantity/value and mean per-unit USD price over the ENTIRE
    filtered result set (not just one page). Powers the row-selection summary
    bar's "select all matching" mode.
    """
    return ShipmentAggregate(**aggregate_shipments(db, filters))


@router.get("/export", summary="Export rows matching the filters as CSV")
def export_csv(
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
    user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> StreamingResponse:
    """Download rows matching the current filters (not just one page).

    Streams a UTF-8 CSV (opens directly in Excel). Admins get the full result
    set (capped at 1,000,000 rows for safety — within Excel's limit); non-admin
    users are limited to ``EXIM_USER_EXPORT_CAP`` rows (default 50).
    """
    row_cap = EXPORT_ROW_CAP if user["role"] == "admin" else settings.user_export_cap
    stream = export_shipments_csv(db, filters, row_cap=row_cap)
    return StreamingResponse(
        stream,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="atomgrid_exim_export.csv"'
        },
    )


# ---------------------------------------------------------------------------
# Convenience routes — each maps one query param onto the matching filter
# ---------------------------------------------------------------------------

def _override(filters: FilterParams, **kwargs) -> FilterParams:
    """Return a copy of ``filters`` with the given fields overridden."""
    return filters.model_copy(update={k: v for k, v in kwargs.items() if v is not None})


@router.get("/importer", response_model=PaginatedShipments, summary="Search by importer name")
def by_importer(
    name: str = Query(..., min_length=1, description="Importer substring (case-insensitive)"),
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    filters = _override(filters, importer=name)
    data, total, ms, applied = list_shipments(db, filters)
    return _build_response(data, total, ms, applied, filters.page, filters.page_size)


@router.get("/exporter", response_model=PaginatedShipments, summary="Search by exporter name")
def by_exporter(
    name: str = Query(..., min_length=1),
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    filters = _override(filters, exporter=name)
    data, total, ms, applied = list_shipments(db, filters)
    return _build_response(data, total, ms, applied, filters.page, filters.page_size)


@router.get("/supplier", response_model=PaginatedShipments, summary="Search by supplier name")
def by_supplier(
    name: str = Query(..., min_length=1),
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    filters = _override(filters, supplier=name)
    data, total, ms, applied = list_shipments(db, filters)
    return _build_response(data, total, ms, applied, filters.page, filters.page_size)


@router.get("/buyer", response_model=PaginatedShipments, summary="Search by buyer name")
def by_buyer(
    name: str = Query(..., min_length=1),
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    filters = _override(filters, buyer=name)
    data, total, ms, applied = list_shipments(db, filters)
    return _build_response(data, total, ms, applied, filters.page, filters.page_size)


@router.get("/hsn", response_model=PaginatedShipments, summary="Search by HSN code")
def by_hsn(
    code: str = Query(..., min_length=2, description="HSN prefix, e.g. '29' or '29014300'"),
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    filters = _override(filters, hsn=code)
    data, total, ms, applied = list_shipments(db, filters)
    return _build_response(data, total, ms, applied, filters.page, filters.page_size)


@router.get("/country", response_model=PaginatedShipments, summary="Search by country")
def by_country(
    name: str = Query(..., min_length=1, description="Origin OR destination country (substring)"),
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    filters = _override(filters, country=name)
    data, total, ms, applied = list_shipments(db, filters)
    return _build_response(data, total, ms, applied, filters.page, filters.page_size)


@router.get("/product", response_model=PaginatedShipments, summary="Search by product keyword")
def by_product(
    q: str = Query(..., min_length=2, description="Substring match on Product Description"),
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> PaginatedShipments:
    # We route this through the generic free-text 'q' so the multi-column OR
    # search applies (helpful when users type the brand name into /product).
    filters = _override(filters, q=q)
    data, total, ms, applied = list_shipments(db, filters)
    return _build_response(data, total, ms, applied, filters.page, filters.page_size)
