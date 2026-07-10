# EXIM Data Merge — Phase 1

Production-grade ETL pipeline that reads heterogeneous Indian trade
(EXIM) extracts from Excel/CSV, normalises them onto a single schema,
and lands the merged dataset in **DuckDB + Parquet** ready for ad-hoc
SQL analysis.

> **Scope.** Phase 1 covers ingestion → standardisation → merge → storage
> only. Dashboards, auth, analytics, and AI-querying come in later phases.

## What it does

1. Scans a folder for `.xlsx`, `.xls`, `.csv` files
2. Detects column schema per file (4 distinct shapes already seen in the
   sample data — HSN 29 and HSN 3808, imports & exports, port-level vs
   world-level)
3. Maps every source header onto a canonical schema via
   `config/column_mapping.json` (exact + fuzzy fallback)
4. Cleans: trims, null-sentinels (`N/A`, `Null`), country aliases,
   typed dates & numerics, per-file dedupe
5. Writes a per-file Parquet shard under `output/_shards/` so peak RAM
   never exceeds one file's working set
6. DuckDB concatenates the shards, dedupes cross-file on a deterministic
   key, and builds indexes for fast lookups
7. Exports `merged_data.parquet`, `merged_data_sample.csv`,
   `column_mapping_report.xlsx`, and `example_queries.sql`

## Canonical schema (28 columns)

```
Date, Importer, Exporter, Supplier, Buyer, HSN, Country, Port,
Quantity, Unit, Value, Currency, Product Description,
Origin Country, Destination Country,
Trade Type, HS Chapter, IEC, BE/SB Number, CHA Name,
Importer Address, Exporter Address, Supplier Address, Buyer Address,
City, State, Mode, Source File
```

The first 15 columns are exactly what the spec calls for. The remaining
13 preserve high-value detail (counterparty addresses, IEC, mode, etc.)
that's available in most source files and would otherwise be lost.

## Project layout

```
EXIM Data Merge/
├── config/
│   └── column_mapping.json     # source-header → canonical-column mapping
├── data/                       # default source folder (override with --source)
├── logs/
│   ├── processing_log.txt      # full run trace + summary
│   └── error_report.txt        # warnings/errors only
├── output/
│   ├── merged_data.parquet
│   ├── merged_data_sample.csv
│   ├── trade_database.duckdb
│   ├── column_mapping_report.xlsx
│   └── example_queries.sql
├── scripts/
│   ├── utils.py                # logging, header normaliser, fuzzy, country aliases
│   ├── file_loader.py          # folder scan + Calamine/openpyxl/CSV loader
│   ├── schema_mapper.py        # apply config mappings → canonical schema
│   ├── data_cleaner.py         # trim, type-coerce, dedupe, country normalise
│   ├── merger.py               # per-file orchestration → Parquet shard
│   └── duckdb_writer.py        # shards → DuckDB table + indexes + exports
├── main.py                     # CLI entry point
├── requirements.txt
└── README.md
```

## Installation

