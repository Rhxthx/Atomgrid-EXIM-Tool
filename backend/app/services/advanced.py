"""Advanced features: duplicate detection, supplier concentration, keyword extraction."""

from __future__ import annotations

import logging
import re
from typing import Any

from app.database import DuckDBClient, iter_dict_rows
from app.models import TABLE, quote_ident
from app.schemas.filters import FilterParams
from app.utils import timer

from .search import build_where

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------

_DEDUPE_KEY_COLS = (
    "Date", "Importer", "Exporter", "Supplier", "Buyer",
    "HSN", "Quantity", "Value", "Product Description", "BE/SB Number",
)


def detect_duplicates(
    db: DuckDBClient,
    f: FilterParams,
    *,
    min_occurrences: int = 2,
    limit: int = 100,
) -> tuple[list[dict], int, float, dict]:
    """Find groups of rows that share the deterministic dedupe key.

    Phase 1 already drops cross-file duplicates on this same key, so what
    surfaces here is typically *within-file* repetition (e.g. the same
    Bill of Entry split into multiple line items).  Still useful for QA.
    """
    with timer() as t:
        where, params, applied = build_where(f)
        key_cols_sql = ", ".join(quote_ident(c) for c in _DEDUPE_KEY_COLS)

        sql = (
            f"SELECT {key_cols_sql}, "
            f"       COUNT(*) AS occurrences, "
            f"       LIST(DISTINCT {quote_ident('Source File')}) AS source_files "
            f"FROM {TABLE} {where} "
            f"GROUP BY {key_cols_sql} "
            f"HAVING COUNT(*) >= {int(min_occurrences)} "
            f"ORDER BY occurrences DESC "
            f"LIMIT {int(limit)}"
        )
        cols, rows = db.fetch_columns(sql, params)
        raw = list(iter_dict_rows(cols, rows))

        # Re-shape into {key: {...}, occurrences, source_files}
        data: list[dict] = []
        for r in raw:
            key = {c: r.get(c) for c in _DEDUPE_KEY_COLS}
            # ISO-format date values for JSON
            if key.get("Date") is not None:
                key["Date"] = str(key["Date"])
            data.append(
                {
                    "key": key,
                    "occurrences": int(r["occurrences"]),
                    "source_files": list(r["source_files"]) if r.get("source_files") else [],
                }
            )
        total = len(data)

    return data, total, t["ms"], applied


# ---------------------------------------------------------------------------
# Supplier concentration (HHI)
# ---------------------------------------------------------------------------

def supplier_concentration(
    db: DuckDBClient,
    *,
    importer: str,
    top_n: int = 10,
) -> tuple[dict[str, Any], float]:
    """Per-importer supplier concentration with Herfindahl index.

    HHI = sum of squared market-share percentages (0–10000).  > 2500 is the
    US-DOJ "highly concentrated" threshold; useful here for spotting
    single-source supply chains.
    """
    with timer() as t:
        # 1) Per-supplier aggregates for this importer.
        sql = (
            f"SELECT {quote_ident('Supplier')} AS supplier, "
            f"       COUNT(*) AS shipments, "
            f"       SUM({quote_ident('Value')}) AS total_value "
            f"FROM {TABLE} "
            f"WHERE {quote_ident('Importer')} ILIKE ? "
            f"GROUP BY supplier"
        )
        cols, rows = db.fetch_columns(sql, [f"%{importer}%"])
        per_supplier = list(iter_dict_rows(cols, rows))

        # 2) Totals.
        total_value = sum((r["total_value"] or 0.0) for r in per_supplier)
        total_suppliers = sum(1 for r in per_supplier if r["supplier"])

        # 3) Share + HHI.  Skip null-supplier rows from HHI so concentration
        # isn't artificially inflated by un-attributable shipments.
        hhi = 0.0
        for r in per_supplier:
            if not r["supplier"] or not total_value:
                r["share_pct"] = 0.0
                continue
            share = (r["total_value"] or 0.0) / total_value * 100.0
            r["share_pct"] = round(share, 4)
            hhi += share * share

        per_supplier.sort(key=lambda r: r["total_value"] or 0.0, reverse=True)
        top_suppliers = per_supplier[:top_n]

    return (
        {
            "importer": importer,
            "total_suppliers": total_suppliers,
            "total_value": total_value or None,
            "hhi": round(hhi, 2),
            "top_suppliers": top_suppliers,
        },
        t["ms"],
    )


# ---------------------------------------------------------------------------
# Product keyword extraction
# ---------------------------------------------------------------------------

# Bare-minimum English stopword list — enough to clean up the kind of
# noise we see in CTH descriptions ("FOR USE IN", "MATERIAL", etc.) without
# pulling NLTK as a dependency.
_STOPWORDS = frozenset(
    {
        "the", "a", "an", "and", "or", "of", "for", "in", "on", "to", "with",
        "from", "by", "as", "at", "is", "are", "be", "this", "that", "it",
        "not", "no", "&", "+", "/", "-", "x", "kg", "kgs", "gms", "mts",
        "ltr", "l", "ml", "pcs", "pc", "no", "nos", "qty", "use", "used",
        "other", "others", "material", "product", "products", "grade",
        "type", "model", "size", "color", "pack", "set", "free", "sample",
        "samples", "lot", "batch", "fob", "cif", "as", "per", "incoterms",
        "n/a", "na", "null", "none", "company", "ltd", "limited", "inc",
        "co", "purpose", "industrial", "purpose:", "make",
    }
)

_TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z\-]+")


def extract_keywords(
    db: DuckDBClient,
    f: FilterParams,
    *,
    limit: int = 50,
    sample_size: int = 100_000,
) -> tuple[list[dict], int, float, dict]:
    """Tokenise Product Description, return top keywords by frequency.

    Operates on a random sample for speed at crore-scale.  At the current
    672k row volume the sample == full table so results are exact.
    """
    with timer() as t:
        where, params, applied = build_where(f)
        non_null = f"{quote_ident('Product Description')} IS NOT NULL"
        full_where = f"{where} AND {non_null}" if where else f"WHERE {non_null}"

        # USING SAMPLE applies *after* WHERE so the sample respects filters.
        sql = (
            f"SELECT {quote_ident('Product Description')} AS pd "
            f"FROM {TABLE} {full_where} "
            f"USING SAMPLE reservoir({int(sample_size)} ROWS)"
        )
        rows = db.fetch_all(sql, params)

        counts: dict[str, int] = {}
        for (pd,) in rows:
            if not pd:
                continue
            for tok in _TOKEN_RE.findall(pd.lower()):
                if len(tok) < 3 or tok in _STOPWORDS:
                    continue
                counts[tok] = counts.get(tok, 0) + 1

        top = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:limit]
        data = [{"keyword": k, "occurrences": v} for k, v in top]

    return data, len(counts), t["ms"], applied
