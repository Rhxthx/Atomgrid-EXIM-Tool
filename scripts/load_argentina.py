"""Load the Argentina import dump into a SEPARATE table in the DuckDB file.

Argentina customs imports are a different country's dataset (destination =
Argentina, USD FOB/CIF values, Spanish agrochemical taxonomy, 2016-2026).  To
keep the India ``shipments`` table clean we load this into its own table:
``argentina_imports`` inside the same output/trade_database.duckdb.

Usage:
    python scripts/load_argentina.py [path-to-xlsx] [path-to-duckdb]
"""
from __future__ import annotations

import logging
import re
import sys
import unicodedata
from pathlib import Path

import duckdb
import polars as pl

log = logging.getLogger("load_argentina")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = Path(r"D:\Atomgrid\Argentina Import\Argentina Import.xlsx")
DEFAULT_DB = PROJECT_ROOT / "output" / "trade_database.duckdb"
TABLE = "argentina_imports"


def _norm(h: str) -> str:
    """Normalise a header: strip accents, lowercase, keep alphanumerics."""
    s = unicodedata.normalize("NFKD", str(h)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


# normalized source header -> clean target column
RENAME = {
    "date": "date",
    "month": "month",
    "quarter": "quarter",
    "year": "year",
    "importer": "importer",
    "countryoforigin": "origin_country",
    "type": "type",
    "activeingredients": "active_ingredient",
    "activeingredientenglish": "active_ingredient_en",
    "marcacomercial": "brand",
    "cdato": "c_dato",
    "formulacion": "formulation",
    "segmento": "segment",
    "presentacion": "presentation",
    "cantidad": "quantity",
    "unidad": "unit",
    "fobunitariousd": "fob_unit_usd",
    "fobtotalusd": "fob_total_usd",
    "transporte": "transport",
    "cifunitariousd": "cif_unit_usd",
    "ciftotalusd": "cif_total_usd",
    "importadorunificado": "importer_unified",
    "ajusteenvase": "ajuste_envase",
    "fobajuste": "fob_ajuste",
    "cxformulacion": "cx_formulacion_pct",
    "cxformulacionusd": "cx_formulacion_usd",
    "usdeq": "usd_eq",
}

NUMERIC = ["quantity", "fob_unit_usd", "fob_total_usd", "cif_unit_usd",
           "cif_total_usd", "month", "year"]


def load(xlsx: Path, db_path: Path) -> int:
    log.info("Reading %s", xlsx)
    df = pl.read_excel(xlsx)

    # Drop unnamed / fully-empty trailing columns.
    keep = [c for c in df.columns if c is not None and str(c).strip()
            and not df[c].is_null().all()]
    df = df.select(keep)

    # Rename by normalised header; drop anything unmapped.
    mapping = {c: RENAME[_norm(c)] for c in df.columns if _norm(c) in RENAME}
    df = df.select(list(mapping.keys())).rename(mapping)

    # Coerce numerics (formula columns stay as text — they are secondary).
    for c in NUMERIC:
        if c in df.columns:
            df = df.with_columns(pl.col(c).cast(pl.Float64, strict=False).alias(c))

    # Parse date.
    if "date" in df.columns:
        df = df.with_columns(
            pl.col("date").cast(pl.Utf8).str.to_datetime(strict=False).dt.date().alias("date")
        )

    # Domestic side + lineage (this is Argentina IMPORT data).
    df = df.with_columns([
        pl.lit("ARGENTINA").alias("destination_country"),
        pl.lit("IMPORT").alias("trade_type"),
        pl.lit(xlsx.name).alias("source_file"),
    ])

    log.info("Writing %d rows to table %s in %s", df.height, TABLE, db_path)
    con = duckdb.connect(str(db_path))
    try:
        con.register("_arg_df", df)
        con.execute(f"CREATE OR REPLACE TABLE {TABLE} AS SELECT * FROM _arg_df")
        con.unregister("_arg_df")
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
