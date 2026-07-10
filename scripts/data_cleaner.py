"""Type coercion, normalisation and de-duplication.

Input contract: every column is :class:`pl.String` and the column set matches
``cfg["standard_columns"]`` exactly (schema_mapper guarantees both).  Output
contract: typed columns ready for Parquet / DuckDB.
"""

from __future__ import annotations

import logging

import polars as pl

from .utils import normalize_country, to_iso_date

log = logging.getLogger(__name__)


# Columns we coerce to a real type.  Anything not listed stays as String.
DATE_COLS = ("Date",)
NUMERIC_COLS = ("Quantity", "Value", "Unit Price USD")
COUNTRY_COLS = ("Country", "Origin Country", "Destination Country")
UPPER_COLS = ("Currency", "Unit", "Trade Type", "Mode")
NULL_TOKENS_LOWER = ("", "n/a", "na", "null", "none", "-", "nil")


def _trim_and_nullify(df: pl.DataFrame) -> pl.DataFrame:
    """Strip whitespace and convert empty / sentinel strings to true nulls."""
    string_cols = [c for c, t in zip(df.columns, df.dtypes) if t == pl.String]
    if not string_cols:
        return df
    exprs = []
    for c in string_cols:
        trimmed = pl.col(c).str.strip_chars()
        # Treat common null sentinels as actual nulls.  Lowercase compare is
        # cheap and catches "Null"/"NULL"/"null" together.
        exprs.append(
            pl.when(trimmed.str.to_lowercase().is_in(list(NULL_TOKENS_LOWER)))
            .then(None)
            .otherwise(trimmed)
            .alias(c)
        )
    return df.with_columns(exprs)


def _coerce_dates(df: pl.DataFrame) -> pl.DataFrame:
    for c in DATE_COLS:
        if c not in df.columns:
            continue
        iso = df[c].map_elements(to_iso_date, return_dtype=pl.String)
        df = df.with_columns(iso.str.strptime(pl.Date, "%Y-%m-%d", strict=False).alias(c))
    return df


def _coerce_numerics(df: pl.DataFrame) -> pl.DataFrame:
    for c in NUMERIC_COLS:
        if c not in df.columns:
            continue
        # Strip thousands separators that occasionally sneak in.
        cleaned = pl.col(c).str.replace_all(",", "", literal=True)
        df = df.with_columns(cleaned.cast(pl.Float64, strict=False).alias(c))
    return df


def _normalise_countries(df: pl.DataFrame) -> pl.DataFrame:
    for c in COUNTRY_COLS:
        if c not in df.columns:
            continue
        df = df.with_columns(
            pl.col(c).map_elements(normalize_country, return_dtype=pl.String).alias(c)
        )
    return df


def _upper_categoricals(df: pl.DataFrame) -> pl.DataFrame:
    for c in UPPER_COLS:
        if c not in df.columns:
            continue
        df = df.with_columns(pl.col(c).str.to_uppercase().alias(c))
    return df


def _drop_empty_rows(df: pl.DataFrame, key_cols: list[str]) -> pl.DataFrame:
    """Drop rows where every meaningful column is null.

    Meta columns (Trade Type, HS Chapter, Source File) are populated
    unconditionally by the mapper, so excluding them avoids "false positives"
    where a junk row is kept just because the source filename is set.
    """
    meaningful = [c for c in df.columns if c not in {"Trade Type", "HS Chapter", "Source File"}]
    if not meaningful:
        return df
    return df.filter(
        pl.any_horizontal([pl.col(c).is_not_null() for c in meaningful])
    )


def _normalise_hsn(df: pl.DataFrame) -> pl.DataFrame:
    """Canonicalise HSN to a comparable code across countries.

    National customs codes are padded to different widths (India 8-digit,
    Turkey 12, Philippines 11, Russia 10, ...) with trailing statistical zeros.
    We strip non-digits and truncate to the 8-digit international HS code so the
    same product matches and groups consistently across every market. Codes
    shorter than 8 (e.g. a bare '29' chapter) are left as-is.
    """
    if "HSN" not in df.columns:
        return df
    digits = pl.col("HSN").cast(pl.String).str.replace_all(r"\D", "")
    norm = pl.when(digits.str.len_chars() > 8).then(digits.str.slice(0, 8)).otherwise(digits)
    return df.with_columns(
        pl.when(norm.str.len_chars() == 0).then(None).otherwise(norm).alias("HSN")
    )


def _fill_hs_chapter_from_hsn(df: pl.DataFrame) -> pl.DataFrame:
    """Fill a NULL HS Chapter from the first 2 digits of the HSN code.

    Runs after null-normalisation, so 'NA'/'None'/'' chapter cells are already
    real NULLs by now. Only fills NULLs — the India 4-digit convention ('3808')
    on already-populated rows is left untouched.
    """
    if "HS Chapter" not in df.columns or "HSN" not in df.columns:
        return df
    hsn_ch = pl.col("HSN").cast(pl.String).str.replace_all(r"\D", "").str.slice(0, 2)
    hsn_ch = pl.when(hsn_ch.str.len_chars() == 2).then(hsn_ch).otherwise(None)
    return df.with_columns(
        pl.coalesce([pl.col("HS Chapter"), hsn_ch]).alias("HS Chapter")
    )


def clean_dataframe(df: pl.DataFrame) -> pl.DataFrame:
    """Run the full cleaning pipeline."""
    df = _trim_and_nullify(df)
    df = _normalise_hsn(df)
    df = _fill_hs_chapter_from_hsn(df)
    df = _normalise_countries(df)
    df = _upper_categoricals(df)
    df = _coerce_dates(df)
    df = _coerce_numerics(df)
    df = _drop_empty_rows(df, df.columns)
    # Per-file dedupe.  Cross-file dedupe happens later in DuckDB once all
    # shards are concatenated.
    before = df.height
    df = df.unique(keep="first")
    after = df.height
    if before != after:
        log.debug("Per-file dedupe removed %d rows", before - after)
    return df
