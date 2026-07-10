"""Smoke tests against the live DuckDB.

Each test runs in well under a second on the current 672k-row dataset
and validates that the SQL shapes return what the schemas expect.

All routes live under ``/api`` so the SPA can share the FastAPI origin
in production (Cloudflare Tunnel deployment).
"""

from __future__ import annotations


def test_root(client):
    # FastAPI redirects /api → /api/ — accept both.
    r = client.get("/api/", follow_redirects=True)
    assert r.status_code == 200
    body = r.json()
    assert body["service"].startswith("EXIM")
    assert "endpoints" in body


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["rows"] > 0


def test_stats(client):
    r = client.get("/api/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["total_rows"] > 0
    assert body["distinct_importers"] > 0
    assert "IMPORT" in body["trade_types"] or "EXPORT" in body["trade_types"]


def test_search_basic(client):
    r = client.get("/api/search", params={"q": "reliance", "page_size": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["query_ms"] >= 0
    assert body["meta"]["total"] > 0
    assert len(body["data"]) <= 5


def test_search_filters_combine(client):
    r = client.get(
        "/api/search",
        params={
            "trade_type": "IMPORT",
            "hs_chapter": "29",
            "min_value": 1_000_000,
            "page_size": 5,
        },
    )
    assert r.status_code == 200
    body = r.json()
    for row in body["data"]:
        assert row["Trade Type"] == "IMPORT"
        assert row["HS Chapter"] == "29"
        if row["Value"] is not None:
            assert row["Value"] >= 1_000_000


def test_search_pagination(client):
    p1 = client.get("/api/search", params={"page": 1, "page_size": 3}).json()
    p2 = client.get("/api/search", params={"page": 2, "page_size": 3}).json()
    assert p1["meta"]["total"] == p2["meta"]["total"]
    assert len(p1["data"]) == 3 and len(p2["data"]) == 3
    assert p1["data"][0] != p2["data"][0]


def test_invalid_sort_by_rejected(client):
    """Bad sort_by must be rejected before SQL execution.

    400 (semantic) via our ValueError handler, or 422 (FastAPI native
    validation) — both are defensible client errors.
    """
    r = client.get("/api/search", params={"sort_by": "DROP TABLE shipments"})
    assert r.status_code in {400, 422}


def test_by_importer(client):
    r = client.get("/api/importer", params={"name": "reliance", "page_size": 3})
    assert r.status_code == 200
    for row in r.json()["data"]:
        if row["Importer"]:
            assert "reliance" in row["Importer"].lower()


def test_by_hsn(client):
    r = client.get("/api/hsn", params={"code": "3808", "page_size": 3})
    assert r.status_code == 200
    for row in r.json()["data"]:
        if row["HSN"]:
            assert row["HSN"].startswith("3808")


def test_top_importers(client):
    r = client.get("/api/top-importers", params={"limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["entity_type"] == "Importer"
    assert len(body["data"]) <= 5
    values = [d["total_value"] for d in body["data"] if d["total_value"] is not None]
    assert values == sorted(values, reverse=True)


def test_trends_monthly(client):
    r = client.get("/api/trends/monthly", params={"trade_type": "IMPORT"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data) > 0
    for bucket in data:
        assert bucket["month"]
        assert bucket["shipments"] >= 0


def test_country_analysis(client):
    r = client.get("/api/country-analysis", params={"limit": 5})
    assert r.status_code == 200
    assert len(r.json()["data"]) > 0


def test_hsn_analysis(client):
    r = client.get("/api/hsn-analysis", params={"hs_chapter": "29", "limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert len(body["data"]) <= 5
    for row in body["data"]:
        assert row["hsn"]


def test_suggest(client):
    r = client.get("/api/suggest", params={"field": "Importer", "q": "re"})
    assert r.status_code == 200
    body = r.json()
    assert body["field"] == "Importer"
    assert isinstance(body["suggestions"], list)


def test_similar(client):
    r = client.get("/api/similar", params={"name": "relianse", "field": "Importer"})
    assert r.status_code == 200
    matches = r.json()["matches"]
    assert any("reliance" in m["name"].lower() for m in matches)


def test_supplier_concentration(client):
    top = client.get("/api/top-importers", params={"limit": 1}).json()["data"]
    if not top:
        return
    importer = top[0]["name"]
    r = client.get("/api/supplier-concentration", params={"importer": importer})
    assert r.status_code == 200
    body = r.json()
    assert body["total_suppliers"] >= 0
    assert 0 <= body["hhi"] <= 10001


def test_keywords(client):
    r = client.get("/api/keywords", params={"limit": 10, "sample_size": 5000})
    assert r.status_code == 200
    body = r.json()
    assert len(body["keywords"]) > 0


def test_duplicates(client):
    r = client.get("/api/duplicates", params={"min_occurrences": 2, "limit": 5})
    assert r.status_code == 200


def test_spa_fallback_serves_index(client):
    """When frontend/dist exists, hitting an arbitrary SPA path returns
    index.html so client-side routing works after a hard refresh.  Test
    is conditional — passes through if the frontend hasn't been built yet.
    """
    from pathlib import Path
    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist" / "index.html"
    if not dist.exists():
        return
    r = client.get("/shipments")
    assert r.status_code == 200
    assert r.text.lstrip().startswith("<!doctype html>")
