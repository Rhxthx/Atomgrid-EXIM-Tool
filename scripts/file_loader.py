"""File discovery + multi-format loader.

Reads .xlsx / .xls / .csv into a Polars DataFrame.  Excel files are loaded via
the Calamine engine (Rust, fast, low memory) with an openpyxl/pandas fallback
for the occasional malformed workbook.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterator

import polars as pl

log = logging.getLogger(__name__)

SUPPORTED_SUFFIXES = {".xlsx", ".xls", ".csv", ".parquet"}

# Sheets to ignore when a workbook has multiple sheets (junk/empty tabs).
_SKIP_SHEETS = {"sheet2", "sheet3", "sheet4", "readme", "notes", "info"}


def scan_folder(folder: Path) -> list[Path]:
    """Return sorted list of supported files in ``folder``.

    We sort for deterministic shard order; downstream dedupe / DuckDB
    ingestion doesn't care, but logs are much easier to read.  Temp files
    Excel leaves behind (``~$something.xlsx``) are skipped.
    """
    if not folder.exists():
        raise FileNotFoundError(f"Source folder does not exist: {folder}")
    # Recurse into sub-folders (e.g. "29 ALL PORTS IMPORT", "3808 ALL EXPORT
    # TO WORLD") so one --source root picks up every monthly file.
    files = [
        p for p in folder.rglob("*")
        if p.is_file()
        and p.suffix.lower() in SUPPORTED_SUFFIXES
        and not p.name.startswith("~$")
    ]
    files.sort(key=lambda p: p.name.lower())
    return files


def _read_xlsx_calamine(path: Path) -> pl.DataFrame:
    """Fast path — Calamine via fastexcel.

    Reads ALL data sheets and concatenates them. Many vendor workbooks split
    one dataset across sheets (e.g. chapter "29" and "38" on separate tabs);
    reading only the first sheet would silently drop half the file. Empty and
    known-junk tabs (Sheet2/Sheet3/...) are skipped. Values are read as strings
    (the cleaner coerces types) so sheets with slightly different inferred
    dtypes still concatenate cleanly.
    """
    import fastexcel
    try:
        names = fastexcel.read_excel(str(path)).sheet_names
    except Exception:  # noqa: BLE001 — fall back to single default sheet
        return pl.read_excel(source=path, engine="calamine", infer_schema_length=0)

    frames = []
    for name in names:
        if name.strip().lower() in _SKIP_SHEETS:
            continue
        df = pl.read_excel(source=path, sheet_name=name, engine="calamine",
                           infer_schema_length=0)
        if df.height > 0 and df.width > 1:
            frames.append(df)

    if not frames:
        return pl.read_excel(source=path, engine="calamine", infer_schema_length=0)
    if len(frames) == 1:
        return frames[0]
    log.info("  %s: concatenating %d sheets %s", path.name, len(frames), names)
    return pl.concat(frames, how="diagonal_relaxed")


def _read_xlsx_openpyxl_fallback(path: Path) -> pl.DataFrame:
    """Slow path — pandas + openpyxl in read-only mode.

    Falls back to this when Calamine errors out (rare; mainly happens on
    files with broken shared-strings tables).
    """
    import pandas as pd

    pdf = pd.read_excel(path, engine="openpyxl", dtype=str)
    return pl.from_pandas(pdf)


def _read_csv(path: Path) -> pl.DataFrame:
    return pl.read_csv(
        path,
        infer_schema_length=0,
        ignore_errors=True,
        try_parse_dates=False,
        truncate_ragged_lines=True,
    )


def load_file(path: Path) -> pl.DataFrame:
    """Load any supported file into a Polars DataFrame of strings.

    Strings-only-on-read is intentional: the cleaner has its own typed
    coercion path and we don't want different files to end up with
    incompatible dtypes for the same logical column.
    """
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return _read_csv(path)

    if suffix == ".parquet":
        # Pre-converted files (e.g. a headerless CSV given proper headers) —
        # read as strings for a consistent downstream contract.
        return pl.read_parquet(path).with_columns(pl.all().cast(pl.String))

    if suffix in {".xlsx", ".xls"}:
        try:
            return _read_xlsx_calamine(path)
        except Exception as e:  # noqa: BLE001 — narrow fallback below
            log.warning("Calamine failed on %s (%s); trying openpyxl fallback", path.name, e)
            return _read_xlsx_openpyxl_fallback(path)

    raise ValueError(f"Unsupported file type: {path}")


def iter_files(folder: Path) -> Iterator[Path]:
    """Convenience iterator used by the orchestrator."""
    yield from scan_folder(folder)
