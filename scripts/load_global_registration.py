"""Load the multi-country "Global Registration" workbook into its own table.

This is READ-ONLY reference data (pesticide/plant-protection product
registrations per country), refreshed occasionally by re-running this loader.
Each of the 21 sheets is a different country's registry with DIFFERENT columns
(and several in Spanish), so we normalise each sheet's columns into one common
schema and keep every original field in a JSON blob for the details view.

Lives in its own table ``global_registration`` inside the shared
output/trade_database.duckdb (same pattern as ag_bio_market / argentina_imports)
and is reloaded by rebuild_all.bat after each rebuild wipes the DuckDB.

Usage:
    python scripts/load_global_registration.py [path-to-xlsx] [path-to-duckdb]
"""
from __future__ import annotations

import json
import logging
import re
import sys
import unicodedata
from pathlib import Path

import duckdb
import fastexcel
import polars as pl

log = logging.getLogger("load_global_registration")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
# Stable location OUTSIDE the pipeline source root (D:\Atomgrid\EXIM Data) so
# main.py never ingests this reference workbook into the shipments table.
DEFAULT_XLSX = Path(r"D:\Atomgrid\GlobalRegistration\Global Registration data.xlsx")
DEFAULT_DB = PROJECT_ROOT / "output" / "trade_database.duckdb"
TABLE = "global_registration"


