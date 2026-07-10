"""Shipment table contract.

Everything that references column names goes through these constants so a
schema rename can be made in one place.  Column names contain spaces and
slashes, hence the explicit ``quote_ident``.
"""

from __future__ import annotations

TABLE = "shipments"

# The full canonical schema produced by Phase 1.  Order matches the Parquet
# / DuckDB layout for nicer SELECT * output.
SHIPMENT_COLUMNS: tuple[str, ...] = (
    "Date",
    "Importer",
    "Exporter",
    "Supplier",
    "Buyer",
    "HSN",
    "Country",
    "Port",
    "Quantity",
    "Unit",
    "Value",
    "Unit Price USD",
    "Currency",
    "Product Description",
    "Origin Country",
    "Destination Country",
    "Trade Type",
    "Reporting Country",
    "HS Chapter",
    "IEC",
    "BE/SB Number",
    "CHA Name",
    "Importer Address",
    "Exporter Address",
    "Supplier Address",
    "Buyer Address",
    "City",
    "State",
    "Mode",
    "Source File",
)

# Columns the user is allowed to ORDER BY.  Whitelisting prevents SQL
# injection via the ``sort_by`` query parameter.
SORTABLE_COLUMNS: frozenset[str] = frozenset(
    {
        "Date",
        "Importer",
        "Exporter",
        "Supplier",
        "Buyer",
        "HSN",
        "Quantity",
        "Value",
        "Unit Price USD",
        "Origin Country",
        "Destination Country",
        "Trade Type",
        "Reporting Country",
        "HS Chapter",
    }
)

# Columns scanned by the global ``/search?q=`` endpoint.  Order matters only
# for OR-clause readability in EXPLAIN plans.
SEARCHABLE_TEXT_COLUMNS: tuple[str, ...] = (
    "Importer",
    "Exporter",
    "Supplier",
    "Buyer",
    "Product Description",
    "HSN",
)

# Entity columns used by /top-*, /suggest, /similar.
PARTY_COLUMNS: frozenset[str] = frozenset(
    {"Importer", "Exporter", "Supplier", "Buyer"}
)


def quote_ident(name: str) -> str:
    """Wrap a column name in double quotes, escaping any embedded quotes.

    DuckDB / ANSI SQL: a double quote inside an identifier is escaped by
    doubling it.  Necessary because columns like ``BE/SB Number`` contain
    a slash + space and ``Product Description`` contains a space.
    """
    return '"' + name.replace('"', '""') + '"'
