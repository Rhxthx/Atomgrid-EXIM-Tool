"""DuckDB sink — concatenate shards into one searchable table.

DuckDB ingests Parquet via glob in a single COPY-like pass; this lets us scale
to crore-row datasets without ever holding all rows in Python memory.
"""

from __future__ import annotations

import logging
from pathlib import Path

import duckdb

log = logging.getLogger(__name__)


def _sql_quote_path(p: Path | str) -> str:
    """Inline a filesystem path as a single-quoted SQL literal.

    DuckDB's COPY TO / read_parquet currently reject bound parameters for
    the filename in some clauses; we have to inline. Windows paths never
    contain single quotes in practice, but escape defensively anyway.
    """
    s = str(p).replace("'", "''")
    return f"'{s}'"


# Indexes are zone-map friendly for our typical lookup columns.  DuckDB
# automatically maintains min/max statistics over Parquet, so these are
# mostly useful for repeated point lookups inside the DuckDB file itself.
INDEXED_COLS = [
    "Importer",
    "Exporter",
    "Supplier",
    "Buyer",
    "HSN",
    "Origin Country",
    "Destination Country",
    "Trade Type",
    "Date",
]

TABLE_NAME = "shipments"


def build_database(
    shards_glob: str,
    duckdb_path: Path,
    merged_parquet_path: Path,
    sample_csv_path: Path,
    sample_rows: int = 1000,
    split_paths: dict[str, dict[str, Path]] | None = None,
) -> dict[str, int]:
    """Build the master table from per-file shards and export artefacts.

    ``split_paths`` optionally requests per-direction exports keyed by
    Trade Type, e.g.::

        {"IMPORT": {"parquet": ..., "sample_csv": ...},
         "EXPORT": {"parquet": ..., "sample_csv": ...}}

    Each direction is written as its own Parquet file plus a small CSV sample,
    filtered from the deduped master table.
    """
    duckdb_path.parent.mkdir(parents=True, exist_ok=True)

    # Fresh DB each run.  Phase 2 can switch to incremental loads.
    if duckdb_path.exists():
        duckdb_path.unlink()

    con = duckdb.connect(str(duckdb_path))
    try:
        log.info("Creating DuckDB table from %s", shards_glob)
        # union_by_name handles the rare case of a shard missing a column.
        con.execute(
            f"""
            CREATE TABLE {TABLE_NAME} AS
            SELECT * FROM read_parquet({_sql_quote_path(shards_glob)}, union_by_name=true)
            """
        )

        row_count = con.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}").fetchone()[0]
        log.info("  table populated: %s rows", f"{row_count:,}")

        # Cross-file dedupe — same shipment can appear in two monthly extracts
        # near the period boundary.  Use a deterministic key, not SELECT DISTINCT
        # over all cols (cheaper, and avoids dropping rows that differ only by
        # whitespace we've already stripped).
        con.execute(
            f"""
            CREATE OR REPLACE TABLE {TABLE_NAME} AS
            SELECT * FROM (
                SELECT *,
                       ROW_NUMBER() OVER (
                           PARTITION BY "Date", "Importer", "Exporter", "Supplier",
                                        "Buyer", "HSN", "Quantity", "Value",
                                        "Product Description", "BE/SB Number"
                           ORDER BY "Source File"
                       ) AS _rn
                FROM {TABLE_NAME}
            )
            WHERE _rn = 1
            """
        )
        con.execute(f"ALTER TABLE {TABLE_NAME} DROP COLUMN _rn")
        deduped = con.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}").fetchone()[0]
        log.info("  after cross-file dedupe: %s rows (removed %s)",
                 f"{deduped:,}", f"{row_count - deduped:,}")

        for col in INDEXED_COLS:
            idx_name = f"idx_{col.lower().replace(' ', '_').replace('/', '_')}"
            con.execute(f'CREATE INDEX {idx_name} ON {TABLE_NAME} ("{col}")')
            log.debug("  index created: %s", idx_name)

        # Single consolidated Parquet for downstream consumers.
        log.info("Writing %s", merged_parquet_path)
        con.execute(
            f"COPY {TABLE_NAME} TO {_sql_quote_path(merged_parquet_path)} "
            "(FORMAT PARQUET, COMPRESSION ZSTD)"
        )

        log.info("Writing sample CSV (%d rows)", sample_rows)
        con.execute(
            f"COPY (SELECT * FROM {TABLE_NAME} LIMIT {int(sample_rows)}) "
            f"TO {_sql_quote_path(sample_csv_path)} (FORMAT CSV, HEADER)"
        )

        result = {
            "rows_initial": row_count,
            "rows_after_dedupe": deduped,
        }

        # Per-direction split exports (import / export as separate files).
        if split_paths:
            for trade_type, paths in split_paths.items():
                where = f'"Trade Type" = {_sql_quote_path(trade_type)}'
                n = con.execute(
                    f"SELECT COUNT(*) FROM {TABLE_NAME} WHERE {where}"
                ).fetchone()[0]
                log.info("Writing %s split: %s rows", trade_type, f"{n:,}")

                parquet_path = paths["parquet"]
                parquet_path.parent.mkdir(parents=True, exist_ok=True)
                con.execute(
                    f"COPY (SELECT * FROM {TABLE_NAME} WHERE {where}) "
                    f"TO {_sql_quote_path(parquet_path)} "
                    "(FORMAT PARQUET, COMPRESSION ZSTD)"
                )

                sample_path = paths.get("sample_csv")
                if sample_path is not None:
                    sample_path.parent.mkdir(parents=True, exist_ok=True)
                    con.execute(
                        f"COPY (SELECT * FROM {TABLE_NAME} WHERE {where} "
                        f"LIMIT {int(sample_rows)}) "
                        f"TO {_sql_quote_path(sample_path)} (FORMAT CSV, HEADER)"
                    )

                result[f"rows_{trade_type.lower()}"] = n

        return result
    finally:
        con.close()


