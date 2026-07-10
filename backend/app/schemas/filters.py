"""Shared query-parameter model used by every search/analytics endpoint.

Modelled as a FastAPI dependency so endpoints get type-checked, OpenAPI-
documented filters with one line:

    filters: FilterParams = Depends(filter_params_dep)
"""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Annotated, Optional

from fastapi import Query
from pydantic import BaseModel, Field, ConfigDict, model_validator

from app.config import get_settings
from app.models import SORTABLE_COLUMNS


class SortOrder(str, Enum):
    asc = "asc"
    desc = "desc"


class TradeType(str, Enum):
    import_ = "IMPORT"
    export = "EXPORT"


class FilterParams(BaseModel):
    """Centralised filter set.  Every field is optional."""

    model_config = ConfigDict(extra="forbid")

    # Free-text search across the columns in SEARCHABLE_TEXT_COLUMNS.
    q: Optional[str] = None

    # Party filters — substring match, case-insensitive.
    importer: Optional[str] = None
    exporter: Optional[str] = None
    supplier: Optional[str] = None
    buyer: Optional[str] = None

    # HSN — prefix match (matches "2901" → all 8-digit HSN codes starting 2901).
    hsn: Optional[str] = None
    hs_chapter: Optional[str] = None

    # Geography
    country: Optional[str] = None
    origin_country: Optional[str] = None
    destination_country: Optional[str] = None
    port: Optional[str] = None

    # Trade type
    trade_type: Optional[TradeType] = None

    # Reporting country — which customs feed (INDIA, VIETNAM, TURKEY, ...)
    reporting_country: Optional[str] = None

    # Date range — inclusive
    date_from: Optional[date] = None
    date_to: Optional[date] = None

    # Numeric ranges
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    min_quantity: Optional[float] = None
    max_quantity: Optional[float] = None

    # Pagination + sort
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=1000)
    sort_by: Optional[str] = None
    sort_order: SortOrder = SortOrder.desc

    @model_validator(mode="after")
    def _validate(self) -> "FilterParams":
        if self.sort_by and self.sort_by not in SORTABLE_COLUMNS:
            allowed = ", ".join(sorted(SORTABLE_COLUMNS))
            raise ValueError(
                f"sort_by must be one of: {allowed}"
            )
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must be <= date_to")
        if (
            self.min_value is not None
            and self.max_value is not None
            and self.min_value > self.max_value
        ):
            raise ValueError("min_value must be <= max_value")
        if (
            self.min_quantity is not None
            and self.max_quantity is not None
            and self.min_quantity > self.max_quantity
        ):
            raise ValueError("min_quantity must be <= max_quantity")
        return self


# ---------------------------------------------------------------------------
# FastAPI dependency factory.
# ---------------------------------------------------------------------------
# Defining each query parameter explicitly here (rather than letting FastAPI
# introspect FilterParams) lets us give every filter its own docstring in the
# auto-generated Swagger UI.


def filter_params_dep(
    q: Annotated[Optional[str], Query(description="Free-text search across importer/exporter/supplier/buyer/product/HSN")] = None,
    importer: Annotated[Optional[str], Query(description="Substring match on Importer (case-insensitive)")] = None,
    exporter: Annotated[Optional[str], Query(description="Substring match on Exporter (case-insensitive)")] = None,
    supplier: Annotated[Optional[str], Query(description="Substring match on Supplier (case-insensitive)")] = None,
    buyer: Annotated[Optional[str], Query(description="Substring match on Buyer (case-insensitive)")] = None,
    hsn: Annotated[Optional[str], Query(description="HSN prefix match, e.g. '2901' or '29014300'")] = None,
    hs_chapter: Annotated[Optional[str], Query(description="Exact HS chapter, e.g. '29' or '3808'")] = None,
    country: Annotated[Optional[str], Query(description="Origin OR destination country (substring match)")] = None,
    origin_country: Annotated[Optional[str], Query(description="Origin country only")] = None,
    destination_country: Annotated[Optional[str], Query(description="Destination country only")] = None,
    port: Annotated[Optional[str], Query(description="Substring match on Port")] = None,
    trade_type: Annotated[Optional[TradeType], Query(description="IMPORT or EXPORT")] = None,
    reporting_country: Annotated[Optional[str], Query(description="Reporting country / customs feed, e.g. INDIA, VIETNAM, TURKEY")] = None,
    date_from: Annotated[Optional[date], Query(description="Inclusive lower bound on Date (YYYY-MM-DD)")] = None,
    date_to: Annotated[Optional[date], Query(description="Inclusive upper bound on Date (YYYY-MM-DD)")] = None,
    min_value: Annotated[Optional[float], Query(description="Minimum declared Value")] = None,
    max_value: Annotated[Optional[float], Query(description="Maximum declared Value")] = None,
    min_quantity: Annotated[Optional[float], Query(description="Minimum Quantity")] = None,
    max_quantity: Annotated[Optional[float], Query(description="Maximum Quantity")] = None,
    page: Annotated[int, Query(ge=1, description="1-indexed page number")] = 1,
    page_size: Annotated[Optional[int], Query(ge=1, le=1000, description="Rows per page (default from server config)")] = None,
    sort_by: Annotated[Optional[str], Query(description=f"Column to sort by — one of: {', '.join(sorted(SORTABLE_COLUMNS))}")] = None,
    sort_order: Annotated[SortOrder, Query(description="asc or desc")] = SortOrder.desc,
) -> FilterParams:
    settings = get_settings()
    effective_page_size = page_size or settings.default_page_size
    effective_page_size = min(effective_page_size, settings.max_page_size)
    return FilterParams(
        q=q,
        importer=importer,
        exporter=exporter,
        supplier=supplier,
        buyer=buyer,
        hsn=hsn,
        hs_chapter=hs_chapter,
        country=country,
        origin_country=origin_country,
        destination_country=destination_country,
        port=port,
        trade_type=trade_type,
        reporting_country=reporting_country,
        date_from=date_from,
        date_to=date_to,
        min_value=min_value,
        max_value=max_value,
        min_quantity=min_quantity,
        max_quantity=max_quantity,
        page=page,
        page_size=effective_page_size,
        sort_by=sort_by,
        sort_order=sort_order,
    )
