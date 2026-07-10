"""Analytics endpoints — top-N, trends, country/HSN aggregations."""

from __future__ import annotations

import logging
import math
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_db_dep
from app.database import DuckDBClient
from app.schemas import (
    CountryAnalysisResponse,
    CountryAnalysisRow,
    HSNAnalysisResponse,
    HSNAnalysisRow,
    Meta,
    MonthlyTrendResponse,
    TopEntitiesResponse,
    TopEntity,
    TrendBucket,
)
from app.schemas.filters import FilterParams, filter_params_dep
from app.services import (
    country_analysis,
    hsn_analysis,
    monthly_trend,
    top_entities,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["analytics"])


# ---------------------------------------------------------------------------
# Top entities
# ---------------------------------------------------------------------------

def _top_response(
    entity: str,
    data: list[dict],
    total: int,
    ms: float,
    applied: dict,
    page_size: int,
) -> TopEntitiesResponse:
    return TopEntitiesResponse(
        meta=Meta(
            total=total,
            page=1,
            page_size=page_size,
            total_pages=math.ceil(total / page_size) if page_size else 0,
            query_ms=ms,
            filters_applied=applied,
        ),
        entity_type=entity,
        data=[TopEntity(**r) for r in data],
    )


def _top_endpoint(
    entity: str,
    limit: int,
    filters: FilterParams,
    db: DuckDBClient,
) -> TopEntitiesResponse:
    data, total, ms, applied = top_entities(db, entity=entity, f=filters, limit=limit)
    return _top_response(entity, data, total, ms, applied, limit)


@router.get("/top-importers", response_model=TopEntitiesResponse, summary="Top importers by value")
def top_importers(
    limit: Annotated[int, Query(ge=1, le=500)] = 25,
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> TopEntitiesResponse:
    return _top_endpoint("Importer", limit, filters, db)


@router.get("/top-exporters", response_model=TopEntitiesResponse, summary="Top exporters by value")
def top_exporters(
    limit: Annotated[int, Query(ge=1, le=500)] = 25,
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> TopEntitiesResponse:
    return _top_endpoint("Exporter", limit, filters, db)


@router.get("/top-suppliers", response_model=TopEntitiesResponse, summary="Top suppliers by value")
def top_suppliers(
    limit: Annotated[int, Query(ge=1, le=500)] = 25,
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> TopEntitiesResponse:
    return _top_endpoint("Supplier", limit, filters, db)


@router.get("/top-buyers", response_model=TopEntitiesResponse, summary="Top buyers by value")
def top_buyers(
    limit: Annotated[int, Query(ge=1, le=500)] = 25,
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> TopEntitiesResponse:
    return _top_endpoint("Buyer", limit, filters, db)


# ---------------------------------------------------------------------------
# Trends
# ---------------------------------------------------------------------------

@router.get("/trends/monthly", response_model=MonthlyTrendResponse, summary="Monthly trade trend")
def trends_monthly(
    group_by: Annotated[
        list[str] | None,
        Query(description="Optional secondary grouping: Trade Type, HS Chapter, Origin Country, Destination Country"),
    ] = None,
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> MonthlyTrendResponse:
    data, ms, applied = monthly_trend(db, filters, group_by=group_by)
    total = len(data)
    return MonthlyTrendResponse(
        meta=Meta(
            total=total,
            page=1,
            page_size=total or 1,
            total_pages=1 if total else 0,
            query_ms=ms,
            filters_applied=applied,
        ),
        group_by=group_by or [],
        data=[TrendBucket(**r) for r in data],
    )


# ---------------------------------------------------------------------------
# Country & HSN analysis
# ---------------------------------------------------------------------------

@router.get(
    "/country-analysis",
    response_model=CountryAnalysisResponse,
    summary="Aggregated counterparty-country view",
)
def country_analysis_endpoint(
    country: str | None = Query(default=None, description="Substring match shortcut — same as filter `country`"),
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> CountryAnalysisResponse:
    if country:
        filters = filters.model_copy(update={"country": country})
    data, total, ms, applied = country_analysis(db, filters, limit=limit)
    return CountryAnalysisResponse(
        meta=Meta(
            total=total, page=1, page_size=limit,
            total_pages=1 if total else 0,
            query_ms=ms, filters_applied=applied,
        ),
        data=[CountryAnalysisRow(**r) for r in data],
    )


@router.get(
    "/hsn-analysis",
    response_model=HSNAnalysisResponse,
    summary="Aggregated per-HSN view (with top counterparty per row)",
)
def hsn_analysis_endpoint(
    code: str | None = Query(default=None, description="HSN prefix match shortcut — same as filter `hsn`"),
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> HSNAnalysisResponse:
    if code:
        filters = filters.model_copy(update={"hsn": code})
    data, total, ms, applied = hsn_analysis(db, filters, limit=limit)
    return HSNAnalysisResponse(
        meta=Meta(
            total=total, page=1, page_size=limit,
            total_pages=1 if total else 0,
            query_ms=ms, filters_applied=applied,
        ),
        data=[HSNAnalysisRow(**r) for r in data],
    )