def write_example_queries(out_path: Path) -> None:
    """Emit a SQL file with ready-to-run example queries."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(EXAMPLE_QUERIES, encoding="utf-8")
    log.info("Example queries written: %s", out_path)


EXAMPLE_QUERIES = """\
-- ------------------------------------------------------------
--  EXIM trade database — example queries (DuckDB SQL)
--
--  Run with:
--      duckdb output/trade_database.duckdb < output/example_queries.sql
--  ...or load the DB and paste queries into the DuckDB REPL.
-- ------------------------------------------------------------

-- 1.  Search by importer (case-insensitive substring match)
SELECT "Date", "Importer", "Supplier", "Origin Country", "HSN",
       "Quantity", "Unit", "Value", "Currency", "Source File"
FROM shipments
WHERE "Importer" ILIKE '%evonik%'
ORDER BY "Date" DESC
LIMIT 50;

-- 2.  Search by exact HSN
SELECT "Date", "Trade Type", "Importer", "Exporter", "Supplier", "Buyer",
       "Origin Country", "Destination Country", "Value"
FROM shipments
WHERE "HSN" = '29304000'
LIMIT 100;

-- 3.  All shipments from a specific supplier
SELECT "Date", "Importer", "Supplier", "Origin Country",
       "Product Description", "Quantity", "Value"
FROM shipments
WHERE "Supplier" ILIKE '%syngenta%'
ORDER BY "Date" DESC;

-- 4.  Country-wise trade volume (totals by HS chapter)
SELECT "HS Chapter",
       "Trade Type",
       COALESCE("Origin Country", "Destination Country") AS counterparty_country,
       COUNT(*)                AS shipments,
       SUM("Quantity")         AS total_quantity,
       SUM("Value")            AS total_value
FROM shipments
GROUP BY 1, 2, 3
ORDER BY total_value DESC NULLS LAST
LIMIT 100;

-- 5.  Top 20 importers by total declared value
SELECT "Importer",
       COUNT(*)        AS shipments,
       SUM("Value")    AS total_value
FROM shipments
WHERE "Trade Type" = 'IMPORT' AND "Importer" IS NOT NULL
GROUP BY 1
ORDER BY total_value DESC NULLS LAST
LIMIT 20;

-- 6.  Top 20 exporters by total declared value
SELECT "Exporter",
       COUNT(*)        AS shipments,
       SUM("Value")    AS total_value
FROM shipments
WHERE "Trade Type" = 'EXPORT' AND "Exporter" IS NOT NULL
GROUP BY 1
ORDER BY total_value DESC NULLS LAST
LIMIT 20;

-- 7.  Monthly shipment counts per HS chapter
SELECT DATE_TRUNC('month', "Date") AS month,
       "HS Chapter",
       "Trade Type",
       COUNT(*) AS shipments
FROM shipments
WHERE "Date" IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- 8.  Find an importer's recent suppliers
SELECT DISTINCT "Supplier", "Origin Country"
FROM shipments
WHERE "Importer" ILIKE '%merck life science%'
  AND "Date" >= DATE '2025-01-01';
"""
