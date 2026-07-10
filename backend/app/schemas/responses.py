"""Generic response envelopes."""

from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class Meta(BaseModel):
    """Pagination + timing metadata returned with every list endpoint."""
    total: int = Field(description="Total matching rows before pagination")
    page: int
    page_size: int
    total_pages: int
    query_ms: float = Field(description="Server-side query execution time in milliseconds")
    filters_applied: dict = Field(default_factory=dict)


class ShipmentRecord(BaseModel):
    """One row from the shipments table.  All fields optional — source data
    is heterogeneous and any single file may omit any single column.
    """
    Date: Optional[date] = None
    Importer: Optional[str] = None
    Exporter: Optional[str] = None
    Supplier: Optional[str] = None
    Buyer: Optional[str] = None
    HSN: Optional[str] = None
    Country: Optional[str] = None
    Port: Optional[str] = None
    Quantity: Optional[float] = None
    Unit: Optional[str] = None
    Value: Optional[float] = None
    Unit_Price_USD: Optional[float] = Field(default=None, alias="Unit Price USD")
    Currency: Optional[str] = None
    Product_Description: Optional[str] = Field(default=None, alias="Product Description")
    Origin_Country: Optional[str] = Field(default=None, alias="Origin Country")
    Destination_Country: Optional[str] = Field(default=None, alias="Destination Country")
    Trade_Type: Optional[str] = Field(default=None, alias="Trade Type")
    Reporting_Country: Optional[str] = Field(default=None, alias="Reporting Country")
    HS_Chapter: Optional[str] = Field(default=None, alias="HS Chapter")
    IEC: Optional[str] = None
    BE_SB_Number: Optional[str] = Field(default=None, alias="BE/SB Number")
    CHA_Name: Optional[str] = Field(default=None, alias="CHA Name")
    Importer_Address: Optional[str] = Field(default=None, alias="Importer Address")
    Exporter_Address: Optional[str] = Field(default=None, alias="Exporter Address")
    Supplier_Address: Optional[str] = Field(default=None, alias="Supplier Address")
    Buyer_Address: Optional[str] = Field(default=None, alias="Buyer Address")
    City: Optional[str] = None
    State: Optional[str] = None
    Mode: Optional[str] = None
    Source_File: Optional[str] = Field(default=None, alias="Source File")

    model_config = {"populate_by_name": True}


class PaginatedShipments(BaseModel):
    meta: Meta
    data: list[ShipmentRecord]


class ErrorResponse(BaseModel):
    detail: str
    code: Optional[str] = None
