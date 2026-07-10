"""Tests for the advanced /api/query endpoints + the SQL builder itself.

Mix of unit tests (against ``build_where`` directly — fast, no DB) and
end-to-end smoke tests via the FastAPI TestClient.
"""

from __future__ import annotations

import pytest

from app.schemas.query import Condition, Group, Logic, Operator, QueryRequest
from app.services.query_builder import (
    QueryBuildError,
    build_where,
    explain_sql,
)


# ---------------------------------------------------------------------------
# Unit tests: SQL builder
# ---------------------------------------------------------------------------

def test_empty_root_yields_no_where():
    sql, params = build_where(None)
    assert sql == "" and params == []


def test_simple_equals():
    root = Group(
        conditions=[
            Condition(field="origin_country", operator=Operator.equals, value="Brazil"),
        ]
    )
    sql, params = build_where(root)
    # SQL handles case-folding via LOWER() on both sides — the param keeps
    # the original casing so audit logs remain readable.
    assert "LOWER(\"Origin Country\") = LOWER(?)" in sql
    assert sql.startswith("WHERE")
    assert params == ["Brazil"]


def test_contains_uses_ilike():
    root = Group(
        conditions=[
            Condition(field="importer", operator=Operator.contains, value="Bayer"),
        ]
    )
    sql, params = build_where(root)
    assert "\"Importer\" ILIKE ?" in sql
    assert params == ["%Bayer%"]


def test_or_inside_and_with_grouping_parens():
    """Example from the spec:
    (Importer contains 'Syngenta' OR Importer contains 'BASF') AND HSN = '3808'
    """
    root = Group(
        logic=Logic.AND,
        conditions=[
            Group(
                logic=Logic.OR,
                conditions=[
                    Condition(field="importer", operator=Operator.contains, value="Syngenta"),
                    Condition(field="importer", operator=Operator.contains, value="BASF"),
                ],
            ),
            Condition(field="hsn", operator=Operator.equals, value="3808"),
        ],
    )
    sql, params = build_where(root)
    # The OR group must be parenthesised inside the AND.
    assert " AND " in sql
    assert "(\"Importer\" ILIKE ? OR \"Importer\" ILIKE ?)" in sql
    assert params == ["%Syngenta%", "%BASF%", "3808"]


def test_negate_wraps_with_not():
    root = Group(
        conditions=[
            Condition(field="supplier", operator=Operator.contains, value="China", negate=True),
        ]
    )
    sql, _ = build_where(root)
    assert "NOT (\"Supplier\" ILIKE ?)" in sql


def test_between_two_values_required():
    root = Group(
        conditions=[
            Condition(field="value", operator=Operator.between, values=[1000.0, 5000.0]),
        ]
    )
    sql, params = build_where(root)
    assert "\"Value\" BETWEEN ? AND ?" in sql
    assert params == [1000.0, 5000.0]


def test_between_wrong_arity_rejected():
    root = Group(
        conditions=[
            Condition(field="value", operator=Operator.between, values=[1000.0]),
        ]
    )
    with pytest.raises(QueryBuildError):
        build_where(root)


def test_in_list_lowercases_text():
    root = Group(
        conditions=[
            Condition(field="origin_country", operator=Operator.in_list, values=["China", "India"]),
        ]
    )
    sql, params = build_where(root)
    assert "LOWER(\"Origin Country\") IN (?, ?)" in sql
    assert params == ["china", "india"]


def test_unknown_field_rejected():
    root = Group(
        conditions=[
            Condition(field="malicious; DROP TABLE shipments", operator=Operator.equals, value="x"),
        ]
    )
    with pytest.raises(QueryBuildError):
        build_where(root)


def test_invalid_operator_for_type_rejected():
    # `greater_than` on text is invalid.
    root = Group(
        conditions=[
            Condition(field="importer", operator=Operator.greater_than, value="x"),
        ]
    )
    with pytest.raises(QueryBuildError):
        build_where(root)


def test_is_empty_no_params():
    root = Group(
        conditions=[
            Condition(field="cha_name", operator=Operator.is_empty),
        ]
    )
    sql, params = build_where(root)
    assert "IS NULL OR" in sql
    assert params == []


def test_explain_sql_full_string():
    root = Group(
        conditions=[
            Condition(field="hs_chapter", operator=Operator.equals, value="29"),
        ]
    )
    sql, _ = explain_sql(root, base="shipments")
    assert sql.startswith("SELECT * FROM shipments WHERE")


# ---------------------------------------------------------------------------
# Endpoint smoke tests
# ---------------------------------------------------------------------------

def test_fields_endpoint(client):
    r = client.get("/api/query/fields")
    assert r.status_code == 200
    body = r.json()
    names = {f["name"] for f in body["fields"]}
    assert {"importer", "supplier", "hsn", "value"} <= names


def test_query_endpoint_simple(client):
    payload = {
        "where": {
            "type": "group", "logic": "AND",
            "conditions": [
                {"type": "condition", "field": "importer", "operator": "contains", "value": "reliance"},
            ],
        },
        "page": 1, "page_size": 3,
    }
    r = client.post("/api/query", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["total"] > 0
    for row in body["data"]:
        if row["Importer"]:
            assert "reliance" in row["Importer"].lower()


def test_query_endpoint_nested(client):
    """(Importer~Syngenta OR Importer~BASF) AND hs_chapter=3808"""
    payload = {
        "where": {
            "type": "group", "logic": "AND",
            "conditions": [
                {
                    "type": "group", "logic": "OR",
                    "conditions": [
                        {"type": "condition", "field": "importer", "operator": "contains", "value": "Syngenta"},
                        {"type": "condition", "field": "importer", "operator": "contains", "value": "BASF"},
                    ],
                },
                {"type": "condition", "field": "hs_chapter", "operator": "equals", "value": "3808"},
            ],
        },
        "page": 1, "page_size": 5,
    }
    r = client.post("/api/query", json=payload)
    assert r.status_code == 200
    body = r.json()
    for row in body["data"]:
        # Either Syngenta or BASF in importer
        imp = (row["Importer"] or "").lower()
        assert "syngenta" in imp or "basf" in imp
        # HS chapter constraint
        assert row["HS Chapter"] == "3808"


def test_query_explain_no_execution(client):
    payload = {
        "where": {
            "type": "group", "logic": "AND",
            "conditions": [
                {"type": "condition", "field": "value", "operator": "between", "values": [1e6, 1e7]},
            ],
        },
    }
    r = client.post("/api/query/explain", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert "BETWEEN" in body["sql"]
    assert body["params"] == [1_000_000.0, 10_000_000.0]


def test_query_bad_field_returns_400(client):
    payload = {
        "where": {
            "type": "group", "logic": "AND",
            "conditions": [
                {"type": "condition", "field": "nonexistent", "operator": "equals", "value": "x"},
            ],
        },
    }
    r = client.post("/api/query", json=payload)
    assert r.status_code == 400
    assert "Unknown field" in r.json()["detail"]
