"""Map per-file source columns onto the canonical schema.

Order of precedence for each source header:
    1. ``ignore``        — drop the column silently
    2. ``merge_groups``  — concatenated into one target (addresses, etc.)
    3. ``mappings``      — exact normalised-key match
    4. fuzzy fallback    — RapidFuzz against the set of known keys, strict cutoff

Every decision (including "no match") is appended to ``mapping_report`` so the
column_mapping_report.xlsx can be reviewed after each run.  Unmapped columns
are kept out of the output silently per spec ("ignore unknown columns safely").
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import polars as pl

from .utils import fuzzy_pick, normalize_header

log = logging.getLogger(__name__)

_CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


@lru_cache(maxsize=1)
def _port_country_map() -> dict[str, str]:
    """Load Port-of-Destination -> country lookup (keys lowercased)."""
    p = _CONFIG_DIR / "port_country.json"
    if not p.exists():
        return {}
    raw = json.loads(p.read_text(encoding="utf-8"))
    return {k.strip().lower(): v for k, v in raw.items() if not k.startswith("_")}


@dataclass
class MappingDecision:
    source_file: str
    source_column: str
    normalised: str
    target_column: str | None
    strategy: str          # "exact" | "fuzzy" | "merge_group" | "ignored" | "unmapped"
    fuzzy_score: int | None = None


@dataclass
class MappingReport:
    rows: list[MappingDecision] = field(default_factory=list)

    def add(self, d: MappingDecision) -> None:
        self.rows.append(d)

    def to_polars(self) -> pl.DataFrame:
        if not self.rows:
            return pl.DataFrame(
                schema={
                    "source_file": pl.String,
                    "source_column": pl.String,
                    "normalised": pl.String,
                    "target_column": pl.String,
                    "strategy": pl.String,
                    "fuzzy_score": pl.Int64,
                }
            )
        return pl.DataFrame(
            {
                "source_file": [r.source_file for r in self.rows],
                "source_column": [r.source_column for r in self.rows],
                "normalised": [r.normalised for r in self.rows],
                "target_column": [r.target_column for r in self.rows],
                "strategy": [r.strategy for r in self.rows],
                "fuzzy_score": [r.fuzzy_score for r in self.rows],
            }
        )


def _build_lookup(cfg: dict) -> tuple[dict[str, str], dict[str, str], set[str]]:
    """Expand config into fast lookup dicts.

    Returns:
        direct:        normalised_source → target column   (exact mappings)
        group_member:  normalised_source → target column   (merge groups)
        ignored:       set of normalised_source keys to drop
    """
    direct: dict[str, str] = {normalize_header(k): v for k, v in cfg["mappings"].items()}
    group_member: dict[str, str] = {}
    for target, members in cfg["merge_groups"].items():
        for m in members:
            group_member[normalize_header(m)] = target
    ignored = {normalize_header(k) for k in cfg["ignore"]}
    return direct, group_member, ignored


def map_dataframe(
    df: pl.DataFrame,
    *,
    source_path: Path,
    cfg: dict,
    file_metadata: dict[str, str | None],
    report: MappingReport,
) -> pl.DataFrame:
    """Return a new DataFrame matching ``cfg['standard_columns']`` exactly.

    Multiple source columns may feed one target (last-write-wins for plain
    mappings; pipe-joined for merge groups).  Missing targets are filled with
    Nulls.  Columns outside the standard schema are dropped.
    """
    direct, group_member, ignored = _build_lookup(cfg)
    standard = cfg["standard_columns"]
    standard_set = set(standard)
    all_target_keys = set(direct.values()) | set(group_member.values())
    known_norm_keys = list(direct.keys())

    # Accumulate per-target expressions.  For merge groups we collect a list
    # of source columns, then concat-with-separator at the end.
    target_singletons: dict[str, str] = {}            # target → source col name
    target_groups: dict[str, list[str]] = {}          # target → list of source col names

    for col in df.columns:
        norm = normalize_header(col)

        if norm in ignored:
            report.add(MappingDecision(source_path.name, col, norm, None, "ignored"))
            continue

        if norm in group_member:
            target = group_member[norm]
            target_groups.setdefault(target, []).append(col)
            report.add(MappingDecision(source_path.name, col, norm, target, "merge_group"))
            continue

        if norm in direct:
            target = direct[norm]
            target_singletons[target] = col      # last source wins; OK for our data
            report.add(MappingDecision(source_path.name, col, norm, target, "exact"))
            continue

        # Fuzzy fallback — strict cutoff, ignores already-very-short keys
        # which fuzz to anything.
        if len(norm) >= 4:
            pick = fuzzy_pick(norm, known_norm_keys, score_cutoff=88)
            if pick is not None:
                matched_norm, score = pick
                target = direct[matched_norm]
                target_singletons.setdefault(target, col)
                report.add(
                    MappingDecision(
                        source_path.name, col, norm, target, "fuzzy", fuzzy_score=score
                    )
                )
                continue

        # Nothing matched — drop the column, record it for review.
        report.add(MappingDecision(source_path.name, col, norm, None, "unmapped"))

    # Build the projected DataFrame in canonical order.
    exprs: list[pl.Expr] = []
    for target in standard:
        if target == "Trade Type":
            exprs.append(pl.lit(file_metadata.get("trade_type")).alias("Trade Type"))
            continue
        if target == "Reporting Country":
            exprs.append(pl.lit(file_metadata.get("reporting_country")).alias("Reporting Country"))
            continue
        if target == "HS Chapter":
            # Prefer the row's own Chapter column (multi-chapter files carry
            # both 29 and 38); fall back to the filename-derived chapter.
            fname_ch = file_metadata.get("hs_chapter")
            if target in target_singletons:
                src = target_singletons[target]
                exprs.append(
                    pl.coalesce([pl.col(src).cast(pl.String), pl.lit(fname_ch)]).alias("HS Chapter")
                )
            else:
                exprs.append(pl.lit(fname_ch).alias("HS Chapter"))
            continue
        if target == "Source File":
            exprs.append(pl.lit(source_path.name).alias("Source File"))
            continue

        if target in target_groups:
            cols = target_groups[target]
            # concat_str doesn't skip nulls cleanly across many cols, so we
            # coalesce-with-empty-string then trim and collapse double-pipes.
            joined = pl.concat_str(
                [pl.col(c).fill_null("").cast(pl.String) for c in cols],
                separator=" | ",
            )
            # Clean up: collapse runs of separator that came from null parts.
            cleaned = (
                joined
                .str.replace_all(r"(\s\|\s){2,}", " | ")
                .str.strip_chars(" |")
            )
            exprs.append(
                pl.when(cleaned.str.len_chars() == 0)
                .then(None)
                .otherwise(cleaned)
                .alias(target)
            )
            continue

        if target in target_singletons:
            src = target_singletons[target]
            exprs.append(pl.col(src).cast(pl.String).alias(target))
            continue

        # Target absent from this file — fill with nulls of the right type.
        exprs.append(pl.lit(None, dtype=pl.String).alias(target))

    out = df.select(exprs)
    out = _prefer_usd_total_value(out, df)
    out = _derive_value(out, df)
    out = _derive_unit_price_usd(out, df)
    out = _derive_destination_from_port(out, df)
    out = _use_indian_port_for_imports(out, df, file_metadata.get("trade_type"))
    out = _stamp_usd_currency(out, df)
    return _consolidate_countries(
        out,
        file_metadata.get("trade_type"),
        file_metadata.get("reporting_country") or "INDIA",
    )


def _use_indian_port_for_imports(
    out: pl.DataFrame, raw: pl.DataFrame, trade_type: str | None
) -> pl.DataFrame:
    """On IMPORT files, prefer 'Port of Destination' (the Indian entry port,
    e.g. JNPT) for the ``Port`` column over the foreign loading port.

    Keeps ``Port`` semantically consistent across directions: it is always the
    INDIAN port (exports already map their Indian 'Port of Origin' to Port).
    """
    if trade_type != "IMPORT" or "Port" not in out.columns:
        return out
    dest_col = next(
        (c for c in raw.columns if normalize_header(c) == "portofdestination"), None
    )
    if dest_col is None:
        return out
    out = out.with_columns(
        raw.get_column(dest_col).cast(pl.String).alias("_dest_port_raw")
    )
    cleaned = pl.col("_dest_port_raw").str.strip_chars()
    cleaned = pl.when(cleaned.str.len_chars() == 0).then(None).otherwise(cleaned)
    return out.with_columns(
        pl.coalesce([cleaned, pl.col("Port")]).alias("Port")
    ).drop("_dest_port_raw")


def _derive_unit_price_usd(out: pl.DataFrame, raw: pl.DataFrame) -> pl.DataFrame:
    """Fill ``Unit Price USD`` from the invoice FC price when currency is USD.

    Several import files have no explicit USD unit-price column but do carry
    ``Invoice_Unit_Price_FC`` (price in the invoice currency) alongside
    ``INVOICE_CURRENCY``. When that currency is USD, the FC price *is* the USD
    unit price — so we use it directly (no conversion). Explicit USD columns
    (UNIT RATE(USD), Unit_Price USD, Estimated Unit $ …) are already mapped.
    """
    if "Unit Price USD" not in out.columns or "Currency" not in out.columns:
        return out
    fc_col = next(
        (c for c in raw.columns if normalize_header(c) == "invoiceunitpricefc"), None
    )
    if fc_col is None:
        return out

    out = out.with_columns(raw.get_column(fc_col).cast(pl.String).alias("_fc_price"))
    derived = (
        pl.when(
            pl.col("Unit Price USD").is_null()
            & (pl.col("Currency").cast(pl.String).str.to_uppercase() == "USD")
            & pl.col("_fc_price").is_not_null()
        )
        .then(pl.col("_fc_price"))
        .otherwise(pl.col("Unit Price USD"))
        .alias("Unit Price USD")
    )
    return out.with_columns(derived).drop("_fc_price")


def _derive_destination_from_port(out: pl.DataFrame, raw: pl.DataFrame) -> pl.DataFrame:
    """Fill ``Destination Country`` from ``Port of Destination`` via a port map.

    The updated India export 3808 dump carries only a destination *port* (e.g.
    'Birgunj', 'Santos'), not a country. We resolve the country from
    config/port_country.json so country-level export filters keep working.
    Only fills where Destination Country is currently empty.
    """
    if "Destination Country" not in out.columns:
        return out
    port_col = next(
        (c for c in raw.columns if normalize_header(c) == "portofdestination"), None
    )
    if port_col is None:
        return out
    pmap = _port_country_map()
    if not pmap:
        return out

    mapped = (
        raw.get_column(port_col).cast(pl.String)
        .str.strip_chars().str.to_lowercase()
        .replace_strict(pmap, default=None, return_dtype=pl.String)
    )
    out = out.with_columns(mapped.alias("_dest_from_port"))
    return out.with_columns(
        pl.coalesce([pl.col("Destination Country"), pl.col("_dest_from_port")])
        .alias("Destination Country")
    ).drop("_dest_from_port")


def _prefer_usd_total_value(out: pl.DataFrame, raw: pl.DataFrame) -> pl.DataFrame:
    """Force ``Value`` to the file's USD total when it has one.

    Many feeds carry both a USD total (``Total_Value_in_USD``) and a local-
    currency ``Invoice_Value``/``Total_Value_in_VND``. Header-order precedence
    could otherwise let the local-currency column win (e.g. Vietnam values in
    VND). Using the explicit USD total keeps ``Value`` comparable across markets.
    """
    if "Value" not in out.columns:
        return out
    col = next((c for c in raw.columns if normalize_header(c) == "totalvalueinusd"), None)
    if col is None:
        return out
    out = out.with_columns(raw.get_column(col).cast(pl.String).alias("_usd_total"))
    v = pl.col("_usd_total").str.strip_chars()
    v = pl.when(v.str.len_chars() == 0).then(None).otherwise(v)
    return out.with_columns(pl.coalesce([v, pl.col("Value")]).alias("Value")).drop("_usd_total")


def _stamp_usd_currency(out: pl.DataFrame, raw: pl.DataFrame) -> pl.DataFrame:
    """Set Currency='USD' for files whose ``Value`` is an explicit USD column.

    These feeds store the trade value in USD, so the Currency column must say
    USD to match (overriding any local invoice currency that may have mapped in
    — otherwise Value/Currency disagree).
    """
    if "Currency" not in out.columns:
        return out
    has_usd_value = any(
        normalize_header(c) in {"estimatedvalue", "estimatedunit",
                                "totalvalueinusd", "unitpriceinusd",
                                "valuefob", "valuecif", "valuefobus",
                                "valuecifus", "fobvalueus", "totalvaluecif",
                                "totalvaluefob", "unitpriceus",
                                "fobvalue", "unitrate"}
        for c in raw.columns
    )
    if not has_usd_value:
        return out
    return out.with_columns(pl.lit("USD").alias("Currency"))


# Raw source headers (normalised) that carry a per-unit price in INR.  Used to
# rebuild "Value" for months whose files lack a total-value column.
_UNIT_PRICE_KEYS = {"unitprice", "unitrateininr", "unitpriceininr", "unitpriceinr"}


def _derive_value(out: pl.DataFrame, raw: pl.DataFrame) -> pl.DataFrame:
    """Fill ``Value`` = Quantity x Unit_Price where the total is missing.

    Several monthly files (e.g. chapter-29 imports for JAN/FEB/MAY) ship no
    TOTAL_ASS_VALUE column, so ``Value`` ends up NULL.  Those files DO carry a
    per-unit INR price (``Unit_Price``), which is dropped by the ignore list.
    Here we read it straight from the raw frame (same row order) and rebuild the
    assessable value.  Verified: Unit_Price x Quantity == TOTAL_ASS_VALUE on
    files that have both.
    """
    if "Value" not in out.columns or "Quantity" not in out.columns:
        return out
    up_col = next(
        (c for c in raw.columns if normalize_header(c) in _UNIT_PRICE_KEYS), None
    )
    if up_col is None:
        return out

    out = out.with_columns(raw.get_column(up_col).cast(pl.String).alias("_unit_price_src"))

    def _num(col: str) -> pl.Expr:
        return pl.col(col).str.replace_all(",", "", literal=True).cast(pl.Float64, strict=False)

    derived = (
        pl.when(_num("Value").is_null() & _num("Quantity").is_not_null()
                & _num("_unit_price_src").is_not_null())
        .then((_num("Quantity") * _num("_unit_price_src")).round(3).cast(pl.String))
        .otherwise(pl.col("Value"))
        .alias("Value")
    )
    return out.with_columns(derived).drop("_unit_price_src")


def _nz(colname: str) -> pl.Expr:
    """Column value, but empty / whitespace-only strings become NULL."""
    c = pl.col(colname).cast(pl.String).str.strip_chars()
    return pl.when(c.str.len_chars() == 0).then(None).otherwise(c)


def _consolidate_countries(
    df: pl.DataFrame, trade_type: str | None, reporting_country: str = "INDIA"
) -> pl.DataFrame:
    """Normalise country AND party columns using trade direction + reporting country.

    ``reporting_country`` is the customs authority's own country (INDIA for the
    India dumps, AUSTRALIA for Australia's imports, etc.). The DOMESTIC side of a
    shipment is always the reporting country; the foreign counterparty lands in
    Origin/Destination/Country under many different source headers.

        EXPORT  -> Origin = <reporting>,      Destination = foreign country
        IMPORT  -> Destination = <reporting>, Origin      = foreign country

    Parties — clean 4-role model. Each column is single-purpose and NULL on the
    opposite direction, so a table-wide COUNT(DISTINCT) is a true single-role
    cardinality. The frontend shows the right name via coalesced columns
    (Importer ?? Buyer, Supplier ?? Exporter):
        EXPORT  -> Exporter = domestic exporter (kept); Buyer = foreign buyer
        IMPORT  -> Importer = domestic importer (kept); Supplier = foreign seller
    """
    if trade_type not in ("EXPORT", "IMPORT"):
        return df

    rc = (reporting_country or "INDIA").upper()

    def foreign_country(colname: str) -> pl.Expr:
        # Drop blanks and any value equal to the reporting country (e.g. the
        # file's own "Country" column = AUSTRALIA on Australian imports).
        c = pl.col(colname).cast(pl.String).str.strip_chars()
        return (
            pl.when((c.str.to_uppercase() == rc) | (c.str.len_chars() == 0))
            .then(None)
            .otherwise(c)
        )

    null_str = pl.lit(None, dtype=pl.String)

    if trade_type == "EXPORT":
        partner_country = pl.coalesce([foreign_country("Destination Country"),
                                       foreign_country("Country"),
                                       foreign_country("Origin Country")])
        foreign_buyer = pl.coalesce([_nz("Buyer"), _nz("Importer")])
        return df.with_columns([
            # geography
            pl.lit(rc).alias("Origin Country"),
            partner_country.alias("Destination Country"),
            partner_country.alias("Country"),
            # parties: Exporter kept = domestic exporter; foreign buyer -> Buyer only
            foreign_buyer.alias("Buyer"),
            null_str.alias("Importer"),
            null_str.alias("Supplier"),
        ])
    else:  # IMPORT
        partner_country = pl.coalesce([foreign_country("Origin Country"),
                                       foreign_country("Country"),
                                       foreign_country("Destination Country")])
        foreign_seller = pl.coalesce([_nz("Supplier"), _nz("Exporter")])
        # Some import dumps carry the domestic importer under a consignee header
        # (mapped to Buyer) instead of an ImporterName column — fold it in.
        domestic_importer = pl.coalesce([_nz("Importer"), _nz("Buyer")])
        return df.with_columns([
            # geography
            partner_country.alias("Origin Country"),
            pl.lit(rc).alias("Destination Country"),
            partner_country.alias("Country"),
            # parties: Importer = domestic importer; foreign seller -> Supplier only
            domestic_importer.alias("Importer"),
            foreign_seller.alias("Supplier"),
            null_str.alias("Exporter"),
            null_str.alias("Buyer"),
        ])
