"""Shared helpers: logging, header normalisation, fuzzy matching, value coercion.

Everything in this module is pure / side-effect-free (except :func:`setup_logging`
which configures the root logger).  Keeping these helpers small and dependency-light
makes them safe to reuse from every other module in the pipeline.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, date
from pathlib import Path
from typing import Iterable

from rapidfuzz import fuzz, process


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging(log_dir: Path, level: int = logging.INFO) -> logging.Logger:
    """Configure root logger with a file + console handler.

    All pipeline modules call ``logging.getLogger(__name__)`` so this only
    needs to be called once from ``main.py``.
    """
    log_dir.mkdir(parents=True, exist_ok=True)
    processing_log = log_dir / "processing_log.txt"
    error_log = log_dir / "error_report.txt"

    root = logging.getLogger()
    root.setLevel(level)
    # Reset on re-runs so duplicate handlers don't pile up in long sessions.
    root.handlers.clear()

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    fh = logging.FileHandler(processing_log, encoding="utf-8", mode="w")
    fh.setLevel(level)
    fh.setFormatter(fmt)
    root.addHandler(fh)

    eh = logging.FileHandler(error_log, encoding="utf-8", mode="w")
    eh.setLevel(logging.WARNING)
    eh.setFormatter(fmt)
    root.addHandler(eh)

    # Force UTF-8 on the console stream so log messages with non-ASCII
    # characters (arrows, currency symbols, etc.) don't blow up on the
    # Windows default cp1252 codepage.
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(level)
    ch.setFormatter(fmt)
    root.addHandler(ch)

    return root


# ---------------------------------------------------------------------------
# Header normalisation + fuzzy match
# ---------------------------------------------------------------------------

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_header(name: str | None) -> str:
    """Lower-case + strip all non-alphanumerics.

    "BE_Date" / "BE Date" / "be-date" all collapse to "bedate".  This is the
    key used to look up canonical mappings in column_mapping.json.
    """
    if name is None:
        return ""
    return _NON_ALNUM.sub("", str(name).strip().lower())


def fuzzy_pick(
    needle: str,
    haystack: Iterable[str],
    score_cutoff: int = 86,
) -> tuple[str, int] | None:
    """Return (best_match, score) above ``score_cutoff`` or ``None``.

    Used only when a header isn't in the static mapping — we don't want to
    silently misroute a column with a coincidental fuzzy match, so the cutoff
    is intentionally strict.
    """
    needle = needle or ""
    haystack = list(haystack)
    if not needle or not haystack:
        return None
    match = process.extractOne(needle, haystack, scorer=fuzz.WRatio)
    if match is None:
        return None
    name, score, _ = match
    if score >= score_cutoff:
        return name, int(score)
    return None


# ---------------------------------------------------------------------------
# Mapping config loader
# ---------------------------------------------------------------------------

def load_mapping_config(path: Path) -> dict:
    """Load + lightly validate column_mapping.json."""
    with path.open("r", encoding="utf-8") as f:
        cfg = json.load(f)
    for required in ("standard_columns", "mappings"):
        if required not in cfg:
            raise ValueError(f"column_mapping.json is missing '{required}'")
    cfg.setdefault("merge_groups", {})
    cfg.setdefault("ignore", [])
    return cfg


# ---------------------------------------------------------------------------
# Country normalisation
# ---------------------------------------------------------------------------

# Small alias map; extend in config later if needed.  We deliberately keep this
# tight — over-eager fuzzy country matching turns "GERMANY" into "GUERNSEY".
_COUNTRY_ALIASES = {
    "USA": "UNITED STATES",
    "U.S.A.": "UNITED STATES",
    "US": "UNITED STATES",
    "U.S.": "UNITED STATES",
    "AMERICA": "UNITED STATES",
    "UNITED STATES OF AMERICA": "UNITED STATES",
    "UK": "UNITED KINGDOM",
    "U.K.": "UNITED KINGDOM",
    "BRITAIN": "UNITED KINGDOM",
    "GREAT BRITAIN": "UNITED KINGDOM",
    "ENGLAND": "UNITED KINGDOM",
    "UAE": "UNITED ARAB EMIRATES",
    "U.A.E.": "UNITED ARAB EMIRATES",
    "KOREA": "SOUTH KOREA",
    "KOREA, REPUBLIC OF": "SOUTH KOREA",
    "REPUBLIC OF KOREA": "SOUTH KOREA",
    "PRC": "CHINA",
    "PEOPLES REPUBLIC OF CHINA": "CHINA",
    "HONGKONG": "HONG KONG",
    "VIETNAM": "VIET NAM",
    "RUSSIA": "RUSSIAN FEDERATION",
    "TAIWAN, PROVINCE OF CHINA": "TAIWAN",
    "CHINESE TAIPEI": "TAIWAN",
}


def normalize_country(value: object) -> object:
    """UPPER-case, trim, then apply alias map.  Null / 'N/A' / 'Null' → None."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in {"n/a", "na", "null", "none", "-"}:
        return None
    s = s.upper()
    return _COUNTRY_ALIASES.get(s, s)


