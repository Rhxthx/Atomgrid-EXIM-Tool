# EXIM Trade Intelligence API — Phase 2

FastAPI-based read-only search and analytics layer on top of the Phase 1
DuckDB.  Production-ready, fully documented through OpenAPI / Swagger UI,
and built to scale to crore-row datasets.

> **Scope.** REST APIs only. No frontend / no AI querying — those are
> later phases. Phase 1 (ingestion → DuckDB) must be completed first.

## What it provides

| Capability | Endpoints |
|---|---|
| **Search** | `/search`, `/shipments`, `/importer`, `/exporter`, `/supplier`, `/buyer`, `/hsn`, `/country`, `/product` |
| **Analytics** | `/top-importers`, `/top-exporters`, `/top-suppliers`, `/top-buyers`, `/trends/monthly`, `/country-analysis`, `/hsn-analysis` |
| **Advanced** | `/suggest`, `/similar`, `/duplicates`, `/keywords`, `/supplier-concentration` |
| **Meta** | `/`, `/health`, `/stats`, `/docs` (Swagger) |

Every list endpoint shares the same **`FilterParams`** dependency — so
date-range, country, HSN, value-range, trade-type and pagination work
*everywhere*. There's a single WHERE-clause builder ([app/services/search.py](app/services/search.py))
so adding a filter once exposes it on every route.

## Quick start

```powershell
# from project root, after Phase 1 has built output/trade_database.duckdb
cd backend
pip install -r requirements.txt
python main.py
# or with auto-reload
python -m uvicorn main:app --reload --port 8000
```

Open [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) for the
interactive Swagger UI.

## Configuration

Environment variables (`.env` in `backend/` also works):

| Variable | Default | Description |
|---|---|---|
| `EXIM_DUCKDB_PATH` | `../output/trade_database.duckdb` | Path to the DuckDB built by Phase 1 |
| `EXIM_LOG_DIR` | `./logs` | Log directory |
| `EXIM_DEFAULT_PAGE_SIZE` | `50` | Default page size |
| `EXIM_MAX_PAGE_SIZE` | `500` | Hard ceiling for `page_size` |
| `EXIM_ALLOW_ORIGINS` | `*` | Comma-separated CORS origins |
| `EXIM_DISTINCT_CACHE_TTL` | `600` | TTL (s) for `/similar` distinct-name cache |
| `EXIM_HOST` | `127.0.0.1` | Server bind host |
| `EXIM_PORT` | `8000` | Server port |
| `EXIM_RELOAD` | `false` | Set `true` for uvicorn `--reload` |

## Project layout

```
backend/
├── app/
│   ├── config/         # Pydantic Settings (env-driven)
│   ├── database/       # DuckDB client (read-only, cursor-per-request)
│   ├── models/         # Schema constants + identifier quoting
│   ├── schemas/        # Pydantic request/response models
│   │   ├── filters.py      # FilterParams + FastAPI dependency
│   │   ├── responses.py    # Shipment + Paginated envelope
│   │   └── analytics.py    # Top / Trend / Country / HSN / etc.
│   ├── services/       # Pure data-access — no FastAPI imports
│   │   ├── search.py        # WHERE-builder + list_shipments
│   │   ├── analytics.py     # Top + Trends + Country + HSN
│   │   ├── suggest.py       # Autosuggest + similar-company (fuzzy)
│   │   └── advanced.py      # Duplicates, concentration, keywords
│   ├── api/
│   │   ├── deps.py     # FastAPI dependency wiring
│   │   └── routers/
│   │       ├── meta.py
│   │       ├── search.py
│   │       ├── analytics.py
│   │       └── advanced.py
│   ├── utils/          # Logging, timing
│   └── factory.py      # create_app()
├── logs/
├── tests/
│   ├── conftest.py
│   └── test_endpoints.py
├── main.py
├── requirements.txt
└── README.md
```

## Filtering — works on every list endpoint

All these can combine on `/search`, `/shipments`, `/top-*`, `/trends/monthly`,
`/country-analysis`, `/hsn-analysis`, `/duplicates`, `/keywords`:

| Param | Behaviour |
|---|---|
| `q` | OR'd ILIKE across Importer/Exporter/Supplier/Buyer/Product Description/HSN |
| `importer` / `exporter` / `supplier` / `buyer` | Substring ILIKE |
| `hsn` | Prefix match (`hsn=29` matches all `29*`) |
| `hs_chapter` | Exact match (`29` or `3808`) |
| `country` | Substring across Origin + Destination + Country |
| `origin_country` / `destination_country` | Substring on the named column |
| `port` | Substring ILIKE |
| `trade_type` | `IMPORT` or `EXPORT` |
| `date_from` / `date_to` | Inclusive ISO date bounds |
| `min_value` / `max_value` | Numeric range on declared Value |
| `min_quantity` / `max_quantity` | Numeric range on Quantity |
| `page`, `page_size` | 1-indexed pagination (page_size capped by `EXIM_MAX_PAGE_SIZE`) |
| `sort_by`, `sort_order` | Whitelisted column + `asc`/`desc` |

`sort_by` is whitelisted — anything outside the allowed list returns 422.

## Example requests

