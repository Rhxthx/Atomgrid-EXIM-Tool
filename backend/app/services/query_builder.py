"""Dynamic SQL generation for the advanced query builder.

Safety model
------------
Field names are looked up against a strict whitelist (``FIELDS``); operator
names against an enum.  **Values are always parameterised** — never
interpolated into the SQL string.  Combined, this makes the builder
SQL-injection-proof even with arbitrary user input.

The output dialect is DuckDB, but every construct we use (``ILIKE``,
``BETWEEN``, ``IN``, parameter placeholders) is identical in PostgreSQL,
so the same builder works unchanged if the DB ever swaps.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.models import quote_ident
from app.schemas.query import (
    Condition,
    FieldInfo,
    FieldType,
    Group,
    Logic,
    Operator,
)

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Field registry — the single source of truth for which columns the
# builder can touch and what operators make sense on each.
# ---------------------------------------------------------------------------

_TEXT_OPS = [
    Operator.contains,
    Operator.not_contains,
    Operator.equals,
    Operator.not_equals,
    Operator.starts_with,
    Operator.ends_with,
    Operator.in_list,
    Operator.not_in_list,
    Operator.is_empty,
    Operator.is_not_empty,
]
_NUMBER_OPS = [
    Operator.equals,
    Operator.not_equals,
    Operator.greater_than,
    Operator.less_than,
    Operator.greater_or_equal,
    Operator.less_or_equal,
    Operator.between,
    Operator.is_empty,
    Operator.is_not_empty,
]
_DATE_OPS = [
    Operator.equals,
    Operator.not_equals,
    Operator.greater_than,
    Operator.less_than,
    Operator.greater_or_equal,
    Operator.less_or_equal,
    Operator.between,
    Operator.is_empty,
    Operator.is_not_empty,
]
_ENUM_OPS = [
    Operator.equals,
    Operator.not_equals,
    Operator.in_list,
    Operator.not_in_list,
    Operator.is_empty,
    Operator.is_not_empty,
]


@dataclass(frozen=True)
class _Field:
    column: str
    label: str
    type: FieldType
    operators: list[Operator]
    enum_values: list[str] | None = None


# Public API field name (snake_case) → column metadata.  Update here when
# adding new searchable columns.
FIELDS: dict[str, _Field] = {
    "date":                _Field("Date",                "Date",                FieldType.date,   _DATE_OPS),
    "importer":            _Field("Importer",            "Importer",            FieldType.text,   _TEXT_OPS),
    "exporter":            _Field("Exporter",            "Exporter",            FieldType.text,   _TEXT_OPS),
    "supplier":            _Field("Supplier",            "Supplier",            FieldType.text,   _TEXT_OPS),
    "buyer":               _Field("Buyer",               "Buyer",               FieldType.text,   _TEXT_OPS),
    "hsn":                 _Field("HSN",                 "HSN",                 FieldType.text,   _TEXT_OPS),
    "hs_chapter":          _Field("HS Chapter",          "HS Chapter",          FieldType.text,   _TEXT_OPS),
    "iec":                 _Field("IEC",                 "IEC",                 FieldType.text,   _TEXT_OPS),
    "origin_country":      _Field("Origin Country",      "Origin Country",      FieldType.text,   _TEXT_OPS),
    "destination_country": _Field("Destination Country", "Destination Country", FieldType.text,   _TEXT_OPS),
    "port":                _Field("Port",                "Port",                FieldType.text,   _TEXT_OPS),
    "quantity":            _Field("Quantity",            "Quantity",            FieldType.number, _NUMBER_OPS),
    "value":               _Field("Value",               "Value (declared)",    FieldType.number, _NUMBER_OPS),
    "product_description": _Field("Product Description", "Product Description", FieldType.text,   _TEXT_OPS),
    "trade_type":          _Field("Trade Type",          "Trade Type",          FieldType.enum,   _ENUM_OPS, ["IMPORT", "EXPORT"]),
    "mode":                _Field("Mode",                "Mode of Shipment",    FieldType.text,   _TEXT_OPS),
    "city":                _Field("City",                "City",                FieldType.text,   _TEXT_OPS),
    "state":               _Field("State",               "State",               FieldType.text,   _TEXT_OPS),
    "cha_name":            _Field("CHA Name",            "CHA Name",            FieldType.text,   _TEXT_OPS),
    "currency":            _Field("Currency",            "Currency",            FieldType.text,   _TEXT_OPS),
    "unit":                _Field("Unit",                "Unit (UQC)",          FieldType.text,   _TEXT_OPS),
}


SORTABLE_API_FIELDS: frozenset[str] = frozenset(
    {"date", "importer", "exporter", "supplier", "buyer", "hsn", "value", "quantity",
     "origin_country", "destination_country", "trade_type", "hs_chapter"}
)


def list_fields() -> list[FieldInfo]:
    """Used by GET /api/query/fields to populate the UI dropdowns."""
    out: list[FieldInfo] = []
    for name, f in FIELDS.items():
        out.append(
            FieldInfo(
                name=name,
                label=f.label,
                type=f.type,
                operators=f.operators,
                enum_values=f.enum_values,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Build SQL from a Group tree.
# ---------------------------------------------------------------------------

class QueryBuildError(ValueError):
    """Raised when the request references an unknown field or invalid operator."""


def build_where(root: Group | None) -> tuple[str, list[Any]]:
    """Return ``(where_sql, params)`` for the root group.

    ``where_sql`` includes the leading ``WHERE``; empty string if the
    root is None or contains no conditions.
    """
    if root is None:
        return "", []
    fragment, params = _node_sql(root)
    if not fragment.strip():
        return "", []
    return "WHERE " + fragment, params


def explain_sql(root: Group | None, *, base: str = "<base>") -> tuple[str, list[Any]]:
    """Render a human-readable SQL preview, with values still bound as
    placeholders to make injection risk obvious.  Used by /explain.
    """
    where, params = build_where(root)
    sql = f"SELECT * FROM {base} {where}".strip()
    return sql, params


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _node_sql(node: Group | Condition) -> tuple[str, list[Any]]:
    if isinstance(node, Condition):
        return _condition_sql(node)
    return _group_sql(node)


def _group_sql(g: Group) -> tuple[str, list[Any]]:
    if not g.conditions:
        return "", []

    parts: list[str] = []
    params: list[Any] = []
    for child in g.conditions:
        frag, p = _node_sql(child)
        if not frag.strip():
            continue
        parts.append(f"({frag})" if isinstance(child, Group) else frag)
        params.extend(p)

    if not parts:
        return "", []

    join = f" {g.logic.value} "
    fragment = join.join(parts)
    if g.negate:
        fragment = f"NOT ({fragment})"
    return fragment, params


def _condition_sql(c: Condition) -> tuple[str, list[Any]]:
    field = FIELDS.get(c.field)
    if field is None:
        raise QueryBuildError(f"Unknown field: {c.field!r}")
    if c.operator not in field.operators:
        raise QueryBuildError(
            f"Operator {c.operator.value!r} is not valid for field "
            f"{c.field!r} (type {field.type.value})"
        )

    col = quote_ident(field.column)
    op = c.operator

    # ----- operators that take no value -----------------------------------
    if op == Operator.is_empty:
        sql = _empty_sql(col, field.type, empty=True)
        return _wrap(sql, [], c.negate)
    if op == Operator.is_not_empty:
        sql = _empty_sql(col, field.type, empty=False)
        return _wrap(sql, [], c.negate)

    # ----- operators that take a list -------------------------------------
    if op in (Operator.in_list, Operator.not_in_list):
        items = c.values or []
        if not items:
            raise QueryBuildError(f"{op.value} requires a non-empty values list")
        placeholders = ", ".join(["?"] * len(items))
        verb = "IN" if op == Operator.in_list else "NOT IN"
        # IN/NOT IN comparisons are case-sensitive by default; for text we
        # lower-case both sides so users don't have to match the upper-case
        # canonicalisation we do at ingest.
        if field.type in (FieldType.text, FieldType.enum):
            sql = f"LOWER({col}) {verb} ({placeholders})"
            params = [_coerce(v, field.type, lower=True) for v in items]
        else:
            sql = f"{col} {verb} ({placeholders})"
            params = [_coerce(v, field.type) for v in items]
        return _wrap(sql, params, c.negate)

    if op == Operator.between:
        items = c.values or []
        if len(items) != 2:
            raise QueryBuildError("between requires exactly 2 values")
        sql = f"{col} BETWEEN ? AND ?"
        params = [_coerce(items[0], field.type), _coerce(items[1], field.type)]
        return _wrap(sql, params, c.negate)

    # ----- single-value operators -----------------------------------------
    if c.value is None:
        raise QueryBuildError(f"{op.value} requires a value")

    if op == Operator.contains:
        sql = f"{col} ILIKE ?"
        params = [f"%{c.value}%"]
    elif op == Operator.not_contains:
        sql = f"{col} NOT ILIKE ?"
        params = [f"%{c.value}%"]
    elif op == Operator.starts_with:
        sql = f"{col} ILIKE ?"
        params = [f"{c.value}%"]
    elif op == Operator.ends_with:
        sql = f"{col} ILIKE ?"
        params = [f"%{c.value}"]
    elif op == Operator.equals:
        if field.type in (FieldType.text, FieldType.enum):
            # Case-insensitive exact match — friendlier than = which would
            # require the user to type "RELIANCE INDUSTRIES LIMITED".
            sql = f"LOWER({col}) = LOWER(?)"
            params = [_coerce(c.value, field.type)]
        else:
            sql = f"{col} = ?"
            params = [_coerce(c.value, field.type)]
    elif op == Operator.not_equals:
        if field.type in (FieldType.text, FieldType.enum):
            sql = f"LOWER({col}) <> LOWER(?)"
            params = [_coerce(c.value, field.type)]
        else:
            sql = f"{col} <> ?"
            params = [_coerce(c.value, field.type)]
    elif op == Operator.greater_than:
        sql = f"{col} > ?"
        params = [_coerce(c.value, field.type)]
    elif op == Operator.less_than:
        sql = f"{col} < ?"
        params = [_coerce(c.value, field.type)]
    elif op == Operator.greater_or_equal:
        sql = f"{col} >= ?"
        params = [_coerce(c.value, field.type)]
    elif op == Operator.less_or_equal:
        sql = f"{col} <= ?"
        params = [_coerce(c.value, field.type)]
    else:  # pragma: no cover — exhaustive
        raise QueryBuildError(f"Unhandled operator: {op}")

    return _wrap(sql, params, c.negate)


def _empty_sql(col: str, ftype: FieldType, *, empty: bool) -> str:
    # For text columns we treat "" as empty too — matches the user's
    # mental model better than strict NULL.
    if ftype in (FieldType.text, FieldType.enum):
        if empty:
            return f"({col} IS NULL OR {col} = '')"
        return f"({col} IS NOT NULL AND {col} <> '')"
    return f"{col} IS {'NULL' if empty else 'NOT NULL'}"


def _coerce(v: Any, ftype: FieldType, *, lower: bool = False) -> Any:
    """Pre-coerce the user-supplied value to a Python type DuckDB will
    bind cleanly (DuckDB also accepts strings for dates / numbers, but
    explicit is safer)."""
    if v is None:
        return None
    if ftype == FieldType.number:
        return float(v)
    if ftype in (FieldType.text, FieldType.enum):
        s = str(v)
        return s.lower() if lower else s
    # date: pass through — pydantic already parsed it
    return v


def _wrap(sql: str, params: list[Any], negate: bool) -> tuple[str, list[Any]]:
    if negate:
        return f"NOT ({sql})", params
    return sql, params