def _norm(h: object) -> str:
    """Accent-insensitive header key: strip accents, keep alphanumerics."""
    s = unicodedata.normalize("NFKD", str(h)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


# Per-sheet mapping: normalised sheet name -> {target: normalised source header}.
# None means the sheet has no such field. Keys are normalised so trailing
# spaces / case / accents in sheet + column names don't matter.
SHEET_MAP: dict[str, dict[str, str | None]] = {
    "turkey": {"product": "plantprotectionproduct", "active_ingredient": "activeingredient",
               "concentration": None, "company": "licensedcompany", "status": "licensestatus",
               "registration_no": "licenseno", "formulation_type": "formulation", "origin": None},
    "australia": {"product": "name", "active_ingredient": "actives", "concentration": None,
                  "company": "company", "status": "status", "registration_no": "no",
                  "formulation_type": "producttype", "origin": None},
    "tanzania": {"product": "tradename", "active_ingredient": "productname", "concentration": None,
                 "company": "registrant", "status": None, "registration_no": "registrationnumber",
                 "formulation_type": "type", "origin": "registeredcountry"},
    "egypt": {"product": "tradename", "active_ingredient": "activeingredient",
              "concentration": "concentration", "company": "importersdistributorsenglish", "status": "status",
              "registration_no": "registrationno", "formulation_type": "formulation", "origin": "country"},
    "ethiopia": {"product": "tradename", "active_ingredient": "commonname", "concentration": None,
                 "company": None, "status": None, "registration_no": None,
                 "formulation_type": None, "origin": None},
    "indonesia": {"product": "pesticidebrands", "active_ingredient": "activeingredients",
                  "concentration": None, "company": "nameofregistrationnumberholder", "status": None,
                  "registration_no": "registrationnumber",
                  "formulation_type": "typesofpesticidesformulationforms", "origin": None},
    "mexico": {"product": "tradenames", "active_ingredient": "activeingredient", "concentration": None,
               "company": "company", "status": None, "registration_no": "registration",
               "formulation_type": None, "origin": None},
    "uganda": {"product": "tradecommercialname", "active_ingredient": "activeingredientsandconcentration",
               "concentration": None, "company": "localagentdistributor", "status": None,
               "registration_no": "registrationnumber", "formulation_type": None, "origin": None},
    "zimbabwe": {"product": "productname", "active_ingredient": "activeingredient", "concentration": None,
                 "company": "company", "status": None, "registration_no": "registrationnonew",
                 "formulation_type": "category", "origin": None},
    "zambia": {"product": "productlicensedtradename", "active_ingredient": "activeingredient",
               "concentration": None, "company": None, "status": None, "registration_no": None,
               "formulation_type": "typeofpesticidestoxicsubstances", "origin": None},
    "kenya": {"product": "productname", "active_ingredient": "activeingredient", "concentration": None,
              "company": "localagent", "status": None, "registration_no": "regno",
              "formulation_type": None, "origin": None},
    "nigeria": {"product": "productname", "active_ingredient": "activeingredient", "concentration": None,
                "company": "nameaddressofapplicant", "status": "status",
                "registration_no": "nafdacregno", "formulation_type": "presentation", "origin": "country"},
    "southafrica": {"product": "tradename", "active_ingredient": "activeingredients", "concentration": None,
                    "company": "registrationholder", "status": "registrationstatus",
                    "registration_no": "registrationno", "formulation_type": None, "origin": None},
    "argentinaformulation": {"product": "marca", "active_ingredient": "activos", "concentration": None,
                             "company": "empresa", "status": None, "registration_no": "nregistro",
                             "formulation_type": None, "origin": None},
    "argentinatc": {"product": "nombre", "active_ingredient": "productenglish", "concentration": "concentracion",
                    "company": "empresa", "status": None, "registration_no": "nregistro",
                    "formulation_type": None, "origin": "pais"},
    "peru": {"product": "tradename", "active_ingredient": "activeingredient", "concentration": None,
             "company": "registryholder", "status": "state", "registration_no": "noofregistryoffice",
             "formulation_type": "formulationtype", "origin": None},
    "ecuador": {"product": "nombrecomercial", "active_ingredient": "composiciondeproducto",
                "concentration": None, "company": "fabricanteformulador", "status": "estado",
                "registration_no": "nderegistro", "formulation_type": "formulacion", "origin": None},
    "paraguay": {"product": "producto", "active_ingredient": "pactivo", "concentration": None,
                 "company": "registrante", "status": "situacion", "registration_no": "registron",
                 "formulation_type": "formulacion", "origin": "paisorigen"},
    "chile": {"product": "nombrecomercial", "active_ingredient": "sustanciasactivas",
              "concentration": "concentracion", "company": "titularautorizacion", "status": None,
              "registration_no": "nsag", "formulation_type": "formulacioncodigo", "origin": None},
    "uruguay": {"product": "nombrecomercial", "active_ingredient": "sustanciaactiva1",
                "concentration": "activocontenido1", "company": "empresarazonsocial", "status": "estado",
                "registration_no": "registro", "formulation_type": "formulacion", "origin": "pais"},
    "colombia": {"product": "nombreproducto", "active_ingredient": "ingredientesactivos",
                 "concentration": "concentracion", "company": "empresa", "status": "estado",
                 "registration_no": "numeroderegistro", "formulation_type": "tipoformulacion", "origin": None},
}

TARGETS = ["product", "active_ingredient", "concentration", "company", "status",
           "registration_no", "formulation_type", "origin"]


def _country_name(sheet: str) -> str:
    """Clean, display-friendly country from the sheet name (Argentina_* -> Argentina)."""
    c = sheet.strip()
    if c.lower().startswith("argentina"):
        return "Argentina"
    return c.title()


def load(xlsx: Path, db_path: Path) -> int:
    log.info("Reading %s", xlsx)
    sheets = fastexcel.read_excel(str(xlsx)).sheet_names
    frames: list[pl.DataFrame] = []

    for sheet in sheets:
        key = _norm(sheet)
        mapping = SHEET_MAP.get(key)
        if mapping is None:
            log.warning("  no mapping for sheet %r (norm=%r) — skipped", sheet, key)
            continue
        df = pl.read_excel(source=xlsx, sheet_name=sheet, engine="calamine", infer_schema_length=0)
        if df.height == 0:
            continue

        # normalised header -> actual column name (last wins on collisions)
        lut = {_norm(c): c for c in df.columns}
        country = _country_name(sheet)

        def col_expr(target: str) -> pl.Expr:
            src_norm = mapping.get(target)
            actual = lut.get(src_norm) if src_norm else None
            if actual is None:
                return pl.lit(None, dtype=pl.String).alias(target)
            return pl.col(actual).cast(pl.String).str.strip_chars().alias(target)

        exprs = [pl.lit(country).alias("country")] + [col_expr(t) for t in TARGETS]
        base = df.select(exprs)

        # The two Argentina sheets have no formulation column of their own —
        # tag them from the sheet identity (TC = technical, other = formulation).
        if key == "argentinaformulation":
            base = base.with_columns(pl.lit("Formulation").alias("formulation_type"))
        elif key == "argentinatc":
            base = base.with_columns(pl.lit("Technical").alias("formulation_type"))

        # Ecuador repeats descriptive labels ("Ingrediente activo",
        # "Aditivo de importancia toxicológica") before each substance in its
        # composition string — strip them and tidy the leftover whitespace.
        if key == "ecuador":
            base = base.with_columns(
                pl.col("active_ingredient")
                .str.replace_all(r"(?i)ingrediente activo", "")
                .str.replace_all(r"(?i)aditivo de importancia toxicol[oó]gica", "")
                .str.replace_all(r"\s{2,}", " ")
                .str.strip_chars(" ,")
                .alias("active_ingredient")
            )

        # Full original row as JSON for the "details" panel.
        orig = df.select([pl.col(c).cast(pl.String) for c in df.columns])
        raw_json = [json.dumps({k: v for k, v in row.items() if v is not None},
                               ensure_ascii=False)
                    for row in orig.to_dicts()]
        base = base.with_columns([
            pl.Series("raw_json", raw_json, dtype=pl.String),
            pl.lit(sheet.strip()).alias("source_sheet"),
        ])
        frames.append(base)
        log.info("  %-24s %6d rows -> %s", sheet.strip(), base.height, country)

    if not frames:
        raise RuntimeError("No sheets mapped — nothing to load")
    out = pl.concat(frames, how="vertical_relaxed")

    # Blank -> NULL on the common text columns (cleaner filtering/search).
    out = out.with_columns([
        pl.when(pl.col(t).str.len_chars() == 0).then(None).otherwise(pl.col(t)).alias(t)
        for t in TARGETS
    ])

    log.info("Writing %d rows to table %s in %s", out.height, TABLE, db_path)
    con = duckdb.connect(str(db_path))
    try:
        con.register("_gr_df", out)
        con.execute(f"CREATE OR REPLACE TABLE {TABLE} AS SELECT * FROM _gr_df")
        con.unregister("_gr_df")
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
