"""Schemas for analytics, advanced features and stats endpoints."""

from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field

from .responses import Meta


class TopEntity(BaseModel):
    name: str
    shipments: int
    total_value: Optional[float] = None
    total_quantity: Optional[float] = None


class TopEntitiesResponse(BaseModel):
    meta: Meta
    entity_type: str = Field(description="One of: Importer, Exporter, Supplier, Buyer")
    data: list[TopEntity]


class TrendBucket(BaseModel):
    month: date
    shipments: int
    total_value: Optional[float] = None
    total_quantity: Optional[float] = None


class MonthlyTrendResponse(BaseModel):
    meta: Meta
    group_by: list[str] = Field(default_factory=list)
    data: list[TrendBucket]


class CountryAnalysisRow(BaseModel):
    country: Optional[str] = None
    trade_type: Optional[str] = None
    shipments: int
    total_value: Optional[float] = None
    total_quantity: Optional[float] = None
    unique_importers: int = 0
    unique_exporters: int = 0


class CountryAnalysisResponse(BaseModel):
    meta: Meta
    data: list[CountryAnalysisRow]


class HSNAnalysisRow(BaseModel):
    hsn: Optional[str] = None
    hs_chapter: Optional[str] = None
    trade_type: Optional[str] = None
    shipments: int
    total_value: Optional[float] = None
    total_quantity: Optional[float] = None
    top_importer: Optional[str] = None
    top_exporter: Optional[str] = None


class HSNAnalysisResponse(BaseModel):
    meta: Meta
    data: list[HSNAnalysisRow]


class SuggestionResponse(BaseModel):
    field: str
    query: str
    suggestions: list[str]
    query_ms: float


class SimilarMatch(BaseModel):
    name: str
    score: int
    shipments: int


class SimilarResponse(BaseModel):
    field: str
    query: str
    matches: list[SimilarMatch]
    query_ms: float


class DuplicateGroup(BaseModel):
    key: dict
    occurrences: int
    source_files: list[str]


class DuplicateResponse(BaseModel):
    meta: Meta
    data: list[DuplicateGroup]


class KeywordRow(BaseModel):
    keyword: str
    occurrences: int


class KeywordResponse(BaseModel):
    meta: Meta
    keywords: list[KeywordRow]


class SupplierConcentrationRow(BaseModel):
    supplier: Optional[str] = None
    shipments: int
    total_value: Optional[float] = None
    share_pct: float


class SupplierConcentrationResponse(BaseModel):
    importer: str
    total_suppliers: int
    total_value: Optional[float] = None
    hhi: float = Field(description="Herfindahl-Hirschman Index of supplier concentration (0–10000)")
    top_suppliers: list[SupplierConcentrationRow]
    query_ms: float


class MarketCoverage(BaseModel):
    """Row count + available date span for one reporting-country market."""
    rows: int
    date_min: Optional[date] = None
    date_max: Optional[date] = None


class DatasetStats(BaseModel):
    total_rows: int
    date_min: Optional[date] = None
    date_max: Optional[date] = None
    distinct_importers: int
    distinct_exporters: int
    distinct_suppliers: int
    distinct_hsn: int
    distinct_countries: int
    trade_types: dict[str, int]
    hs_chapters: dict[str, int]
    reporting_countries: dict[str, int] = {}
    market_coverage: dict[str, MarketCoverage] = {}
    # Rows a non-admin user may export at once (admins are unlimited). Lets the
    # UI show the right limit without hardcoding it.
    user_export_cap: int = 50
    duckdb_path: str
    query_ms: float