```bash
# Free-text global search
curl "http://127.0.0.1:8000/search?q=bayer&page_size=5"

# Filter combination — Q1 2026 chapter-29 imports above ₹1cr
curl "http://127.0.0.1:8000/search?trade_type=IMPORT&hs_chapter=29&min_value=10000000&date_from=2026-01-01&date_to=2026-03-31"

# Search by importer name (substring)
curl "http://127.0.0.1:8000/importer?name=syngenta"

# By HSN prefix
curl "http://127.0.0.1:8000/hsn?code=3808"

# Top 10 importers, scoped to a country
curl "http://127.0.0.1:8000/top-importers?limit=10&origin_country=germany"

# Monthly trend split by trade type
curl "http://127.0.0.1:8000/trends/monthly?group_by=Trade%20Type"

# Country roll-up
curl "http://127.0.0.1:8000/country-analysis?limit=20"

# HSN roll-up with top counterparty per HSN
curl "http://127.0.0.1:8000/hsn-analysis?hs_chapter=29&limit=10"

# Autosuggest as the user types
curl "http://127.0.0.1:8000/suggest?field=Importer&q=relian"

# Find similar company spellings (handles typos / variations)
curl "http://127.0.0.1:8000/similar?name=Relianse%20Industries&field=Importer"

# Duplicate shipment groups
curl "http://127.0.0.1:8000/duplicates?min_occurrences=3&limit=20"

# Product keyword cloud
curl "http://127.0.0.1:8000/keywords?hsn=2901&limit=30"

# Per-importer supplier concentration (HHI)
curl "http://127.0.0.1:8000/supplier-concentration?importer=reliance"

# Dataset overview
curl "http://127.0.0.1:8000/stats"
```

## Example response

```json
{
  "meta": {
    "total": 1284,
    "page": 1,
    "page_size": 50,
    "total_pages": 26,
    "query_ms": 18.4,
    "filters_applied": { "trade_type": "IMPORT", "hs_chapter": "29" }
  },
  "data": [
    {
      "Date": "2026-02-12",
      "Importer": "RELIANCE INDUSTRIES LIMITED",
      "Supplier": "BASF SE",
      "HSN": "29336100",
      "Origin Country": "GERMANY",
      "Quantity": 8000.0, "Unit": "KGS",
      "Value": 7350421.55, "Currency": "USD",
      "Product Description": "MELAMINE — TECH GRADE — ...",
      "Trade Type": "IMPORT", "HS Chapter": "29",
      "BE/SB Number": "...", "Source File": "29 ALL PORT IMPORT FEB 2026.xlsx"
    }
  ]
}
```

## Running tests

```powershell
cd backend
pytest -v
```

Tests use FastAPI's `TestClient` against the **live DuckDB** built by
Phase 1.  They auto-skip if the DB file isn't present.

## Performance notes

- **Read-only connection.** DuckDB is opened with `read_only=True`,
  which lets the OS share the file and lets us hand out one cursor per
  request safely.
- **Indexes.** Phase 1 created indexes on Importer / Exporter / Supplier
  / Buyer / HSN / Origin / Destination / Trade Type / Date — all the
  columns we filter on.
- **Two-pass paginated queries.** Every list endpoint runs a `COUNT(*)`
  and a `LIMIT/OFFSET` SELECT, both using identical WHERE clauses so the
  optimizer can reuse zone-maps.
- **Distinct-name cache** for `/similar` — distinct importer/exporter
  lists are loaded once and cached for `EXIM_DISTINCT_CACHE_TTL` seconds.
- **No N+1.** Aggregation endpoints (top-N, country / HSN analysis,
  trends, concentration) are all single-query.
- **Async.** Endpoints are defined as sync `def`s on purpose — FastAPI
  runs them in a thread pool, which is the correct pattern for
  synchronous CPU-bound DuckDB calls.

Observed timings on the 672k-row Phase 1 dataset (laptop SSD):

| Endpoint | p50 |
|---|---|
| `/search?q=...` | 10–40 ms |
| `/top-importers` | 30–80 ms |
| `/trends/monthly` | 30–60 ms |
| `/similar` (cache cold) | 80–150 ms |
| `/similar` (cache warm) | 5–15 ms |
| `/keywords` (sample 100k) | 200–400 ms |

Expect roughly linear scaling for filtered queries; aggregation
endpoints stay sub-second well past 10M rows.

## Future integration

- **Frontend.** Stable JSON shapes + OpenAPI schema means
  auto-generation works (e.g. `openapi-typescript-codegen`, `orval`).
  CORS is wide-open by default; restrict via `EXIM_ALLOW_ORIGINS` in
  production.
- **Auth.** Add a FastAPI dependency (`Depends(verify_token)`) at router
  inclusion in `factory.py` — single point of change.
- **AI querying.** Layer an LLM-to-SQL service on top of `services/`
  (the WHERE-clause builder is already a clean text-to-filter target).
- **Incremental refresh.** Re-running Phase 1 rebuilds the DuckDB; the
  service can either be restarted or open the file on each request
  (one-line change in `database/duckdb_client.py`).
- **Caching.** A reverse-proxy cache (Varnish / Cloudflare / nginx)
  in front of `/top-*`, `/stats`, `/country-analysis` is the
  cheapest scale-out for hot dashboards.