```powershell
# (recommended) create a virtualenv
python -m venv .venv
.\.venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

Python 3.11+ is required (Polars LazyFrame + Calamine engine).

## How to run

Default — assumes source files in `./data`:

```powershell
python main.py
```

Pointing at the original source folder:

```powershell
python main.py --source "E:\Atomgrid\EXIM India"
```

Smoke test on the first 2 files only:

```powershell
python main.py --source "E:\Atomgrid\EXIM India" --limit 2
```

All flags:

```
--source PATH        Folder of input files       (default: ./data)
--config PATH        column_mapping.json path    (default: ./config/column_mapping.json)
--output PATH        Output directory            (default: ./output)
--logs PATH          Log directory               (default: ./logs)
--limit N            Process only first N files  (0 = all)
--keep-shards        Keep per-file parquet shards after DB build
--verbose            DEBUG logging
```

## Example outputs

```
output/
├── merged_data.parquet            # consolidated dataset (zstd)
├── merged_data_sample.csv         # first 1 000 rows for human eyeballing
├── trade_database.duckdb          # indexed master table 'shipments'
├── column_mapping_report.xlsx     # one row per (file, source col) decision
└── example_queries.sql            # ready-to-run analytical queries
```

Open the DuckDB from the CLI:

```powershell
duckdb output\trade_database.duckdb
```

Then run, for example:

```sql
SELECT "Importer", COUNT(*) AS shipments, SUM("Value") AS total_value
FROM shipments
WHERE "Trade Type" = 'IMPORT'
GROUP BY 1
ORDER BY total_value DESC
LIMIT 20;
```

More examples in [output/example_queries.sql](output/example_queries.sql).

## Extending the column mapping

Edit `config/column_mapping.json`:

- **`mappings`** — `"normalised_source_header": "Canonical Column"`. Keys
  are the source header lower-cased with non-alphanumerics stripped, so
  `BE_Date`, `BE Date`, `bedate` all use the key `bedate`.
- **`merge_groups`** — when a target column needs to be assembled from
  several source columns (multi-line addresses), list the source keys
  here. Non-null parts are joined with `" | "`.
- **`ignore`** — explicitly drop these source columns silently
  (otherwise they'd surface in the mapping report as `unmapped`).

A fuzzy fallback (RapidFuzz, WRatio ≥ 88) handles minor typos like
`PRODUCTDESCRIPITION`. Every decision is logged in the
`column_mapping_report.xlsx`, so the way to extend the config is:

1. Run the pipeline
2. Open the report, filter `strategy = unmapped` or `strategy = fuzzy`
3. Add explicit entries to `mappings` / `merge_groups` / `ignore`
4. Re-run

## Performance notes

- **Reader** — Polars + Calamine (Rust) reads a 1 M-row workbook in
  ~20–40 s on a laptop SSD. `infer_schema_length=0` keeps everything as
  strings on read; typed casts happen once during cleaning.
- **Memory ceiling** — Bounded by the largest single file because shards
  are written to disk as soon as they're cleaned. The 985 k-row
  `3808 ALL IMPORT FROM WORLD APR 25.xlsx` peaks around 1.5–2 GB RAM.
- **Storage** — zstd Parquet typically compresses these wide-string
  tables 4–6×. The 8–9 lakh row corpus comfortably fits under 500 MB.
- **DuckDB** — single-file embedded; no server process. Reads
  parallelise across cores by default.

## Scalability to 1 + crore rows

Already designed for it:

- Per-file sharding means RAM scales with **file size**, not corpus
  size. Adding 2 more years of monthly extracts roughly doubles disk
  use, leaves RAM unchanged.
- `duckdb.read_parquet(glob, union_by_name=true)` is the standard
  pattern for billion-row Parquet datasets.
- Cross-file dedupe is keyed on a deterministic 10-column tuple, so it
  runs as a single window-function pass — fine up to ~500 M rows on a
  workstation.

When the corpus crosses ~50 M rows consider:

1. Switching shards to **partitioned** Parquet (by `HS Chapter` and/or
   year-month) so DuckDB can predicate-prune.
2. Adding an **incremental** mode (skip files whose shard already exists
   and is newer than the source) — trivial change in `merger.py`.
3. Pinning the DuckDB to a dedicated `.duckdb` file on fast NVMe; queries
   then become CPU-bound rather than IO-bound.

## Logs and reports

- `logs/processing_log.txt` — full INFO trace + end-of-run summary
- `logs/error_report.txt` — WARNING+ only; check this first when a run
  finishes with non-zero failures
- `output/column_mapping_report.xlsx` — one row per `(file, source
  column)`: strategy used (`exact` / `fuzzy` / `merge_group` / `ignored`
  / `unmapped`) and the fuzzy score where applicable

## What's deliberately out of scope (Phase 2+)

- Web dashboard / UI
- Authentication & multi-tenancy
- AI / natural-language querying over the DuckDB
- Incremental + scheduled refresh
- Entity resolution (linking aliases of the same importer across rows)
#   A t o m g r i d - I n t e r n a l - E X I M  
 