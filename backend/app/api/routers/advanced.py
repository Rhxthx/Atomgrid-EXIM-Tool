"""Advanced endpoints: autosuggest, similar-company, duplicates, keywords, concentration."""

from __future__ import annotations

import logging
import math
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_db_dep
from app.config import get_settings
from app.database import DuckDBClient
from app.models import PARTY_COLUMNS
from app.schemas import (
    DuplicateGroup,
    DuplicateResponse,
    KeywordResponse,
    KeywordRow,
    Meta,
    SimilarMatch,
    SimilarResponse,
    SuggestionResponse,
    SupplierConcentrationResponse,
    SupplierConcentrationRow,
)
from app.schemas.filters import FilterParams, filter_params_dep
from app.services import (
    detect_duplicates,
    extract_keywords,
    similar_entities,
    suggest,
    supplier_concentration,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["advanced"])

_PARTY_LIST_SORTED = sorted(PARTY_COLUMNS)


@router.get("/suggest", response_model=SuggestionResponse, summary="Autosuggest entity names")
def suggest_endpoint(
    field: Annotated[str, Query(description=f"Party column: one of {_PARTY_LIST_SORTED}")],
    q: Annotated[str, Query(min_length=2, description="Search prefix")],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    db: DuckDBClient = Depends(get_db_dep),
) -> SuggestionResponse:
    if field not in PARTY_COLUMNS:
        raise HTTPException(status_code=400, detail=f"field must be one of {_PARTY_LIST_SORTED}")
    suggestions, ms = suggest(db, field=field, query=q, limit=limit)
    return SuggestionResponse(field=field, query=q, suggestions=suggestions, query_ms=ms)


@router.get(
    "/similar",
    response_model=SimilarResponse,
    summary="Fuzzy match against distinct entity names",
)
def similar_endpoint(
    name: Annotated[str, Query(min_length=2)],
    field: Annotated[str, Query(description=f"Party column: one of {_PARTY_LIST_SORTED}")] = "Importer",
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    min_score: Annotated[int, Query(ge=50, le=100, description="RapidFuzz WRatio cutoff")] = 70,
    db: DuckDBClient = Depends(get_db_dep),
) -> SimilarResponse:
    if field not in PARTY_COLUMNS:
        raise HTTPException(status_code=400, detail=f"field must be one of {_PARTY_LIST_SORTED}")
    settings = get_settings()
    matches, ms = similar_entities(
        db,
        field=field,
        query=name,
        limit=limit,
        cache_ttl=settings.distinct_cache_ttl,
        score_cutoff=min_score,
    )
    return SimilarResponse(
        field=field, query=name,
        matches=[SimilarMatch(**m) for m in matches],
        query_ms=ms,
    )


@router.get(
    "/duplicates",
    response_model=DuplicateResponse,
    summary="Find shipments sharing the dedupe key",
)
def duplicates_endpoint(
    min_occurrences: Annotated[int, Query(ge=2, le=100)] = 2,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> DuplicateResponse:
    data, total, ms, applied = detect_duplicates(
        db, filters, min_occurrences=min_occurrences, limit=limit,
    )
    return DuplicateResponse(
        meta=Meta(
            total=total, page=1, page_size=limit,
            total_pages=1 if total else 0,
            query_ms=ms, filters_applied=applied,
        ),
        data=[DuplicateGroup(**r) for r in data],
    )


@router.get(
    "/keywords",
    response_model=KeywordResponse,
    summary="Top product-description keywords",
)
def keywords_endpoint(
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    sample_size: Annotated[int, Query(ge=1000, le=2_000_000)] = 100_000,
    filters: FilterParams = Depends(filter_params_dep),
    db: DuckDBClient = Depends(get_db_dep),
) -> KeywordResponse:
    data, total_unique, ms, applied = extract_keywords(
        db, filters, limit=limit, sample_size=sample_size,
    )
    return KeywordResponse(
        meta=Meta(
            total=total_unique,
            page=1, page_size=limit,
            total_pages=1 if total_unique else 0,
            query_ms=ms, filters_applied=applied,
        ),
        keywords=[KeywordRow(**r) for r in data],
    )


@router.get(
    "/supplier-concentration",
    response_model=SupplierConcentrationResponse,
    summary="Per-importer supplier concentration + Herfindahl index",
)
def supplier_concentration_endpoint(
    importer: Annotated[str, Query(min_length=2, description="Importer substring match")],
    top_n: Annotated[int, Query(ge=1, le=100)] = 10,
    db: DuckDBClient = Depends(get_db_dep),
) -> SupplierConcentrationResponse:
    result, ms = supplier_concentration(db, importer=importer, top_n=top_n)
    return SupplierConcentrationResponse(
        importer=result["importer"],
        total_suppliers=result["total_suppliers"],
        total_value=result["total_value"],
        hhi=result["hhi"],
        top_suppliers=[SupplierConcentrationRow(**r) for r in result["top_suppliers"]],
        query_ms=ms,
    )
