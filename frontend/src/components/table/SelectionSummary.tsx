/**
 * Row-selection summary helpers for the DataTable's selection bar.
 *
 * Two sources feed the same metric shape:
 *   - client-side, from the specific rows the user ticked on the page
 *   - server-side, from the "/aggregate" endpoints when the user chooses
 *     "select all N matching" (the ENTIRE filtered set, across all pages)
 *
 * Both must compute the SAME way (sum quantity/value, MEAN of per-unit prices)
 * so the number doesn't jump when switching modes.
 */
import { formatCompactMoney, formatInt, formatNumber } from "@/utils/format";
import type { ShipmentAggregate, ShipmentRecord } from "@/types/api";
import type { ArgentinaAggregate, ArgentinaRecord } from "@/types/argentina";

export interface SummaryStat {
  label: string;
  value: string;
}

export function SummaryStats({ stats }: { stats: SummaryStat[] }) {
  return (
    <>
      {stats.map((s) => (
        <span key={s.label} className="whitespace-nowrap">
          <span className="text-muted-foreground">{s.label}:</span>{" "}
          <span className="font-semibold text-foreground">{s.value}</span>
        </span>
      ))}
    </>
  );
}

// --- number helpers ---------------------------------------------------------
function sum(vals: number[]): number {
  return vals.reduce((a, b) => a + b, 0);
}
/**
 * Sum, but null (→ "—") when there are no numeric values — mirrors SQL SUM
 * over all-NULL rows (which returns NULL, not 0), so the client-side and
 * server-side summaries agree instead of one showing a misleading "0".
 */
function sumOrNull(vals: number[]): number | null {
  return vals.length ? sum(vals) : null;
}
function nums(rows: Record<string, unknown>[], key: string): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number" && !Number.isNaN(v)) out.push(v);
  }
  return out;
}
function mean(vals: number[]): number | null {
  return vals.length ? sum(vals) / vals.length : null;
}
/** Compact USD for per-unit prices (2 dp) — null-safe. */
function usd(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// --- India / global shipments table ----------------------------------------
export function shipmentSelectionStats(rows: ShipmentRecord[]): SummaryStat[] {
  const r = rows as unknown as Record<string, unknown>[];
  return [
    { label: "Shipments", value: formatInt(rows.length) },
    { label: "Total qty", value: formatNumber(sumOrNull(nums(r, "Quantity"))) },
    { label: "Total value", value: formatCompactMoney(sumOrNull(nums(r, "Value"))) },
    { label: "Avg unit (USD)", value: usd(mean(nums(r, "Unit Price USD"))) },
  ];
}

export function shipmentAggregateStats(
  agg: ShipmentAggregate | undefined,
  loading: boolean
): SummaryStat[] {
  if (loading || !agg) return [{ label: "Calculating", value: "…" }];
  return [
    { label: "Shipments", value: formatInt(agg.count) },
    { label: "Total qty", value: formatNumber(agg.total_quantity) },
    { label: "Total value", value: formatCompactMoney(agg.total_value) },
    { label: "Avg unit (USD)", value: usd(agg.avg_unit_price_usd) },
  ];
}

// --- Argentina imports table ------------------------------------------------
export function argentinaSelectionStats(rows: ArgentinaRecord[]): SummaryStat[] {
  const r = rows as unknown as Record<string, unknown>[];
  return [
    { label: "Shipments", value: formatInt(rows.length) },
    { label: "Total qty", value: formatNumber(sumOrNull(nums(r, "quantity"))) },
    { label: "Avg unit FOB", value: usd(mean(nums(r, "fob_unit_usd"))) },
    { label: "Avg unit CIF", value: usd(mean(nums(r, "cif_unit_usd"))) },
  ];
}

export function argentinaAggregateStats(
  agg: ArgentinaAggregate | undefined,
  loading: boolean
): SummaryStat[] {
  if (loading || !agg) return [{ label: "Calculating", value: "…" }];
  return [
    { label: "Shipments", value: formatInt(agg.count) },
    { label: "Total qty", value: formatNumber(agg.total_quantity) },
    { label: "Avg unit FOB", value: usd(agg.avg_unit_fob_usd) },
    { label: "Avg unit CIF", value: usd(agg.avg_unit_cif_usd) },
  ];
}
