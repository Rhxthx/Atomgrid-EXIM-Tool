"""Load the "AG-Bio" crop-protection market file into its own DuckDB table.

This is aggregated MARKET-VALUE data (per active-ingredient / per-country,
broken down by crop segment) from a market-intelligence report — a completely
different shape from the shipment-level EXIM tables (no HSN, no importer/
exporter, no per-shipment quantity). It gets its own table, ``ag_bio_market``,
exactly like Argentina's ``argentina_imports``.

The source workbook has a two-row header (a crop-group label row, then the
real field names) which pandas/polars header inference can't parse directly,
so we read it with no header and skip both rows ourselves.

One-time reference dataset (per product decision) — this script is NOT wired
into rebuild_all.bat. Re-run it manually if a refreshed AG-Bio file ever shows
up; it always does a full ``CREATE OR REPLACE TABLE`` so re-running is safe.

Usage:
    python scripts/load_agbio.py [path-to-xlsx] [path-to-duckdb]
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

import duckdb
import polars as pl

log = logging.getLogger("load_agbio")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = Path(r"C:\Users\Admin\Downloads\Ag bio - Compiled.xlsx")
DEFAULT_DB = PROJECT_ROOT / "output" / "trade_database.duckdb"
TABLE = "ag_bio_market"

# Source column order (row 2 of the sheet, after the two header rows) ->
# clean snake_case target names. Values are "AI Value (m.)" = USD millions.
CROP_COLS = [
    "cereals", "cotton", "maize", "oilseed_rape", "other_crops", "other_fv",
    "pome_stone_fruit", "potato", "rice", "soybean", "sugar_beet",
    "sugarcane", "sunflower", "vine",
]
COLUMNS = ["product", "type", "country"] + CROP_COLS + ["total_usd_m"]


def load(xlsx: Path, db_path: Path) -> int:
    log.info("Reading %s", xlsx)
    raw = pl.read_excel(
        source=xlsx, sheet_name="Sheet1", engine="calamine",
        infer_schema_length=0, has_header=False,
    )
    # Row 0 = crop-group super-header, row 1 = real field names ("AI", "Type",
    # "Country", "AI Value (m.)" x14, "Total") — both are metadata, not data.
    df = raw.slice(2)
    if df.width != len(COLUMNS):
        raise ValueError(
            f"Expected {len(COLUMNS)} columns, sheet has {df.width}. "
            "The source layout may have changed — check the two header rows."
        )
    df.columns = COLUMNS

    numeric = CROP_COLS + ["total_usd_m"]
    df = df.with_columns([pl.col(c).cast(pl.Float64, strict=False) for c in numeric])
    df = df.with_columns([
        pl.col("product").cast(pl.String).str.strip_chars(),
        pl.col("type").cast(pl.String).str.strip_chars(),
        pl.col("country").cast(pl.String).str.strip_chars(),
        pl.lit(xlsx.name).alias("source_file"),
    ])

    log.info("Writing %d rows to table %s in %s", df.height, TABLE, db_path)
    con = duckdb.connect(str(db_path))
    try:
        con.register("_agbio_df", df)
        con.execute(f"CREATE OR REPLACE TABLE {TABLE} AS SELECT * FROM _agbio_df")
        con.unregister("_agbio_df")
        n = con.execute(f"SELECT count(*) FROM {TABLE}").fetchone()[0]
    finally:
        con.close()
    log.info("Done. %s now has %d rows", TABLE, n)
    return n


def main(argv: list[str]) -> int:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s | %(levelname)s | %(message)s")
    xlsx = Path(argv[0]) if len(argv) > 0 else DEFAULT_XLSX
    db = Path(argv[1]) if len(argv) > 1 else DEFAULT_DB
    if not xlsx.exists():
        log.error("Source file not found: %s", xlsx)
        return 1
    load(xlsx, db)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
