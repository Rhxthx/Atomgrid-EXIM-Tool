"""EXIM Data Merge — Phase 1 entry point.

Typical usage:
    python main.py --source "E:/Atomgrid/EXIM India"

Optional flags:
    --limit 2        # process only first N files (smoke testing)
    --keep-shards    # don't delete per-file Parquet shards after DB build
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sys
from pathlib import Path

from scripts.duckdb_writer import build_database, write_example_queries
from scripts.file_loader import scan_folder
from scripts.merger import (
    RunSummary,
    process_file,
    write_mapping_report,
    write_summary,
)
from scripts.schema_mapper import MappingReport
from scripts.utils import load_mapping_config, setup_logging


PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"
LOG_DIR = PROJECT_ROOT / "logs"
CONFIG_PATH = PROJECT_ROOT / "config" / "column_mapping.json"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="EXIM Data Merge pipeline (Phase 1)")
    p.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
        help="Folder containing source .xlsx / .xls / .csv files (default: ./data)",
    )
    p.add_argument(
        "--config",
        type=Path,
        default=CONFIG_PATH,
        help="Path to column_mapping.json (default: ./config/column_mapping.json)",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_DIR,
        help="Output directory (default: ./output)",
    )
    p.add_argument(
        "--logs",
        type=Path,
        default=LOG_DIR,
        help="Log directory (default: ./logs)",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Process only the first N files (0 = all). Handy for smoke tests.",
    )
    p.add_argument(
        "--keep-shards",
        action="store_true",
        help="Keep per-file Parquet shards after building the DuckDB.",
    )
    p.add_argument(
        "--verbose",
        action="store_true",
        help="DEBUG-level logging.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    log = setup_logging(args.logs, level=logging.DEBUG if args.verbose else logging.INFO)

    log.info("EXIM Data Merge — Phase 1")
    log.info("Source folder: %s", args.source)
    log.info("Output folder: %s", args.output)

    args.output.mkdir(parents=True, exist_ok=True)
    shards_dir = args.output / "_shards"
    # Clean shards from previous runs so a renamed source file doesn't leave
    # an orphan shard behind that would get picked up by the glob.
    if shards_dir.exists():
        shutil.rmtree(shards_dir)
    shards_dir.mkdir(parents=True, exist_ok=True)

    cfg = load_mapping_config(args.config)
    log.info("Loaded mapping config: %d direct, %d merge groups, %d ignore",
             len(cfg["mappings"]), len(cfg["merge_groups"]), len(cfg["ignore"]))

    files = scan_folder(args.source)
    if args.limit and args.limit > 0:
        files = files[: args.limit]
    log.info("Discovered %d files", len(files))
    if not files:
        log.error("No source files found in %s", args.source)
        return 1

    summary = RunSummary()
    report = MappingReport()

    for i, path in enumerate(files, 1):
        log.info("-- [%d/%d] %s --", i, len(files), path.name)
        result = process_file(path, cfg=cfg, shards_dir=shards_dir, report=report)
        summary.files.append(result)

    if summary.successes == 0:
        log.error("No files were processed successfully; aborting before DuckDB build.")
        write_mapping_report(report, args.output / "column_mapping_report.xlsx")
        write_summary(summary, args.logs / "processing_log.txt")
        return 2

    # Concatenate shards + build searchable DuckDB.
    shards_glob = str(shards_dir / "*.parquet")
    db_stats = build_database(
        shards_glob=shards_glob,
        duckdb_path=args.output / "trade_database.duckdb",
        merged_parquet_path=args.output / "merged_data.parquet",
        sample_csv_path=args.output / "merged_data_sample.csv",
    )

    write_example_queries(args.output / "example_queries.sql")
    write_mapping_report(report, args.output / "column_mapping_report.xlsx")
    write_summary(summary, args.logs / "processing_log.txt")

    log.info("Final dataset: %s rows (after cross-file dedupe)",
             f"{db_stats['rows_after_dedupe']:,}")

    if not args.keep_shards:
        shutil.rmtree(shards_dir, ignore_errors=True)
        log.info("Removed shard directory: %s", shards_dir)

    log.info("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
