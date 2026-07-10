"""Autosuggest + similar-company fuzzy matching.

For autosuggest we hit DuckDB directly (a single ILIKE LIMIT 10 query is
under 10ms on this dataset).  For "similar" we load the distinct entity
list once, cache it, and run RapidFuzz against it — which is a few
milliseconds for ~10k distinct entities.
"""

from __future__ import annotations

import logging
import threading
import time

from rapidfuzz import fuzz, process

from app.database import DuckDBClient
from app.models import PARTY_COLUMNS, TABLE, quote_ident
from app.utils import timer

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Autosuggest
# ---------------------------------------------------------------------------

def suggest(
    db: DuckDBClient,
    *,
    field: str,
    query: str,
    limit: int = 10,
) -> tuple[list[str], float]:
    if field not in PARTY_COLUMNS:
        raise ValueError(f"Unsupported suggest field '{field}'")
    if not query or len(query) < 2:
        return [], 0.0

    with timer() as t:
        # Prefix match for the first 80% of results, substring for the rest —
        # gives faster, more relevant suggestions than pure substring.
        sql = (
            f"SELECT DISTINCT {quote_ident(field)} AS v "
            f"FROM {TABLE} "
            f"WHERE {quote_ident(field)} ILIKE ? "
            f"ORDER BY v "
            f"LIMIT {int(limit)}"
        )
        rows = db.fetch_all(sql, [f"{query}%"])
        out = [r[0] for r in rows if r[0]]

        # Top up with substring matches if prefix didn't fill the page.
        if len(out) < limit:
            need = limit - len(out)
            sql2 = (
                f"SELECT DISTINCT {quote_ident(field)} AS v "
                f"FROM {TABLE} "
                f"WHERE {quote_ident(field)} ILIKE ? "
                f"  AND {quote_ident(field)} NOT ILIKE ? "
                f"ORDER BY v "
                f"LIMIT {int(need)}"
            )
            rows2 = db.fetch_all(sql2, [f"%{query}%", f"{query}%"])
            out.extend(r[0] for r in rows2 if r[0])

    return out, t["ms"]


# ---------------------------------------------------------------------------
# Distinct-entity cache for similar-company matching
# ---------------------------------------------------------------------------

_distinct_cache: dict[str, tuple[float, list[tuple[str, int]]]] = {}
_distinct_lock = threading.Lock()


def _load_distinct(db: DuckDBClient, field: str, ttl: int) -> list[tuple[str, int]]:
    """Return cached [(name, shipments), ...] for the given party field."""
    now = time.time()
    with _distinct_lock:
        cached = _distinct_cache.get(field)
        if cached and now - cached[0] < ttl:
            return cached[1]

    sql = (
        f"SELECT {quote_ident(field)} AS name, COUNT(*) AS shipments "
        f"FROM {TABLE} "
        f"WHERE {quote_ident(field)} IS NOT NULL "
        f"GROUP BY name"
    )
    rows = db.fetch_all(sql)
    data = [(str(r[0]), int(r[1])) for r in rows]
    with _distinct_lock:
        _distinct_cache[field] = (now, data)
    log.info("Refreshed distinct cache for %s — %d entries", field, len(data))
    return data


# ---------------------------------------------------------------------------
# Similar entities (fuzzy match)
# ---------------------------------------------------------------------------

def similar_entities(
    db: DuckDBClient,
    *,
    field: str,
    query: str,
    limit: int = 10,
    cache_ttl: int = 600,
    score_cutoff: int = 70,
) -> tuple[list[dict], float]:
    if field not in PARTY_COLUMNS:
        raise ValueError(f"Unsupported similar field '{field}'")
    if not query:
        return [], 0.0

    with timer() as t:
        distinct = _load_distinct(db, field, ttl=cache_ttl)
        names = [n for n, _ in distinct]
        shipment_counts = {n: c for n, c in distinct}

        # WRatio handles substring + prefix + transposition robustly.
        # processor=str.lower normalises case — the dataset stores company
        # names in UPPER but callers usually type mixed case.
        matches = process.extract(
            query,
            names,
            scorer=fuzz.WRatio,
            processor=str.lower,
            limit=limit,
            score_cutoff=score_cutoff,
        )
        out = [
            {
                "name": name,
                "score": int(score),
                "shipments": shipment_counts.get(name, 0),
            }
            for name, score, _ in matches
        ]

    return out, t["ms"]


def warm_distinct_cache(db: DuckDBClient, ttl: int = 600) -> None:
    """Pre-load distinct lists for every party column at startup.

    Optional — the cache lazily fills on first /similar call too.  Warming
    avoids the ~50-100ms first-hit penalty in production.
    """
    for col in PARTY_COLUMNS:
        try:
            _load_distinct(db, col, ttl=ttl)
        except Exception as e:  # noqa: BLE001
            log.warning("Could not warm cache for %s: %s", col, e)


def clear_distinct_cache() -> None:
    with _distinct_lock:
        _distinct_cache.clear()
