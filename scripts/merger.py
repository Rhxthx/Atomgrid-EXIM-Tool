"""Per-file orchestration: load → map → clean → write shard.

Each input file becomes a single Parquet shard in ``output/_shards/``.  The
shards are concatenated by DuckDB at the end of the run, so peak memory stays
bounded by the largest single file (~1M rows here, well under typical RAM).
"""

from __future__ import annotations

import logging
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path

import polars as pl

from .data_cleaner import clean_dataframe
from .file_loader import load_file
from .schema_mapper import MappingReport, map_dataframe
from .utils import derive_metadata_from_filename

log = logging.getLogger(__name__)


@dataclass
class FileResult:
    file: str
    success: bool
    rows_in: int = 0
    rows_out: int = 0
    shard_path: str | None = None
    seconds: float = 0.0
    error: str | None = None


@dataclass
class RunSummary:
    files: list[FileResult] = field(default_factory=list)

    @property
    def total_in(self) -> int:
        return sum(f.rows_in for f in self.files)

    @property
    def total_out(self) -> int:
        return sum(f.rows_out for f in self.files)

    @property
    def successes(self) -> int:
        return sum(1 for f in self.files if f.success)

    @property
    def failures(self) -> int:
        return sum(1 for f in self.files if not f.success)


def process_file(
    path: Path,
    *,
    cfg: dict,
    shards_dir: Path,
    report: MappingReport,
) -> FileResult:
    """Run the per-file pipeline.  Errors are caught + logged, not raised,
    so one bad workbook never blocks the rest of the batch.
    """
    t0 = time.perf_counter()
    result = FileResult(file=path.name, success=False)

    try:
        log.info("Loading %s", path.name)
        df = load_file(path)
        result.rows_in = df.height
        log.info("  rows in: %d, cols: %d", df.height, df.width)

        metadata = derive_metadata_from_filename(path)
        mapped = map_dataframe(
            df,
            source_path=path,
            cfg=cfg,
            file_metadata=metadata,
            report=report,
        )

        cleaned = clean_dataframe(mapped)
        result.rows_out = cleaned.height

        shards_dir.mkdir(parents=True, exist_ok=True)
        shard_path = shards_dir / f"{path.stem}.parquet"
        # zstd is the sweet spot for these wide-string tables — ~3-5x smaller
        # than snappy with negligible read overhead.
        cleaned.write_parquet(shard_path, compression="zstd", statistics=True)
        result.shard_path = str(shard_path)
        result.success = True
        log.info("  rows out: %d  ->  %s", cleaned.height, shard_path.name)

    except Exception as e:  # noqa: BLE001 — surface anything; one file ≠ whole run
        result.error = f"{type(e).__name__}: {e}"
        log.error("FAILED on %s: %s", path.name, result.error)
        log.debug("Traceback:\n%s", traceback.format_exc())

    result.seconds = time.perf_counter() - t0
    return result


def write_mapping_report(report: MappingReport, out_path: Path) -> None:
    """Write column_mapping_report.xlsx.

    The XLSX format is per spec, even though Parquet/CSV would be cheaper —
    the human reviewing the report wants to filter/sort in Excel.
    """
    df = report.to_polars()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.write_excel(workbook=out_path, worksheet="mapping_decisions", autofit=True)
    log.info("Mapping report written: %s (%d rows)", out_path, df.height)


def write_summary(summary: RunSummary, out_path: Path) -> None:
    """Append a human-readable summary block to processing_log.txt."""
    lines = [
        "",
        "=" * 60,
        "RUN SUMMARY",
        "=" * 60,
        f"Files processed: {len(summary.files)}",
        f"  Successes:     {summary.successes}",
        f"  Failures:      {summary.failures}",
        f"Rows in (raw):   {summary.total_in:,}",
        f"Rows out (clean):{summary.total_out:,}",
        "",
        "Per-file:",
    ]
    for f in summary.files:
        status = "OK " if f.success else "ERR"
        lines.append(
            f"  [{status}] {f.file:60s}  in={f.rows_in:>8,}  out={f.rows_out:>8,}  {f.seconds:>6.1f}s"
            + (f"  -- {f.error}" if f.error else "")
        )
    text = "\n".join(lines)
    with out_path.open("a", encoding="utf-8") as fh:
        fh.write(text + "\n")
    log.info(text)
