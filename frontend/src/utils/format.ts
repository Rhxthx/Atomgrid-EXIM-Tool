/**
 * Display formatters used across the dashboard.
 *
 * Locale defaults to en-IN since the underlying data is Indian trade data —
 * the lakh/crore-friendly grouping reads more naturally in this context.
 */

const NF_INT = new Intl.NumberFormat("en-IN");
const NF_DEC = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

export function formatInt(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return NF_INT.format(v);
}

export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return NF_DEC.format(v);
}

/**
 * Compact money formatter — 1,250,000 → "12.5 L", 1,250,000,000 → "12.5 Cr".
 * Falls back to the locale formatter for small magnitudes.
 */
export function formatCompactMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return NF_DEC.format(v);
}

export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatMonth(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short" });
}

/** Truncate a long string with an ellipsis suffix. */
export function truncate(s: string | null | undefined, n = 60): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Convert any value to "" when null/undefined for safe display. */
export function dash<T>(v: T | null | undefined): T | string {
  return v === null || v === undefined ? "—" : v;
}
