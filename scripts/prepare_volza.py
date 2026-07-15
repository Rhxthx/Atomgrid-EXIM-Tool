"""Prepare the Volza India extracts as additive source files for the pipeline.

The two Volza consolidations (``All_Import.xlsx`` = imports into India,
``All_Export.xlsx`` = exports from India) massively widen India coverage:
dozens of new HS chapters and ~2018-2026 history vs. our existing detailed
customs data, which only holds **chapters 29 & 38 for Mar-2025 onward**.

To fold Volza into the India market *without double-counting*, we drop the one
slice our denser customs data already owns — **HS chapters 29 & 38 dated on or
after the cutoff (default 2025-03-01)** — and keep everything else. The result
is written as Parquet (original headers preserved) into a subfolder of the
pipeline source root, so the next ``main.py --source ...`` rebuild ingests it
like any other India file (filename tags it IMPORT/EXPORT + reporting country
INDIA automatically).

Idempotent and safe to wire into rebuild_all.bat: if a raw input is missing it
is skipped (any previously-prepared Parquet is left untouched).

Usage (defaults shown):
    python scripts/prepare_volza.py \
        --import-file "D:/EXIM Data/Volza_All_Workspaces/Output/All_Import.xlsx" \
        --export-file "D:/EXIM Data/Volza_All_Workspaces/Output/All_Export.xlsx" \
        --out-dir     "D:/Atomgrid/EXIM Data/India_Volza" \
        --cutoff      2025-03-01
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import fastexcel
import polars as pl

# Chapters our existing detailed India customs data already covers in-window.
OVERLAP_CHAPTERS = ("29", "38")
_SKIP_SHEETS = {"sheet2", "sheet3", "sheet4", "readme", "notes", "info"}

DEFAULT_IMPORT = r"D:/EXIM Data/Volza_All_Workspaces/Output/All_Import.xlsx"
DEFAULT_EXPORT = r"D:/EXIM Data/Volza_All_Workspaces/Output/All_Export.xlsx"
DEFAULT_OUTDIR = r"D:/Atomgrid/EXIM Data/India_Volza"


def _load_xlsx(path: Path) -> pl.DataFrame:
    """Read all data sheets as strings — mirrors scripts/file_loader.py."""
    sheets = fastexcel.read_excel(str(path)).sheet_names
    frames = []
    for name in sheets:
        if name.strip().lower() in _SKIP_SHEETS:
            continue
        df = pl.read_excel(source=path, sheet_name=name, engine="calamine",
                           infer_schema_length=0)
        if df.height > 0 and df.width > 1:
            frames.append(df)
    if not frames:
        return pl.read_excel(source=path, engine="calamine", infer_schema_length=0)
    return frames[0] if len(frames) == 1 else pl.concat(frames, how="diagonal_relaxed")


def _norm(name: str) -> str:
    return "".join(ch for ch in name.lower() if ch.isalnum())


def _pick(df: pl.DataFrame, *candidates: str) -> str | None:
    want = {c for c in candidates}
    for col in df.columns:
        if _norm(col) in want:
            return col
    return None


def prepare(src: Path, out_path: Path, cutoff: str, label: str) -> bool:
    if not src.exists():
        print(f"  [skip] {label}: source not found -> {src}")
        return False

    df = _load_xlsx(src)
    n0 = df.height
    hs_col = _pick(df, "hscode", "hsn", "hscode")
    date_col = _pick(df, "date", "billofladingdate", "shipmentdate")
    if hs_col is None or date_col is None:
        print(f"  [skip] {label}: could not locate HS/date columns "
              f"(hs={hs_col!r}, date={date_col!r})")
        return False

    chap = pl.col(hs_col).cast(pl.String).str.strip_chars().str.slice(0, 2)
    # ISO date strings ("2025-03-01" / "2025-03-01 00:00:00") compare
    # lexicographically in chronological order — no datetime parsing needed.
    date10 = pl.col(date_col).cast(pl.String).str.strip_chars().str.slice(0, 10)
    is_overlap = chap.is_in(OVERLAP_CHAPTERS) & (date10 >= pl.lit(cutoff))

    kept = df.filter(~is_overlap)
    n_excl = n0 - kept.height

    # Per-chapter breakdown of what we excluded (for the audit line).
    excl_by_chap = (
        df.filter(is_overlap)
        .select(chap.alias("chap"))
        .to_series()
        .value_counts(sort=True)
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    kept.write_parquet(out_path)

    print(f"  {label}:")
    print(f"      read       : {n0:>10,} rows")
    print(f"      excluded   : {n_excl:>10,} rows (ch {'/'.join(OVERLAP_CHAPTERS)} >= {cutoff})")
    for row in excl_by_chap.iter_rows():
        print(f"                     ch {str(row[0]):<3} {row[1]:>10,}")
    print(f"      kept/wrote : {kept.height:>10,} rows -> {out_path}")
    return True


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--import-file", default=DEFAULT_IMPORT)
    ap.add_argument("--export-file", default=DEFAULT_EXPORT)
    ap.add_argument("--out-dir", default=DEFAULT_OUTDIR)
    ap.add_argument("--cutoff", default="2025-03-01",
                    help="Exclude overlap chapters dated ON/AFTER this ISO date.")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    print("=" * 64)
    print("Preparing Volza India source files (additive-only filter)")
    print(f"  cutoff            : {args.cutoff}")
    print(f"  overlap chapters  : {', '.join(OVERLAP_CHAPTERS)}")
    print(f"  output folder     : {out_dir}")
    print("=" * 64)

    any_written = False
    any_written |= prepare(Path(args.import_file),
                           out_dir / "Volza_India_Import.parquet",
                           args.cutoff, "IMPORT (into India)")
    any_written |= prepare(Path(args.export_file),
                           out_dir / "Volza_India_Export.parquet",
                           args.cutoff, "EXPORT (from India)")

    if not any_written:
        print("\nNothing prepared (no raw Volza inputs found). "
              "Existing prepared files, if any, are left in place.")
    else:
        print("\nDone. Run rebuild_all.bat to fold these into the India market.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