# ---------------------------------------------------------------------------
# Filename-based metadata derivation
# ---------------------------------------------------------------------------

_HS_CHAPTER_RE = re.compile(r"\b(\d{2,4})\b")

# Reporting country = the country whose customs feed a file represents.
# Detected from the filename; defaults to INDIA when no country is named
# (the original India dumps are named "29 ALL PORTS IMPORT ...", etc.).
# name-in-filename -> canonical reporting country (UPPERCASE, matches country data)
_REPORTING_COUNTRIES = {
    "AUSTRALIA": "AUSTRALIA", "COLOMBIA": "COLOMBIA", "PERU": "PERU",
    "TURKEY": "TURKEY", "VIETNAM": "VIETNAM", "VIET NAM": "VIETNAM",
    "ARGENTINA": "ARGENTINA", "UGANDA": "UGANDA", "RUSSIA": "RUSSIA",
    "TANZANIA": "TANZANIA", "ETHIOPIA": "ETHIOPIA", "ECUADOR": "ECUADOR",
    "BOLIVIA": "BOLIVIA", "PHILIPPINES": "PHILIPPINES", "KENYA": "KENYA",
    "NIGERIA": "NIGERIA", "MEXICO": "MEXICO", "BRAZIL": "BRAZIL",
    "EGYPT": "EGYPT", "INDONESIA": "INDONESIA", "ZIMBABWE": "ZIMBABWE",
    "ZAMBIA": "ZAMBIA", "SOUTH AFRICA": "SOUTH AFRICA",
}


def derive_metadata_from_filename(path: Path) -> dict[str, str | None]:
    """Pull (trade_type, hs_chapter, reporting_country) from the filename,
    e.g. ``Turkey Import Chapter 29 and 38 Last 3 Year.xlsx`` or the original
    ``3808 ALL EXPORT TO WORLD APR 25.xlsx``.
    """
    stem = path.stem.upper()

    if "EXPORT" in stem:
        trade_type = "EXPORT"
    elif "IMPORT" in stem:
        trade_type = "IMPORT"
    else:
        trade_type = None

    hs_chapter: str | None = None
    m = _HS_CHAPTER_RE.search(stem)
    if m:
        # First numeric token is the HS chapter/heading prefix ("29", "3808").
        # For multi-chapter files this is only a FALLBACK — the per-row
        # "Chapter" column (when present) takes precedence in the mapper.
        hs_chapter = m.group(1)

    reporting_country = "INDIA"
    for token, canon in _REPORTING_COUNTRIES.items():
        if token in stem:
            reporting_country = canon
            break

    return {
        "trade_type": trade_type,
        "hs_chapter": hs_chapter,
        "reporting_country": reporting_country,
    }


# ---------------------------------------------------------------------------
# Coercion helpers used by the cleaner
# ---------------------------------------------------------------------------

_NULL_TOKENS = {"", "n/a", "na", "null", "none", "-", "nil"}


def is_null_token(v: object) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and v != v:  # NaN
        return True
    if isinstance(v, str) and v.strip().lower() in _NULL_TOKENS:
        return True
    return False


def to_iso_date(v: object) -> str | None:
    """Best-effort coercion to ``YYYY-MM-DD``.

    Handles Python ``date``/``datetime``, Excel-style strings, and the
    YYYYMM ``Period`` integers (treated as the 1st of that month).
    Returns ``None`` for anything unparseable so the cleaner can keep going.
    """
    if is_null_token(v):
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    # YYYYMM (e.g. "202512")
    if re.fullmatch(r"\d{6}", s):
        try:
            return date(int(s[:4]), int(s[4:]), 1).isoformat()
        except ValueError:
            return None
    # Already ISO date, optionally followed by a time component
    # (Calamine renders datetime cells as "YYYY-MM-DD HH:MM:SS").
    m_iso = re.match(r"(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$", s)
    if m_iso:
        return m_iso.group(1)
    # Strip a trailing time component from day-first strings, e.g.
    # "28-02-2026 00:00" (the Vietnam CSV feed) -> "28-02-2026".
    m_dt = re.match(r"(\d{1,2}[-/]\d{1,2}[-/]\d{4})[ T]\d{1,2}:\d{2}", s)
    if m_dt:
        s = m_dt.group(1)
    # Try a few common formats explicitly to avoid the dateutil dependency
    # interpreting ambiguous strings (e.g. 01/02/25) inconsistently.
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%Y/%m/%d", "%d-%b-%Y", "%d %b %Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None
